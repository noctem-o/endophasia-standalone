// What DEVELOP may show of an Oh My Pi (OMP) saved session: `endo.develop-omp-sessions.v0` (the list) and `endo.develop-omp-session.v0`
// (one session and its recent committed activity). docs/develop-omp-observer.md says how it is read and what it cannot see.
//
// It is an OBSERVATION of files another program writes, not evidence and not a connection. Endophasia reads the saved JSONL session that
// OMP persists, at the moment of each request, and says what that file holds. It never writes it, never runs OMP, and gains no control:
// a saved session is owned by the OMP process that wrote it, whether or not one is running now, and nothing here can tell which.
//
// PRIVACY is a closed allowlist: these records carry counts, closed classifications, timestamps, the session id OMP gave, the version
// OMP recorded, tool names and model names (each through a strict grammar, else withheld), and nothing else. No message text, thinking,
// tool argument or result, title, working directory, file path, compaction summary, prompt, system prompt, credential digest or provider
// payload is carried, and a validator refuses any member it does not know, so a projector that tried would fail closed.
//
// The protocol imports only the protocol.

import { isIso8601UtcV0, isPlainJsonObjectV0 } from "./primitives.ts";

export const ENDO_OMP_SESSIONS_SCHEMA_V0 = "endo.develop-omp-sessions.v0";
export const ENDO_OMP_SESSION_SCHEMA_V0 = "endo.develop-omp-session.v0";

/** Bounds. A real local session reached 34.5 MB with a 195 KB line, so the per-file bound sits well above it. */
export const ENDO_OMP_LIMITS_V0 = Object.freeze({
	maxFileBytes: 96 * 1024 * 1024,
	/** All files read for one listing: past it, the rest are listed as not read. */
	maxListingBytes: 512 * 1024 * 1024,
	maxFiles: 200,
	/** Directory levels looked into: the root, OMP's project groups, then a session's artifact directory (subagent sessions). */
	maxDepth: 3,
	/** Lines read from one file: past it the file is `too-large`. Bounds memory and time by the number of entries, not only bytes. */
	maxLines: 400_000,
	maxActivity: 60,
	maxRuntimeVersions: 4,
	maxToolsPerItem: 8,
});

/** What a read of one file found. Only `readable` has entries; every other state says why there are none. */
export const ENDO_OMP_FILE_STATES_V0 = [
	"readable",
	/** The header names a session format version this reader does not know (it reads version 3 only). */
	"unsupported-version",
	/** No session header where one must be (after an optional title slot). */
	"no-header",
	"too-large",
	/** The file changed while it was read, twice: nothing from either read is used. */
	"unstable",
	"unreadable",
] as const;
export type EndoOmpFileStateV0 = (typeof ENDO_OMP_FILE_STATES_V0)[number];

export const ENDO_OMP_KEY_REASONS_V0 = [
	/** Two files in the selected directory carry the same session id: neither is treated as that session. */
	"duplicate-id",
	/** The header's id is not a well-formed opaque id. It is not repaired. */
	"malformed-id",
	/** There is no readable header, so no id. */
	"no-header",
] as const;

export const ENDO_OMP_STOP_REASONS_V0 = ["stop", "length", "toolUse", "error", "aborted", "other"] as const;
export const ENDO_OMP_EXIT_KINDS_V0 = ["normal", "signal", "other"] as const;

/** The kind of one committed entry. Fixed words; nothing of the entry's own text. */
export const ENDO_OMP_ACTIVITY_KINDS_V0 = [
	"user-message",
	"assistant-message",
	"tool-result",
	"tool-start",
	"developer-message",
	"other-message",
	"compaction",
	"branch-summary",
	"model-change",
	"thinking-change",
	"title-change",
	"session-exit",
	"extension",
	"other",
] as const;
export type EndoOmpActivityKindV0 = (typeof ENDO_OMP_ACTIVITY_KINDS_V0)[number];

export interface EndoOmpCountsV0 {
	/** Logical entries after the header (the title slot is not one). */
	entries: number;
	userMessages: number;
	assistantMessages: number;
	toolResults: number;
	toolCalls: number;
	toolErrors: number;
	compactions: number;
	/** Entry types this reader does not know. Counted, never treated as damage: OMP documents extension records. */
	unknownTypes: number;
	/** Lines that are not a JSON object (OMP's own reader skips them too). */
	malformedLines: number;
}

