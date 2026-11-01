// The DEVELOP project and task records (`endo.develop-tasks.v0`) and the shape the workbench shows of them (`endo.develop-workspace.v0`).
//
// A project is not a session, a task is not a prompt, a worktree is not an agent, and an agent finishing is not a task done. These records
// are the operator's own metadata about their work. They are independent of Pi, DSH, Codex or any runtime, they are not evidence, they are
// written to no event log, and they authorise nothing: no field here selects a file to open, a command to run, or a session to control.
//
// What is stored (the file, `<root>/develop/tasks.json`): projects the OPERATOR registered, the tasks they wrote under them, a status each,
// a short bounded history of the status changes they made, and the explicit session references they asked for. What is never stored here:
// a transcript, model-provided reasoning, a pairing code or grant, an approval phrase, a provider credential, a prompt. The text fields are
// the operator's own words and may be private; they are shown only to a paired workbench page and never through `endo studio`.

import { isWellFormedKindV0 } from "./identity.ts";
import {
	defineEndoVersionTableV0,
	EndoInvalidRecordV0,
	endoFirstUnknownKeyV0,
	readEndoVersionedV0,
} from "./versioned.ts";

export const ENDO_DEVELOP_TASKS_SCHEMA_V0 = "endo.develop-tasks.v0";
export const ENDO_DEVELOP_WORKSPACE_SCHEMA_V0 = "endo.develop-workspace.v0";

/** Closed bounds. The whole file is at most `maxFileBytes`, so a rewrite stays small and a hostile or damaged file stays cheap to refuse. */
export const ENDO_DEVELOP_TASK_LIMITS_V0 = Object.freeze({
	maxFileBytes: 4 * 1024 * 1024,
	maxProjects: 8,
	maxTasks: 300,
	maxName: 80,
	maxPath: 1024,
	maxTitle: 120,
	/** Characters (UTF-16 units) and UTF-8 bytes: a description is prose, a few paragraphs. */
	maxText: 4000,
	maxTextBytes: 12 * 1024,
	maxNote: 280,
	maxHistory: 50,
	maxSessions: 20,
});

export const ENDO_DEVELOP_TASK_STATUSES_V0 = ["open", "in-progress", "blocked", "review", "done"] as const;
export type EndoDevelopTaskStatusV0 = (typeof ENDO_DEVELOP_TASK_STATUSES_V0)[number];

/**
 * The transitions the operator may make. Small and reversible: work starts, can be blocked and unblocked, goes to review, and is done only
 * from review. A finished task is reopened by an explicit act. Nothing here is reachable by an agent finishing, a run ending or a session
 * going away: the only caller is an operator's command.
 */
const TRANSITIONS: Readonly<Record<EndoDevelopTaskStatusV0, readonly EndoDevelopTaskStatusV0[]>> = {
	open: ["in-progress", "blocked"],
	"in-progress": ["review", "blocked", "open"],
	blocked: ["open", "in-progress"],
	review: ["done", "in-progress", "blocked"],
	done: ["open"],
};
export const endoDevelopNextStatusesV0 = (from: EndoDevelopTaskStatusV0): readonly EndoDevelopTaskStatusV0[] =>
	TRANSITIONS[from];
export const isEndoDevelopTaskStatusV0 = (value: unknown): value is EndoDevelopTaskStatusV0 =>
	typeof value === "string" && (ENDO_DEVELOP_TASK_STATUSES_V0 as readonly string[]).includes(value);

// ---- records -----------------------------------------------------------------------------------------------------------------------

/**
 * An explicit, attributed reference from a task to a session. It records ONE claim: that at `linkedAtMs` the operator asked, in the
 * workbench, for this task to be linked to the session that workbench served in `launchId`. It is scoped to that launch. It is not an
 * identity the task can use later: after another launch it is a historical claim, and nothing here lets a task control, resume or
 * select a session. `sessionId` is the evidence store's own id of the Pi session, taken by the broker from its own state, never from the page.
 */
