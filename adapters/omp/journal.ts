// Reading ONE Oh My Pi saved session (a JSONL journal) safely, and reducing it to the closed observation of protocol/omp-observation.ts.
//
// The file belongs to OMP. This module opens it read-only, never through a link, never writes, locks, renames or repairs it, and never
// runs OMP. It does not tail: every call reads the whole file again and builds a fresh snapshot from that one read, so a file OMP
// rewrote (its title slot is rewritten in place by design, and maintenance or migration can rewrite the rest) is simply read as it now is,
// and nothing from an earlier read is merged into it. A read that sees the file change underneath it is retried once and then reported
// `unstable`, with nothing from it used.
//
// Format (OMP 18.x, docs at omp.sh/docs/session-format, checked against 18.14.1's own files): an optional 256-byte `title` slot (`v: 1`),
// then one `session` header (`version: 3`), then tree entries `{type, id, parentId, timestamp, ...}`. A final line without its newline is a
// write in progress: it is left out, and counted as `pending`, never as damage. A malformed line elsewhere is counted and skipped, as OMP's
// own reader skips it. An unknown entry type is counted and kept as `other`: OMP documents extension records, so it is not damage either.
//
// Only allowlisted facts leave this module: no text, thinking, argument, result, title, path, summary, prompt or digest is retained.

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import {
	ENDO_OMP_LIMITS_V0,
	ENDO_OMP_MODEL_PATTERN_V0,
	ENDO_OMP_REASON_PATTERN_V0,
	ENDO_OMP_SESSION_ID_PATTERN_V0,
	ENDO_OMP_STOP_REASONS_V0,
	ENDO_OMP_TOOL_PATTERN_V0,
	ENDO_OMP_VERSION_PATTERN_V0,
	ENDO_OMP_WITHHELD_TOOL_V0,
	type EndoOmpActivityItemV0,
	type EndoOmpActivityKindV0,
	type EndoOmpCountsV0,
	type EndoOmpFileStateV0,
	type EndoOmpSessionRowV0,
} from "../../protocol/omp-observation.ts";
import { isIso8601UtcV0 } from "../../protocol/primitives.ts";

/** The session format this reader knows. Any other header version is refused visibly, never read as the one it resembles. */
export const OMP_SESSION_FORMAT_V0 = 3;

/** The identity of the file a read came from: the same place and the same file object. */
export interface OmpFileIdentityV0 {
	dev: bigint;
	ino: bigint;
	size: bigint;
}

export type OmpFileReadV0 =
	| { ok: true; bytes: Buffer; identity: OmpFileIdentityV0 }
	| { ok: false; state: Exclude<EndoOmpFileStateV0, "readable" | "unsupported-version" | "no-header"> };

const sameFile = (
	a: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
	b: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

function readOnce(path: string, maxBytes: number): OmpFileReadV0 | "changed" {
	const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
	if (before === undefined || !before.isFile()) return { ok: false, state: "unreadable" };
	if (before.size > BigInt(maxBytes)) return { ok: false, state: "too-large" };
	let fd: number;
	try {
		// O_NOFOLLOW: a link swapped in after the lstat is refused by the system. O_NONBLOCK: a FIFO swapped in does not hang the read.
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch {
		return { ok: false, state: "unreadable" };
	}
	try {
		const opened = fstatSync(fd, { bigint: true });
		if (!opened.isFile()) return { ok: false, state: "unreadable" };
		if (!sameFile(before, opened)) return "changed";
		const bytes = Buffer.alloc(Number(opened.size));
		let at = 0;
		while (at < bytes.length) {
			const n = readSync(fd, bytes, at, bytes.length - at, at);
			if (n === 0) break;
			at += n;
		}
		const after = fstatSync(fd, { bigint: true });
		const still = lstatSync(path, { bigint: true, throwIfNoEntry: false });
		// The bytes are one file's, whole, and the path still names that file: otherwise this read saw a write or a replacement.
		if (at !== bytes.length || !sameFile(opened, after) || still === undefined || !sameFile(opened, still))
			return "changed";
		return { ok: true, bytes, identity: { dev: opened.dev, ino: opened.ino, size: opened.size } };
	} catch {
		return { ok: false, state: "unreadable" };
	} finally {
		closeSync(fd);
	}
}

/** The whole file, read once from a stable state, or why not. Retried once when it changes during the read. */
export function readOmpFileV0(path: string, maxBytes: number = ENDO_OMP_LIMITS_V0.maxFileBytes): OmpFileReadV0 {
	try {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const read = readOnce(path, maxBytes);
			if (read !== "changed") return read;
		}
		return { ok: false, state: "unstable" };
	} catch {
		return { ok: false, state: "unreadable" };
	}
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
function parse(line: string): Json | null {
	try {
		const value: unknown = JSON.parse(line);
		return isObject(value) ? value : null;
	} catch {
		return null;
	}
}
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && isIso8601UtcV0(v) ? v : null);
/**
 * OMP's own built-in tools, by name. Any other name (an MCP server's, an extension's) is the operator's or a third party's choice and can
 * say what they work with, so it is withheld: the page shows that a tool ran, not which.
 */
const OMP_TOOLS = new Set([
	"ask",
	"bash",
	"browser",
	"edit",
	"eval",
	"fetch",
	"find",
	"glob",
	"grep",
	"ls",
	"lsp",
	"notebook",
	"python",
	"read",
	"task",
	"todo",
	"wait",
	"web_search",
	"write",
	"yield",
]);
const toolName = (v: unknown): string =>
	typeof v === "string" && OMP_TOOLS.has(v) && ENDO_OMP_TOOL_PATTERN_V0.test(v) ? v : ENDO_OMP_WITHHELD_TOOL_V0;
/** One segment of a model name: no slash, no path, no file name. */
const MODEL_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}$/;
const MODEL_FILE = /\.(gguf|ggml|bin|safetensors|pt|pth|onnx|mlx|llamafile)$/i;
/**
 * `provider/model`, only when each is a plain name: a local server (llama.cpp and the like) can report a model FILE PATH as its model
 * id, so anything with a path separator inside a segment, an empty segment, more than one slash in the model or a model-file extension is
 * withheld.
 */