export interface EndoOmpSessionRowV0 {
	/** Opaque: the page asks for this session by it. Never a path; bound to the server's key and the file's place and identity. */
	selector: string;
	key:
		| { status: "established"; id: string }
		| { status: "unavailable"; reason: (typeof ENDO_OMP_KEY_REASONS_V0)[number] };
	/** A label for the page, made from the id. Never a key; null when two would look alike. */
	alias: string | null;
	state: EndoOmpFileStateV0;
	/** The header's format version (3 is read), and whether the file begins with OMP's fixed-width title slot. */
	format: { session: number | null; titleSlot: boolean };
	/** The OMP versions the entries themselves record (`runtime.version`), newest last. Recorded by OMP, not observed. */
	runtimeVersions: string[];
	createdAt: string | null;
	/** The persistence time of the last logical entry, as OMP recorded it. Not a heartbeat and not a file time. */
	lastEntryAt: string | null;
	/** `pending`: the file ends in a line that is not finished yet (a write in progress, or a crash). It is not read, and not damage. */
	tail: "complete" | "pending";
	counts: EndoOmpCountsV0;
	/** The session tree: how many leaves (branches) it has and what is wrong with it. */
	tree: { leaves: number; duplicateIds: number; missingParents: number; cycles: number };
	/**
	 * Lineage as OMP recorded it in the header: a fork of another session (by its id), a branch copied from another FILE (the path is
	 * withheld), or none. Never inferred from a name, a directory or a time.
	 */
	lineage: { kind: "none" } | { kind: "session"; id: string | null } | { kind: "copied-file" };
	/** OMP's own exit record, when it is the LAST entry: what OMP reported as it exited. Null otherwise (resumed since, or never written). */
	exit: { kind: (typeof ENDO_OMP_EXIT_KINDS_V0)[number]; reason: string | null; at: string | null } | null;
	/** At the leaf: a tool call or a user message without its answer (`open`), an answered turn (`settled`), or no messages (`empty`). */
	turn: "open" | "settled" | "empty";
}

export interface EndoOmpSessionsV0 {
	schemaVersion: typeof ENDO_OMP_SESSIONS_SCHEMA_V0;
	available: true;
	/** The server's clock when the directory was read. A snapshot time, not a time OMP recorded. */
	readAt: string;
	sessions: EndoOmpSessionRowV0[];
	/** Files or directories passed over, by why. */
	skipped: { links: number; notRegular: number; overLimit: number; notRead: number; unreadable: number };
}

/** Without `--omp-sessions` the server answers this one constant, so a page can ask quietly. */
export interface EndoOmpAbsentV0 {
	schemaVersion: typeof ENDO_OMP_SESSIONS_SCHEMA_V0;
	available: false;
}
export const ENDO_OMP_ABSENT_V0: EndoOmpAbsentV0 = Object.freeze({
	schemaVersion: ENDO_OMP_SESSIONS_SCHEMA_V0,
	available: false,
});

export interface EndoOmpActivityItemV0 {
	at: string | null;
	kind: EndoOmpActivityKindV0;
	/** Tool names: the calls an assistant message made, the tool a result or a start belongs to. A name outside the grammar is withheld. */
	tools: string[];
	stopReason: (typeof ENDO_OMP_STOP_REASONS_V0)[number] | null;
	isError: boolean | null;
	/** `provider/model` of an assistant message or a model change, through a grammar, else null. */
	model: string | null;
}

export interface EndoOmpSessionV0 {
	schemaVersion: typeof ENDO_OMP_SESSION_SCHEMA_V0;
	readAt: string;
	session: EndoOmpSessionRowV0;
	/** The last committed entries on the leaf's path, oldest first. Only what OMP has saved: no streaming text exists in the file. */
	activity: EndoOmpActivityItemV0[];
	/** More entries precede these on the path than are shown. */
	earlier: number;
}

// ---- grammars ----------------------------------------------------------------------------------------------------------------------

export const ENDO_OMP_SESSION_ID_PATTERN_V0 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ENDO_OMP_SELECTOR_PATTERN_V0 = /^o1-[0-9a-f]{32}$/;
export const ENDO_OMP_TOOL_PATTERN_V0 = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const ENDO_OMP_MODEL_PATTERN_V0 = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
export const ENDO_OMP_VERSION_PATTERN_V0 = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
export const ENDO_OMP_REASON_PATTERN_V0 = /^[a-z][a-z0-9_-]{0,31}$/;
/** What a withheld tool name is shown as. */
export const ENDO_OMP_WITHHELD_TOOL_V0 = "(withheld name)";