export interface EndoDevelopSessionRefV0 {
	linkId: string;
	source: "pi-live";
	sessionId: string;
	attachment: string;
	launchId: string;
	linkedAtMs: number;
	linkedBy: "operator";
	via: "workbench";
}

export interface EndoDevelopStatusChangeV0 {
	atMs: number;
	/** null for the creation of the task. */
	from: EndoDevelopTaskStatusV0 | null;
	to: EndoDevelopTaskStatusV0;
	note: string | null;
}

export interface EndoDevelopTaskV0 {
	id: string;
	projectId: string;
	title: string;
	description: string;
	acceptance: string;
	status: EndoDevelopTaskStatusV0;
	createdAtMs: number;
	updatedAtMs: number;
	/** Increases on every change to this task. An edit names the revision it was made against and is refused when it is not the current one. */
	revision: number;
	history: EndoDevelopStatusChangeV0[];
	sessions: EndoDevelopSessionRefV0[];
}

/**
 * A project the operator registered (`endo project add`). `path` is the directory they named, as the system spelled it at that moment
 * (symbolic links resolved). It is a CONFIGURED association: not a remote, a branch name or a label, and it grants no access to anything.
 * `observedGitRoot` is what Git said the worktree root of that directory was at registration, or null.
 */
export interface EndoDevelopProjectV0 {
	id: string;
	name: string;
	path: string;
	observedGitRoot: string | null;
	createdAtMs: number;
	updatedAtMs: number;
	revision: number;
	/** The task the operator last chose to work on, so a return finds it. Selecting a task never changes its status. */
	selectedTaskId: string | null;
}

export interface EndoDevelopTasksFileV0 {
	schemaVersion: typeof ENDO_DEVELOP_TASKS_SCHEMA_V0;
	/** Increases on every write of the file. */
	revision: number;
	projects: EndoDevelopProjectV0[];
	tasks: EndoDevelopTaskV0[];
}

export const emptyEndoDevelopTasksFileV0 = (): EndoDevelopTasksFileV0 => ({
	schemaVersion: ENDO_DEVELOP_TASKS_SCHEMA_V0,
	revision: 0,
	projects: [],
	tasks: [],
});

// ---- text rules ---------------------------------------------------------------------------------------------------------------------

/**
 * Characters that are refused anywhere in a task's text, because the same text is shown in a terminal and a page: every control character
 * except newline and tab, the C1 controls, the line and paragraph separators, and the bidirectional overrides and isolates.
 */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const ONE_LINE_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

export type EndoTextRuleV0 = "title" | "name" | "note" | "text";

/** The text, or the reason it is refused. Text is never altered; surrounding whitespace is the one thing trimmed on a one-line field. */
export function checkEndoDevelopTextV0(
	rule: EndoTextRuleV0,
	value: unknown,
): { ok: true; text: string } | { ok: false } {
	if (typeof value !== "string") return { ok: false };
	const limits = ENDO_DEVELOP_TASK_LIMITS_V0;
	const max =
		rule === "title"
			? limits.maxTitle
			: rule === "name"
				? limits.maxName
				: rule === "note"
					? limits.maxNote
					: limits.maxText;
	if (rule === "text") {
		if (value.length > max || new TextEncoder().encode(value).length > limits.maxTextBytes || UNSAFE.test(value))
			return { ok: false };
		return { ok: true, text: value };
	}
	const text = value.trim();
	if (text.length > max || ONE_LINE_UNSAFE.test(text)) return { ok: false };
	if (rule !== "note" && text.length === 0) return { ok: false };
	return { ok: true, text };
}

// ---- identifiers --------------------------------------------------------------------------------------------------------------------

export const ENDO_PROJECT_ID_PATTERN_V0 = /^endo\.project\.[0-9a-f]{32}$/;
export const ENDO_TASK_ID_PATTERN_V0 = /^endo\.task\.[0-9a-f]{32}$/;
export const ENDO_LINK_ID_PATTERN_V0 = /^[0-9a-f]{16}$/;
export const ENDO_LAUNCH_ID_PATTERN_V0 = /^[0-9a-f]{16}$/;
// Exactly what `piEndoSessionIdV0` can produce: the Pi id itself (1-200 plain characters) or a digest of one that is not plain.
const SESSION_ID_PATTERN = /^endo\.session\.pi\.[A-Za-z0-9._-]{1,200}$/;

