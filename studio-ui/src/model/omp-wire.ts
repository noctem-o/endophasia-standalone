// Browser wire gate for the Oh My Pi saved-session observation (protocol/omp-observation.ts). The server is authoritative for what it
// reads and withholds; nothing of the protocol runs here (types only). These checks cover every field the OMP views read, with the same
// closed lists and grammars, so a record the page cannot show is a failed read now and not a broken panel later.
import type { EndoOmpSessionRowV0, EndoOmpSessionsV0, EndoOmpSessionV0 } from "../../../protocol/omp-observation.ts";
import { bool, type Check, count, eitherNull, one, shape } from "./compare-wire.ts";

/** These mirror the protocol's closed lists; a contract test holds them equal. */
export const OMP_FILE_STATES = [
	"readable",
	"unsupported-version",
	"no-header",
	"too-large",
	"unstable",
	"unreadable",
] as const;
export const OMP_KEY_REASONS = ["duplicate-id", "malformed-id", "no-header"] as const;
export const OMP_STOP_REASONS = ["stop", "length", "toolUse", "error", "aborted", "other"] as const;
export const OMP_EXIT_KINDS = ["normal", "signal", "other"] as const;
export const OMP_ACTIVITY_KINDS = [
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
export const OMP_WITHHELD_TOOL = "(withheld name)";

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?Z$/;
const date: Check = (v) => v === null || (typeof v === "string" && ISO.test(v));
const matches =
	(pattern: RegExp): Check =>
	(v) =>
		typeof v === "string" && pattern.test(v);
export const ompSelector = matches(/^o1-[0-9a-f]{32}$/);
const sessionId = matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const tool: Check = (v) => v === OMP_WITHHELD_TOOL || matches(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/)(v);
const model = matches(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/);
const version = matches(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(?:[-+][A-Za-z0-9.-]{1,32})?$/);
const bounded =
	(max: number, check: Check): Check =>
	(v) =>
		Array.isArray(v) && v.length <= max && v.every(check);

const row: Check = (v) =>
	shape(v, {
		selector: ompSelector,
		key: (k) =>
			shape(k, { status: one("established"), id: sessionId }) ||
			shape(k, { status: one("unavailable"), reason: one(...OMP_KEY_REASONS) }),
		alias: eitherNull(matches(/^omp [0-9A-Za-z._:-]{4,40}$/)),
		state: one(...OMP_FILE_STATES),
		format: (f) => shape(f, { session: eitherNull(count), titleSlot: bool }),
		runtimeVersions: bounded(4, version),
		createdAt: date,
		lastEntryAt: date,
		tail: one("complete", "pending"),
		counts: (c) =>
			shape(c, {
				entries: count,
				userMessages: count,
				assistantMessages: count,
				toolResults: count,
				toolCalls: count,
				toolErrors: count,
				compactions: count,
				unknownTypes: count,
				malformedLines: count,
			}),
		tree: (t) => shape(t, { leaves: count, duplicateIds: count, missingParents: count, cycles: count }),
		lineage: (l) =>
			shape(l, { kind: one("none", "copied-file") }) ||
			shape(l, { kind: one("session"), id: eitherNull(sessionId) }),
		exit: eitherNull((e) =>
			shape(e, {
				kind: one(...OMP_EXIT_KINDS),
				reason: eitherNull(matches(/^[a-z][a-z0-9_-]{0,31}$/)),
				at: date,
			}),
		),
		turn: one("open", "settled", "empty"),
	});

const item: Check = (v) =>
	shape(v, {
		at: date,
		kind: one(...OMP_ACTIVITY_KINDS),
		tools: bounded(8, tool),
		stopReason: eitherNull(one(...OMP_STOP_REASONS)),
		isError: eitherNull(bool),
		model: eitherNull(model),
	});

export type OmpList = EndoOmpSessionsV0 | { available: false };

/** The list, the constant "not observed here", or null when the record is not one this page can show. */
export function readOmpSessions(v: unknown): OmpList | null {
	if (shape(v, { schemaVersion: one("endo.develop-omp-sessions.v0"), available: one(false) }))
		return { available: false };
	if (
		!shape(v, {
			schemaVersion: one("endo.develop-omp-sessions.v0"),
			available: one(true),
			readAt: (t) => typeof t === "string" && ISO.test(t),
			sessions: bounded(200, row),
			skipped: (s) =>
				shape(s, { links: count, notRegular: count, overLimit: count, notRead: count, unreadable: count }),
		})
	)
		return null;
	const selectors = new Set((v.sessions as EndoOmpSessionRowV0[]).map((r) => r.selector));
	return selectors.size === (v.sessions as unknown[]).length ? (v as unknown as EndoOmpSessionsV0) : null;
}

export function readOmpSession(v: unknown): EndoOmpSessionV0 | null {
	return shape(v, {
		schemaVersion: one("endo.develop-omp-session.v0"),
		readAt: (t) => typeof t === "string" && ISO.test(t),
		session: row,
		activity: bounded(60, item),
		earlier: count,
	})
		? (v as unknown as EndoOmpSessionV0)
		: null;
}