// ---- validators ---------------------------------------------------------------------------------------------------------------------

const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
	isPlainJsonObjectV0(value) &&
	Object.keys(value as object).length === keys.length &&
	keys.every((k) => Object.hasOwn(value as object, k));
const count = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): boolean => v === null || (typeof v === "string" && isIso8601UtcV0(v));
const oneOf = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v);
const matches = (pattern: RegExp, v: unknown): boolean => typeof v === "string" && pattern.test(v);
const tool = (v: unknown): boolean => v === ENDO_OMP_WITHHELD_TOOL_V0 || matches(ENDO_OMP_TOOL_PATTERN_V0, v);

const COUNTS = [
	"entries",
	"userMessages",
	"assistantMessages",
	"toolResults",
	"toolCalls",
	"toolErrors",
	"compactions",
	"unknownTypes",
	"malformedLines",
];

/** Null when the row is well formed, or what is wrong. */
export function endoOmpRowProblemV0(value: unknown): string | null {
	if (
		!exact(value, [
			"selector",
			"key",
			"alias",
			"state",
			"format",
			"runtimeVersions",
			"createdAt",
			"lastEntryAt",
			"tail",
			"counts",
			"tree",
			"lineage",
			"exit",
			"turn",
		])
	)
		return "row: unexpected members";
	const r = value;
	if (!matches(ENDO_OMP_SELECTOR_PATTERN_V0, r.selector)) return "row: selector";
	const key = r.key;
	if (exact(key, ["status", "id"])) {
		if (key.status !== "established" || !matches(ENDO_OMP_SESSION_ID_PATTERN_V0, key.id)) return "row: key";
	} else if (
		!exact(key, ["status", "reason"]) ||
		key.status !== "unavailable" ||
		!oneOf(ENDO_OMP_KEY_REASONS_V0, key.reason)
	)
		return "row: key";
	if (r.alias !== null && !matches(/^omp [0-9A-Za-z._:-]{4,40}$/, r.alias)) return "row: alias";
	if (!oneOf(ENDO_OMP_FILE_STATES_V0, r.state)) return "row: state";
	const format = r.format;
	if (
		!exact(format, ["session", "titleSlot"]) ||
		!(format.session === null || count(format.session)) ||
		typeof format.titleSlot !== "boolean"
	)
		return "row: format";
	if (
		!Array.isArray(r.runtimeVersions) ||
		r.runtimeVersions.length > ENDO_OMP_LIMITS_V0.maxRuntimeVersions ||
		!r.runtimeVersions.every((v) => matches(ENDO_OMP_VERSION_PATTERN_V0, v))
	)
		return "row: runtimeVersions";
	if (!date(r.createdAt) || !date(r.lastEntryAt)) return "row: times";
	if (!oneOf(["complete", "pending"], r.tail)) return "row: tail";
	if (!exact(r.counts, COUNTS) || !COUNTS.every((k) => count((r.counts as Record<string, unknown>)[k])))
		return "row: counts";
	const tree = r.tree;
	if (
		!exact(tree, ["leaves", "duplicateIds", "missingParents", "cycles"]) ||
		![tree.leaves, tree.duplicateIds, tree.missingParents, tree.cycles].every(count)
	)
		return "row: tree";
	const lineage = r.lineage;
	if (
		!(
			(exact(lineage, ["kind"]) && (lineage.kind === "none" || lineage.kind === "copied-file")) ||
			(exact(lineage, ["kind", "id"]) &&
				lineage.kind === "session" &&
				(lineage.id === null || matches(ENDO_OMP_SESSION_ID_PATTERN_V0, lineage.id)))
		)
	)
		return "row: lineage";
	const exit = r.exit;
	if (
		exit !== null &&
		!(
			exact(exit, ["kind", "reason", "at"]) &&
			oneOf(ENDO_OMP_EXIT_KINDS_V0, exit.kind) &&
			(exit.reason === null || matches(ENDO_OMP_REASON_PATTERN_V0, exit.reason)) &&
			date(exit.at)
		)
	)
		return "row: exit";
	if (!oneOf(["open", "settled", "empty"], r.turn)) return "row: turn";
	// Nothing is claimed of a file that could not be read.
	if (r.state !== "readable" && (r.exit !== null || (r.counts as Record<string, number>).entries !== 0))
		return "row: an unread file has no entries";
	return null;
}