// ---- the strict validator -----------------------------------------------------------------------------------------------------------

const bad = (what: string): never => {
	throw new EndoInvalidRecordV0(what);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[], what: string): Record<string, unknown> => {
	if (!isObject(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null))
		return bad(`${what} is not an object`);
	const extra = endoFirstUnknownKeyV0(v, keys);
	if (extra !== undefined) return bad(`${what} has an unknown member`);
	for (const key of keys) if (!Object.hasOwn(v, key)) return bad(`${what} lacks ${key}`);
	return v;
};
const count = (v: unknown, what: string): number => {
	if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return bad(`${what} is not a count`);
	return v;
};
const stamp = (v: unknown, what: string): number => {
	const n = count(v, what);
	if (n > 8.64e15) return bad(`${what} is not a time`);
	return n;
};
const text = (v: unknown, rule: EndoTextRuleV0, what: string): string => {
	const checked = checkEndoDevelopTextV0(rule, v);
	if (!checked.ok) return bad(`${what} is not acceptable text`);
	// A stored one-line value is already trimmed: what was written is what is read.
	if (rule !== "text" && checked.text !== v) return bad(`${what} is not trimmed`);
	return checked.text;
};
/** The harness registry's own grammar for an attachment name (a dotted kind of at most 128 characters), not the 80-character project-name bound. */
const attachmentName = (v: unknown): string =>
	typeof v === "string" && isWellFormedKindV0(v)
		? v
		: bad("a session reference's attachment is not an attachment name");
const nullable = <T>(v: unknown, read: (x: unknown) => T): T | null => (v === null ? null : read(v));

function ref(v: unknown): EndoDevelopSessionRefV0 {
	const r = closed(
		v,
		["linkId", "source", "sessionId", "attachment", "launchId", "linkedAtMs", "linkedBy", "via"],
		"a session reference",
	);
	if (typeof r.linkId !== "string" || !ENDO_LINK_ID_PATTERN_V0.test(r.linkId)) bad("a session reference has a bad id");
	if (r.source !== "pi-live" || r.linkedBy !== "operator" || r.via !== "workbench")
		bad("a session reference has an unknown source");
	if (typeof r.sessionId !== "string" || !SESSION_ID_PATTERN.test(r.sessionId))
		bad("a session reference has a bad session id");
	if (typeof r.launchId !== "string" || !ENDO_LAUNCH_ID_PATTERN_V0.test(r.launchId))
		bad("a session reference has a bad launch id");
	return {
		linkId: r.linkId as string,
		source: "pi-live",
		sessionId: r.sessionId as string,
		attachment: attachmentName(r.attachment),
		launchId: r.launchId as string,
		linkedAtMs: stamp(r.linkedAtMs, "linkedAtMs"),
		linkedBy: "operator",
		via: "workbench",
	};
}

function change(v: unknown): EndoDevelopStatusChangeV0 {
	const r = closed(v, ["atMs", "from", "to", "note"], "a status change");
	const from = nullable(r.from, (x) =>
		isEndoDevelopTaskStatusV0(x) ? x : bad("a status change names an unknown status"),
	);
	if (!isEndoDevelopTaskStatusV0(r.to)) bad("a status change names an unknown status");
	return {
		atMs: stamp(r.atMs, "atMs"),
		from,
		to: r.to as EndoDevelopTaskStatusV0,
		note: nullable(r.note, (x) => text(x, "note", "a status note")),
	};
}