const modelOf = (provider: unknown, model: unknown): string | null => {
	if (typeof model !== "string") return null;
	const parts = model.split("/");
	if (parts.length > 2 || !parts.every((p) => MODEL_SEGMENT.test(p)) || MODEL_FILE.test(model)) return null;
	if (provider === null || provider === undefined) {
		// A model change names `provider/model` in one string.
		return parts.length === 2 && ENDO_OMP_MODEL_PATTERN_V0.test(model) ? model : null;
	}
	if (typeof provider !== "string" || !MODEL_SEGMENT.test(provider)) return null;
	const name = `${provider}/${model}`;
	return ENDO_OMP_MODEL_PATTERN_V0.test(name) ? name : null;
};

const EXIT_REASONS = new Set(["manual", "dispose", "sighup", "sigint", "sigterm", "error"]);

/** The entry types OMP 18.x documents or was seen writing. Anything else is counted as unknown, never refused. */
const KNOWN_TYPES = new Set([
	"message",
	"custom",
	"custom_message",
	"compaction",
	"branch_summary",
	"model_change",
	"thinking_level_change",
	"service_tier_change",
	"mode_change",
	"reset_boundary",
	"label",
	"title_change",
	"ttsr_injection",
	"credential_pin",
	"session_init",
	"model_usage",
]);

/** One entry, reduced to allowlisted facts the moment it is parsed. */
interface Entry {
	id: string | null;
	parentId: string | null;
	item: EndoOmpActivityItemV0;
	role: "user" | "assistant" | "toolResult" | "developer" | "other" | null;
	toolCalls: number;
	exit: EndoOmpSessionRowV0["exit"];
}