function itemProblem(value: unknown): string | null {
	if (!exact(value, ["at", "kind", "tools", "stopReason", "isError", "model"])) return "activity: unexpected members";
	if (!date(value.at) || !oneOf(ENDO_OMP_ACTIVITY_KINDS_V0, value.kind)) return "activity: kind or time";
	if (
		!Array.isArray(value.tools) ||
		value.tools.length > ENDO_OMP_LIMITS_V0.maxToolsPerItem ||
		!value.tools.every(tool)
	)
		return "activity: tools";
	if (value.stopReason !== null && !oneOf(ENDO_OMP_STOP_REASONS_V0, value.stopReason)) return "activity: stopReason";
	if (value.isError !== null && typeof value.isError !== "boolean") return "activity: isError";
	if (value.model !== null && !matches(ENDO_OMP_MODEL_PATTERN_V0, value.model)) return "activity: model";
	return null;
}

export function validateEndoOmpSessionsV0(value: unknown): EndoOmpSessionsV0 | EndoOmpAbsentV0 {
	if (
		exact(value, ["schemaVersion", "available"]) &&
		value.available === false &&
		value.schemaVersion === ENDO_OMP_SESSIONS_SCHEMA_V0
	)
		return value as unknown as EndoOmpAbsentV0;
	if (!exact(value, ["schemaVersion", "available", "readAt", "sessions", "skipped"]) || value.available !== true)
		throw new TypeError("not an OMP session list");
	if (
		value.schemaVersion !== ENDO_OMP_SESSIONS_SCHEMA_V0 ||
		typeof value.readAt !== "string" ||
		!isIso8601UtcV0(value.readAt)
	)
		throw new TypeError("OMP session list: header");
	if (!Array.isArray(value.sessions) || value.sessions.length > ENDO_OMP_LIMITS_V0.maxFiles)
		throw new TypeError("OMP session list: sessions");
	const seen = new Set<string>();
	const keys = new Set<string>();
	const aliases = new Set<string>();
	for (const row of value.sessions) {
		const problem = endoOmpRowProblemV0(row);
		if (problem !== null) throw new TypeError(`OMP session list: ${problem}`);
		const r = row as EndoOmpSessionRowV0;
		if (seen.has(r.selector)) throw new TypeError("OMP session list: a selector repeats");
		seen.add(r.selector);
		// One session id is one session: a list that gives two rows the same established key, or the same label, is refused whole.
		if (r.key.status === "established") {
			if (keys.has(r.key.id)) throw new TypeError("OMP session list: an established key repeats");
			keys.add(r.key.id);
		}
		if (r.alias !== null) {
			if (aliases.has(r.alias)) throw new TypeError("OMP session list: a label repeats");
			aliases.add(r.alias);
		}
	}
	const skipped = value.skipped;
	if (
		!exact(skipped, ["links", "notRegular", "overLimit", "notRead", "unreadable"]) ||
		![skipped.links, skipped.notRegular, skipped.overLimit, skipped.notRead, skipped.unreadable].every(count)
	)
		throw new TypeError("OMP session list: skipped");
	return value as unknown as EndoOmpSessionsV0;
}

export function validateEndoOmpSessionV0(value: unknown): EndoOmpSessionV0 {
	if (!exact(value, ["schemaVersion", "readAt", "session", "activity", "earlier"]))
		throw new TypeError("not an OMP session");
	if (
		value.schemaVersion !== ENDO_OMP_SESSION_SCHEMA_V0 ||
		typeof value.readAt !== "string" ||
		!isIso8601UtcV0(value.readAt)
	)
		throw new TypeError("OMP session: header");
	const problem = endoOmpRowProblemV0(value.session);
	if (problem !== null) throw new TypeError(`OMP session: ${problem}`);
	if (!Array.isArray(value.activity) || value.activity.length > ENDO_OMP_LIMITS_V0.maxActivity)
		throw new TypeError("OMP session: activity");
	for (const item of value.activity) {
		const p = itemProblem(item);
		if (p !== null) throw new TypeError(`OMP session: ${p}`);
	}
	if (!count(value.earlier)) throw new TypeError("OMP session: earlier");
	return value as unknown as EndoOmpSessionV0;
}

/**
 * What a server is handed to answer the two OMP routes: built by the CLI from the directory the operator named, so the server itself
 * reaches no filesystem and imports no adapter. `session` answers null for a selector it does not know (stale, or the file replaced).
 */
export interface EndoOmpObserverV0 {
	sessions(): EndoOmpSessionsV0;
	session(selector: string): EndoOmpSessionV0 | null;
}