function task(v: unknown): EndoDevelopTaskV0 {
	const r = closed(
		v,
		[
			"id",
			"projectId",
			"title",
			"description",
			"acceptance",
			"status",
			"createdAtMs",
			"updatedAtMs",
			"revision",
			"history",
			"sessions",
		],
		"a task",
	);
	if (typeof r.id !== "string" || !ENDO_TASK_ID_PATTERN_V0.test(r.id)) bad("a task has a bad id");
	if (typeof r.projectId !== "string" || !ENDO_PROJECT_ID_PATTERN_V0.test(r.projectId))
		bad("a task has a bad project id");
	if (!isEndoDevelopTaskStatusV0(r.status)) bad("a task has an unknown status");
	if (!Array.isArray(r.history) || r.history.length > ENDO_DEVELOP_TASK_LIMITS_V0.maxHistory)
		bad("a task's history is not a bounded list");
	if (!Array.isArray(r.sessions) || r.sessions.length > ENDO_DEVELOP_TASK_LIMITS_V0.maxSessions)
		bad("a task's sessions are not a bounded list");
	const sessions = (r.sessions as unknown[]).map(ref);
	if (new Set(sessions.map((s) => s.linkId)).size !== sessions.length) bad("a task repeats a session reference");
	return {
		id: r.id as string,
		projectId: r.projectId as string,
		title: text(r.title, "title", "a title"),
		description: text(r.description, "text", "a description"),
		acceptance: text(r.acceptance, "text", "acceptance criteria"),
		status: r.status as EndoDevelopTaskStatusV0,
		createdAtMs: stamp(r.createdAtMs, "createdAtMs"),
		updatedAtMs: stamp(r.updatedAtMs, "updatedAtMs"),
		revision: count(r.revision, "revision"),
		history: (r.history as unknown[]).map(change),
		sessions,
	};
}

function project(v: unknown): EndoDevelopProjectV0 {
	const r = closed(
		v,
		["id", "name", "path", "observedGitRoot", "createdAtMs", "updatedAtMs", "revision", "selectedTaskId"],
		"a project",
	);
	if (typeof r.id !== "string" || !ENDO_PROJECT_ID_PATTERN_V0.test(r.id)) bad("a project has a bad id");
	const path = (x: unknown): string => {
		if (
			typeof x !== "string" ||
			x.length === 0 ||
			x.length > ENDO_DEVELOP_TASK_LIMITS_V0.maxPath ||
			!x.startsWith("/") ||
			ONE_LINE_UNSAFE.test(x)
		)
			return bad("a project path is not an absolute path");
		return x;
	};
	return {
		id: r.id as string,
		name: text(r.name, "name", "a project name"),
		path: path(r.path),
		observedGitRoot: nullable(r.observedGitRoot, path),
		createdAtMs: stamp(r.createdAtMs, "createdAtMs"),
		updatedAtMs: stamp(r.updatedAtMs, "updatedAtMs"),
		revision: count(r.revision, "revision"),
		selectedTaskId: nullable(r.selectedTaskId, (x) =>
			typeof x === "string" && ENDO_TASK_ID_PATTERN_V0.test(x) ? x : bad("a project selects a bad task id"),
		),
	};
}

export function validateEndoDevelopTasksFileV0(value: unknown): EndoDevelopTasksFileV0 {
	const r = closed(value, ["schemaVersion", "revision", "projects", "tasks"], "the task file");
	const limits = ENDO_DEVELOP_TASK_LIMITS_V0;
	if (!Array.isArray(r.projects) || r.projects.length > limits.maxProjects)
		return bad("the projects are not a bounded list");
	if (!Array.isArray(r.tasks) || r.tasks.length > limits.maxTasks) return bad("the tasks are not a bounded list");
	const projects = (r.projects as unknown[]).map(project);
	const tasks = (r.tasks as unknown[]).map(task);
	if (new Set(projects.map((p) => p.id)).size !== projects.length) return bad("a project id repeats");
	if (new Set(tasks.map((t) => t.id)).size !== tasks.length) return bad("a task id repeats");
	const known = new Set(projects.map((p) => p.id));
	for (const t of tasks) if (!known.has(t.projectId)) return bad("a task belongs to a project that is not registered");
	for (const p of projects)
		if (p.selectedTaskId !== null && !tasks.some((t) => t.id === p.selectedTaskId && t.projectId === p.id))
			return bad("a project selects a task that is not its own");
	return { schemaVersion: ENDO_DEVELOP_TASKS_SCHEMA_V0, revision: count(r.revision, "revision"), projects, tasks };
}