function reduceEntry(record: Json, counts: EndoOmpCountsV0): Entry {
	const type = typeof record.type === "string" ? record.type : "";
	const at = isoOrNull(record.timestamp);
	const entry: Entry = {
		id: typeof record.id === "string" && record.id.length > 0 && record.id.length <= 256 ? record.id : null,
		parentId: typeof record.parentId === "string" && record.parentId.length > 0 ? record.parentId : null,
		item: { at, kind: "other", tools: [], stopReason: null, isError: null, model: null },
		role: null,
		toolCalls: 0,
		exit: null,
	};
	const set = (kind: EndoOmpActivityKindV0, extra: Partial<EndoOmpActivityItemV0> = {}) => {
		entry.item = { ...entry.item, kind, ...extra };
	};
	if (!KNOWN_TYPES.has(type)) {
		counts.unknownTypes += 1;
		return entry;
	}
	switch (type) {
		case "message": {
			const message = isObject(record.message) ? record.message : {};
			const role = message.role;
			if (role === "user") {
				entry.role = "user";
				counts.userMessages += 1;
				set("user-message");
			} else if (role === "assistant") {
				entry.role = "assistant";
				counts.assistantMessages += 1;
				const tools = Array.isArray(message.content)
					? message.content
							.filter((b) => isObject(b) && b.type === "toolCall")
							.map((b) => toolName((b as Json).name))
					: [];
				entry.toolCalls = tools.length;
				counts.toolCalls += tools.length;
				const stop = message.stopReason;
				set("assistant-message", {
					tools: tools.slice(0, ENDO_OMP_LIMITS_V0.maxToolsPerItem),
					stopReason:
						typeof stop === "string"
							? (ENDO_OMP_STOP_REASONS_V0 as readonly string[]).includes(stop)
								? (stop as EndoOmpActivityItemV0["stopReason"])
								: "other"
							: null,
					model: modelOf(message.provider, message.model),
				});
			} else if (role === "toolResult") {
				entry.role = "toolResult";
				counts.toolResults += 1;
				const isError = message.isError === true;
				if (isError) counts.toolErrors += 1;
				set("tool-result", { tools: [toolName(message.toolName)], isError });
			} else if (role === "developer") {
				entry.role = "developer";
				set("developer-message");
			} else {
				entry.role = "other";
				set("other-message");
			}
			return entry;
		}
		case "custom": {
			const data = isObject(record.data) ? record.data : {};
			if (record.customType === "tool_execution_start") set("tool-start", { tools: [toolName(data.toolName)] });
			else if (record.customType === "session_exit") {
				set("session-exit");
				const kind = data.kind === "normal" || data.kind === "signal" ? data.kind : "other";
				entry.exit = {
					kind,
					// A closed set of OMP's own reasons (seen: manual, dispose, sighup); any other word is withheld.
					reason:
						typeof data.reason === "string" &&
						EXIT_REASONS.has(data.reason) &&
						ENDO_OMP_REASON_PATTERN_V0.test(data.reason)
							? data.reason
							: null,
					at: isoOrNull(data.recordedAt) ?? at,
				};
			} else set("extension");
			return entry;
		}
		case "custom_message":
			set("extension");
			return entry;
		case "compaction":
			counts.compactions += 1;
			set("compaction");
			return entry;
		case "branch_summary":
			set("branch-summary");
			return entry;
		case "model_change":
			set("model-change", { model: modelOf(null, record.model) });
			return entry;
		case "thinking_level_change":
			set("thinking-change");
			return entry;
		case "title_change":
			set("title-change");
			return entry;
		default:
			return entry;
	}
}

export interface OmpJournalV0 {
	state: EndoOmpFileStateV0;
	id: string | null;
	row: Omit<EndoOmpSessionRowV0, "selector" | "key" | "alias">;
	/** The last committed entries on the leaf's path, oldest first, and how many precede them. */
	activity: EndoOmpActivityItemV0[];
	earlier: number;
}

const zeroCounts = (): EndoOmpCountsV0 => ({
	entries: 0,
	userMessages: 0,
	assistantMessages: 0,
	toolResults: 0,
	toolCalls: 0,
	toolErrors: 0,
	compactions: 0,
	unknownTypes: 0,
	malformedLines: 0,
});

/** A file that could not be read, or has no usable header: a row that says so and claims nothing else. */
export function unreadOmpJournalV0(
	state: Exclude<EndoOmpFileStateV0, "readable">,
	format: { session: number | null; titleSlot: boolean } = { session: null, titleSlot: false },
): OmpJournalV0 {
	return {
		state,
		id: null,
		row: {
			state,
			format,
			runtimeVersions: [],
			createdAt: null,
			lastEntryAt: null,
			tail: "complete",
			counts: zeroCounts(),
			tree: { leaves: 0, duplicateIds: 0, missingParents: 0, cycles: 0 },
			lineage: { kind: "none" },
			exit: null,
			turn: "empty",
		},
		activity: [],
		earlier: 0,
	};
}

/** Reduce one file's bytes. Pure: no file, clock or randomness. */
export function reduceOmpJournalV0(bytes: Buffer): OmpJournalV0 {
	// Lines are scanned in place, one at a time, never split into one array: the cost is bounded by the line count, which is capped.
	// A final segment after the last newline is an unfinished write (or nothing, when the file ends in a newline): it is not read.
	let cursor = 0;
	let lineCount = 0;
	const nextLine = (): string | null => {
		const end = bytes.indexOf(0x0a, cursor);
		if (end === -1) return null;
		const line = bytes.toString("utf8", cursor, end);
		cursor = end + 1;
		lineCount += 1;
		return line;
	};
	let titleSlot = false;
	let line = nextLine();
	const first = line === null ? null : parse(line);
	if (first !== null && first.type === "title") {
		// Recognised by its type and version, as OMP's docs say (normally exactly 256 bytes with its newline; a shorter or longer one is
		// still the title slot). Its title is never read. A title slot of another version is a format this reader does not know.
		if (first.v !== 1) return unreadOmpJournalV0("unsupported-version", { session: null, titleSlot: false });
		titleSlot = true;
		line = nextLine();
	}
	while (line !== null && line.trim() === "") line = nextLine();
	const header = line === null ? null : parse(line);
	if (header === null || header.type !== "session")
		return unreadOmpJournalV0("no-header", { session: null, titleSlot });
	const version = header.version === undefined ? 1 : header.version;
	if (version !== OMP_SESSION_FORMAT_V0)
		return unreadOmpJournalV0("unsupported-version", {
			session: typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : null,
			titleSlot,
		});
	const id = typeof header.id === "string" && ENDO_OMP_SESSION_ID_PATTERN_V0.test(header.id) ? header.id : null;
	const counts = zeroCounts();
	const entries: Entry[] = [];
	const versions: string[] = [];
	for (let text = nextLine(); text !== null; text = nextLine()) {
		if (lineCount > ENDO_OMP_LIMITS_V0.maxLines)
			return unreadOmpJournalV0("too-large", { session: OMP_SESSION_FORMAT_V0, titleSlot });
		if (text.trim() === "") continue;
		const record = parse(text);
		if (record === null || typeof record.type !== "string") {
			counts.malformedLines += 1;
			continue;
		}
		counts.entries += 1;
		const runtime = isObject(record.runtime) ? record.runtime.version : undefined;
		if (typeof runtime === "string" && ENDO_OMP_VERSION_PATTERN_V0.test(runtime)) {
			const known = versions.indexOf(runtime);
			if (known !== -1) versions.splice(known, 1);
			versions.push(runtime);
		}
		entries.push(reduceEntry(record, counts));
	}

	// The tree: duplicate ids, missing parents and cycles are counted; leaves are entries nothing points to.
	const byId = new Map<string, Entry>();
	let duplicateIds = 0;
	for (const e of entries) {
		if (e.id === null) continue;
		if (byId.has(e.id)) duplicateIds += 1;
		else byId.set(e.id, e);
	}
	const parents = new Set<string>();
	let missingParents = 0;
	for (const e of entries) {
		if (e.parentId === null) continue;
		parents.add(e.parentId);
		if (!byId.has(e.parentId)) missingParents += 1;
	}
	let cycles = 0;
	const settled = new Set<string>();
	for (const start of byId.keys()) {
		const trail = new Set<string>();
		let node: string | null = start;
		while (node !== null && !settled.has(node)) {
			if (trail.has(node)) {
				cycles += 1;
				break;
			}
			trail.add(node);
			node = byId.get(node)?.parentId ?? null;
		}
		for (const seen of trail) settled.add(seen);
	}
	const leaves = [...byId.keys()].filter((key) => !parents.has(key)).length;

	// The leaf is the last logical entry in file order (OMP's own rule on load); its path is followed back to a root.
	const leaf = entries[entries.length - 1];
	const path: Entry[] = [];
	if (leaf !== undefined) {
		const seen = new Set<string>();
		let step: Entry | undefined = leaf;
		while (step !== undefined) {
			path.push(step);
			if (step.id !== null) seen.add(step.id);
			const next: string | null = step.parentId;
			if (next === null || seen.has(next)) break;
			step = byId.get(next);
		}
		path.reverse();
	}
	const lastMessage = [...path].reverse().find((e) => e.role !== null);
	const turn: EndoOmpSessionRowV0["turn"] =
		lastMessage === undefined
			? "empty"
			: lastMessage.role === "user" || lastMessage.role === "toolResult" || lastMessage.role === "developer"
				? "open"
				: lastMessage.role === "assistant" && lastMessage.item.stopReason === "toolUse"
					? "open"
					: "settled";
	const parentSession = header.parentSession;
	const lineage: EndoOmpSessionRowV0["lineage"] =
		typeof parentSession !== "string" || parentSession === ""
			? { kind: "none" }
			: parentSession.includes("/") || parentSession.endsWith(".jsonl")
				? { kind: "copied-file" }
				: { kind: "session", id: ENDO_OMP_SESSION_ID_PATTERN_V0.test(parentSession) ? parentSession : null };
	const pending = cursor < bytes.length;
	const shown = path.slice(-ENDO_OMP_LIMITS_V0.maxActivity);
	return {
		state: "readable",
		id,
		row: {
			state: "readable",
			format: { session: OMP_SESSION_FORMAT_V0, titleSlot },
			runtimeVersions: versions.slice(-ENDO_OMP_LIMITS_V0.maxRuntimeVersions),
			createdAt: isoOrNull(header.timestamp),
			lastEntryAt: leaf?.item.at ?? null,
			tail: pending ? "pending" : "complete",
			counts,
			tree: { leaves, duplicateIds, missingParents, cycles },
			lineage,
			// An exit followed by an unfinished line is not the last word: OMP may have resumed and be writing again.
			exit: pending ? null : (leaf?.exit ?? null),
			turn,
		},
		activity: shown.map((e) => e.item),
		earlier: path.length - shown.length,
	};
}