/** The versions of the file this reader knows. An unknown version is refused whole: it is never read as the version it resembles. */
export const ENDO_DEVELOP_TASKS_VERSIONS_V0 = defineEndoVersionTableV0<EndoDevelopTasksFileV0>("endo.develop-tasks", [
	[ENDO_DEVELOP_TASKS_SCHEMA_V0, validateEndoDevelopTasksFileV0],
]);
export const readEndoDevelopTasksFileV0 = (value: unknown) =>
	readEndoVersionedV0(ENDO_DEVELOP_TASKS_VERSIONS_V0, value);

// ---- what the workbench shows -------------------------------------------------------------------------------------------------------

/** A reference as the page sees it. The page never gets the session id; it gets the cockpit's alias (a label, never a key) and the relation. */
export interface EndoDevelopSessionRefViewV0 {
	linkId: string;
	source: "pi-live";
	alias: string | null;
	attachment: string;
	launchId: string;
	linkedAtMs: number;
	linkedBy: "operator";
	/** `current`: made in THIS launch and the session is connected. `historical`: made in another launch, or the session is not connected; nothing connects it to the conversation shown now. */
	relation: "current" | "historical";
}

export interface EndoDevelopTaskViewV0 extends Omit<EndoDevelopTaskV0, "sessions"> {
	sessions: EndoDevelopSessionRefViewV0[];
	/** The statuses the operator may move it to from here. */
	next: EndoDevelopTaskStatusV0[];
}

/** Why the workspace is not ready. `unreadable` says the file was not used and was not changed. */
export const ENDO_DEVELOP_WORKSPACE_STATES_V0 = ["ready", "unknown-project", "unreadable"] as const;
export type EndoDevelopWorkspaceStateV0 = (typeof ENDO_DEVELOP_WORKSPACE_STATES_V0)[number];
export const ENDO_DEVELOP_UNREADABLE_REASONS_V0 = [
	"malformed",
	"unsupported-version",
	"invalid",
	"too-large",
	"unsafe-path",
	"io",
] as const;
export type EndoDevelopUnreadableReasonV0 = (typeof ENDO_DEVELOP_UNREADABLE_REASONS_V0)[number];

export interface EndoDevelopWorkspaceViewV0 {
	schemaVersion: typeof ENDO_DEVELOP_WORKSPACE_SCHEMA_V0;
	available: true;
	/** The workbench's own random launch id: a session reference is current only when it names this one. */
	launchId: string;
	state: EndoDevelopWorkspaceStateV0;
	reason: EndoDevelopUnreadableReasonV0 | null;
	revision: number;
	project: {
		id: string;
		name: string;
		/** The registered directory (configured). */
		path: string;
		/** What Git said the worktree root was at registration; compared on the page with what Git says now. */
		observedGitRoot: string | null;
		/** The registered directory against the directory this process was launched in: the same place, a different one, or the registered one is gone. */
		launch: "same" | "different" | "missing";
	} | null;
	/** Whether a change can be made now: the file is readable, the launch directory is the registered one, and the session is not over. */
	writable: boolean;
	/** Why not, in the page's words' key. */
	readOnlyReason: "unreadable" | "project-mismatch" | "project-missing" | "unknown-project" | null;
	/** Whether the workbench has a connected session a task could be linked to now. */
	linkable: boolean;
	tasks: EndoDevelopTaskViewV0[];
	selectedTaskId: string | null;
}

/** Without `--project` the workbench says so once, constantly, so a page can ask quietly. */
export const ENDO_DEVELOP_WORKSPACE_ABSENT_V0 = Object.freeze({
	available: false,
	schemaVersion: ENDO_DEVELOP_WORKSPACE_SCHEMA_V0,
});
