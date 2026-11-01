// The DEVELOP workspace service: the one application-level implementation of the operator's project and task operations, shared by every
// caller (the `endo` CLI, the Pi workbench's routes, and any later host). docs/develop-workspace-service.md is its decision record.
//
//   caller (CLI | workbench routes | a later host)
//        |   translates its own input (flags, an HTTP body) and its own refusals (text, a status code); authorises nothing here
//   DevelopWorkspaceServiceV0           operator scope: register a project, read, create a task, change a status
//        `-- forLaunch(config, host)    launch scope: one project, one launch directory, one launch's session facts
//   DevelopTasksStoreV0                 the lock, the atomic rewrite, validation, revisions, the transition rules (storage/develop-tasks.ts)
//   <root>/develop/tasks.json           endo.develop-tasks.v0, unchanged
//
// It is a TypeScript library: no process, no server, no browser, no model and no harness are needed to use it, and it imports nothing from any
// adapter. It is NOT an authentication boundary. Whoever holds an object of it may make the changes it offers; who may hold one is
// decided by its caller: the CLI is the operator's own process, and the workbench broker hands the launch scope only to a request that already
// carries its pairing grant. What this module does guarantee is that every caller gets the same rules, and that the facts that make a session
// reference true (the launch, the connected session, its source) come from the HOST that constructed the launch scope, never from the data of
// a request: no operation here takes a session id, a launch id, a path or a project id from the caller's request.
//
// What none of its operations can do: send a prompt, steer, queue or stop, start, resume or select a session, open, list or write a file
// other than the task file, run Git or a shell, or approve anything. (Registering a project asks the caller's own read-only Git observation.)

import { realpathSync, statSync } from "node:fs";
import {
	ENDO_DEVELOP_WORKSPACE_SCHEMA_V0,
	ENDO_LAUNCH_ID_PATTERN_V0,
	type EndoDevelopProjectV0,
	type EndoDevelopSessionRefV0,
	type EndoDevelopTasksFileV0,
	type EndoDevelopTaskV0,
	type EndoDevelopTaskViewV0,
	type EndoDevelopUnreadableReasonV0,
	type EndoDevelopWorkspaceViewV0,
	endoDevelopNextStatusesV0,
	isEndoDevelopSessionIdV0,
	isEndoDevelopSessionSourceV0,
} from "../../protocol/develop-tasks.ts";
import type { DevelopTasksStoreV0, EndoTasksRefusalV0, EndoTasksResultV0 } from "../../storage/develop-tasks.ts";

export type EndoDevelopReadOnlyReasonV0 = NonNullable<EndoDevelopWorkspaceViewV0["readOnlyReason"]>;

/**
 * Why an operation was refused. Nothing was written for any of them. The store's own refusals, plus:
 * - `read-only`: the launch scope cannot change this workspace now (`reason` says why: the file, the project, the directory).
 * - `no-session`: a link was asked for and the host has no connected session.
 * - `unsupported-source`: the host's sessions are of a source this version of the file cannot record.
 * - `unavailable`: the host's own facts are not well formed (an internal fault of the host, never the requester's).
 * - `not-a-directory`: a project was to be registered at a path that is not an existing directory.
 */
export type DevelopWorkspaceRefusalV0 =
	| EndoTasksRefusalV0
	| "read-only"
	| "no-session"
	| "unsupported-source"
	| "unavailable"
	| "not-a-directory";

export type DevelopWorkspaceResultV0<T> =
	| { ok: true; value: T }
	| {
			ok: false;
			code: DevelopWorkspaceRefusalV0;
			reason?: EndoDevelopUnreadableReasonV0 | EndoDevelopReadOnlyReasonV0;
	  };

/** What the operator configured for one launch: the project they named and the directory the process was launched in. */
export interface DevelopLaunchConfigV0 {
	projectId: string;
	launchDirectory: string;
}

/**
 * What only the host that runs the launch knows, read from its own state at the moment of each call. The service never asks a request for
 * any of these, and a host that cannot vouch for a fact says so (`session: null`) rather than guess it.
 */
export interface DevelopLaunchHostV0 {
	/** The host's own random id for this launch: a session reference is current only when it names this launch. */
	launchId: string;
	/** The attachment name the host's session belongs to (for example `pi.default`). */
	attachment: string;
	/**
	 * The host's session, if it has one: the source it speaks for, and the session connected now (its canonical id, from the host's own
	 * mapping), or null when none is. `session: null`: this host has no session it can vouch for, so nothing can be linked and every
	 * recorded reference is historical.
	 */
	session: { source: string; current(): { sessionId: string } | null } | null;
	/** The presented alias of a session id (a label for the page, never a key). */
	aliasOf?: (sessionId: string) => string;
}

export interface DevelopWorkspaceServiceOptionsV0 {
	/**
	 * What Git says the worktree root of a directory is, read-only, or null: supplied by the caller that registers projects (the CLI gives the
	 * existing Git project inspector), so this module reaches no adapter. Without it a registration records no observation (null).
	 */
	observeGitRoot?: (directory: string) => Promise<string | null>;
}

const realpath = (path: string): string | null => {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
};

const fromStore = <T>(result: EndoTasksResultV0<T>): DevelopWorkspaceResultV0<T> =>
	result.ok
		? { ok: true, value: result.value }
		: result.reason === undefined
			? { ok: false, code: result.code }
			: { ok: false, code: result.code, reason: result.reason };

/** Module-private: only `forLaunch` can open a launch scope, so a scope always comes from a service object. */
const OPEN: unique symbol = Symbol("develop-launch-scope");

/** The operator scope: what the operator's own process (the CLI) may do. A launch scope is made from it, for one project and one launch. */
export class DevelopWorkspaceServiceV0 {
	readonly #store: DevelopTasksStoreV0;
	readonly #observeGitRoot: (directory: string) => Promise<string | null>;

	constructor(store: DevelopTasksStoreV0, options: DevelopWorkspaceServiceOptionsV0 = {}) {
		this.#store = store;
		this.#observeGitRoot = options.observeGitRoot ?? (async () => null);
	}

	/** The whole file, read now; an unreadable file is a refusal with its closed reason (and it was not changed). */
	read(): DevelopWorkspaceResultV0<EndoDevelopTasksFileV0> {
		const read = this.#store.read();
		return read.ok ? { ok: true, value: read.file } : { ok: false, code: "unreadable", reason: read.reason };
	}

	/** One registered project's tasks. */
	tasks(projectId: string): DevelopWorkspaceResultV0<EndoDevelopTaskV0[]> {
		const read = this.read();
		if (!read.ok) return read;
		if (!read.value.projects.some((p) => p.id === projectId)) return { ok: false, code: "not-found" };
		return { ok: true, value: read.value.tasks.filter((t) => t.projectId === projectId) };
	}

	/** One task of one project. */
	task(projectId: string, taskId: string): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		const tasks = this.tasks(projectId);
		if (!tasks.ok) return tasks;
		const found = tasks.value.find((t) => t.id === taskId);
		return found === undefined ? { ok: false, code: "not-found" } : { ok: true, value: found };
	}

	/**
	 * Register a project: the operator's explicit statement that this directory is this project. The path is resolved to the place the system
	 * calls it and must be an existing directory; Git is asked once, read-only, what the worktree root there is (an observation, not a
	 * condition). The directory is not opened, listed or run, and the registration grants no access to anything.
	 */
	async registerProject(input: {
		name: string;
		path: string;
	}): Promise<DevelopWorkspaceResultV0<EndoDevelopProjectV0>> {
		let path: string;
		try {
			path = realpathSync(input.path);
			if (!statSync(path).isDirectory()) return { ok: false, code: "not-a-directory" };
		} catch {
			return { ok: false, code: "not-a-directory" };
		}
		const observedGitRoot = await this.#observeGitRoot(path);
		return fromStore(this.#store.registerProject({ name: input.name, path, observedGitRoot }));
	}

	createTask(
		projectId: string,
		input: { title: unknown; description?: unknown; acceptance?: unknown },
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return fromStore(this.#store.createTask(projectId, input));
	}

	/** The operator's own status change, against the revision they saw. The transition rules are the file's (protocol/develop-tasks.ts). */
	setStatus(
		projectId: string,
		taskId: string,
		expectedRevision: number,
		to: unknown,
		note?: unknown,
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return fromStore(this.#store.setStatus(projectId, taskId, expectedRevision, to, note));
	}

	/**
	 * The launch scope for one project and one launch. `config` is what the operator configured; `host` is what the host running the launch
	 * knows. The scope can change only that project, and only while the launch directory is the project's registered one.
	 */
	forLaunch(config: DevelopLaunchConfigV0, host: DevelopLaunchHostV0): DevelopLaunchWorkspaceV0 {
		return new DevelopLaunchWorkspaceV0(OPEN, this.#store, config, host);
	}
}

/**
 * The launch scope: one registered project, as seen from one launch. It cannot register a project or reach another project's tasks, and
 * it holds no session: it asks its host, at each call, which session is connected now.
 */
export class DevelopLaunchWorkspaceV0 {
	readonly #store: DevelopTasksStoreV0;
	readonly #config: Readonly<DevelopLaunchConfigV0>;
	readonly #host: DevelopLaunchHostV0;

	/** Opened only by `DevelopWorkspaceServiceV0.forLaunch`: the token is private to this module. */
	constructor(
		token: typeof OPEN,
		store: DevelopTasksStoreV0,
		config: DevelopLaunchConfigV0,
		host: DevelopLaunchHostV0,
	) {
		if (token !== OPEN) throw new TypeError("a launch scope is opened by DevelopWorkspaceServiceV0.forLaunch");
		this.#store = store;
		this.#config = Object.freeze({ ...config });
		this.#host = host;
	}

	/** The connected session, when the host speaks for a source this file can record. */
	#connected(): { source: EndoDevelopSessionRefV0["source"]; sessionId: string } | null {
		const session = this.#host.session;
		if (session === null || !isEndoDevelopSessionSourceV0(session.source)) return null;
		const now = session.current();
		return now === null ? null : { source: session.source, sessionId: now.sessionId };
	}

	/** The workspace as a launch sees it, read from the file now: `endo.develop-workspace.v0`. */
	view(): EndoDevelopWorkspaceViewV0 {
		const base = {
			schemaVersion: ENDO_DEVELOP_WORKSPACE_SCHEMA_V0 as typeof ENDO_DEVELOP_WORKSPACE_SCHEMA_V0,
			available: true as const,
			launchId: this.#host.launchId,
		};
		const closed = {
			project: null,
			writable: false,
			linkable: false,
			tasks: [],
			selectedTaskId: null,
		};
		const read = this.#store.read();
		if (!read.ok)
			return {
				...base,
				state: "unreadable",
				reason: read.reason,
				revision: 0,
				readOnlyReason: "unreadable",
				...closed,
			};
		const project = read.file.projects.find((p) => p.id === this.#config.projectId);
		if (project === undefined)
			return {
				...base,
				state: "unknown-project",
				reason: null,
				revision: read.file.revision,
				readOnlyReason: "unknown-project",
				...closed,
			};
		const launch = this.#launchRelation(project);
		const connected = this.#connected();
		const writable = launch === "same";
		return {
			...base,
			state: "ready",
			reason: null,
			revision: read.file.revision,
			project: {
				id: project.id,
				name: project.name,
				path: project.path,
				observedGitRoot: project.observedGitRoot,
				launch,
			},
			writable,
			readOnlyReason: writable ? null : launch === "missing" ? "project-missing" : "project-mismatch",
			linkable: writable && connected !== null,
			tasks: read.file.tasks.filter((t) => t.projectId === project.id).map((t) => this.#taskView(t, connected)),
			selectedTaskId: project.selectedTaskId,
		};
	}

	/**
	 * Null when a change may be made now, or the refusal that every change would get: the file is unreadable, the project is not
	 * registered, or the launch directory is not the registered one. A caller may ask before it even reads its request.
	 */
	writeRefusal(): DevelopWorkspaceResultV0<never> | null {
		const view = this.view();
		return view.writable ? null : { ok: false, code: "read-only", reason: view.readOnlyReason ?? "unreadable" };
	}

	/** The registered directory against the launch directory (links resolved on both sides, at this moment). Exact equality. */
	#launchRelation(project: EndoDevelopProjectV0): "same" | "different" | "missing" {
		const registered = realpath(project.path);
		if (registered === null) return "missing";
		return realpath(this.#config.launchDirectory) === registered ? "same" : "different";
	}

	#taskView(
		task: EndoDevelopTaskV0,
		connected: { source: EndoDevelopSessionRefV0["source"]; sessionId: string } | null,
	): EndoDevelopTaskViewV0 {
		const launchId = this.#host.launchId;
		return {
			...task,
			next: [...endoDevelopNextStatusesV0(task.status)],
			sessions: task.sessions.map((s) => ({
				linkId: s.linkId,
				source: s.source,
				alias: this.#host.aliasOf?.(s.sessionId) ?? null,
				attachment: s.attachment,
				launchId: s.launchId,
				linkedAtMs: s.linkedAtMs,
				linkedBy: s.linkedBy,
				// Current only if the reference was made in THIS launch, to the session of the same source connected now. A session id can
				// survive a restart; the launch cannot, so a reference from another launch is a historical claim whatever the ids say.
				relation:
					connected !== null &&
					s.launchId === launchId &&
					s.source === connected.source &&
					s.sessionId === connected.sessionId
						? "current"
						: "historical",
			})),
		};
	}

	/** Every change: refused whole unless the workspace is writable now, then made by the store against a fresh read of the file. */
	#change<T>(make: (projectId: string) => EndoTasksResultV0<T>): DevelopWorkspaceResultV0<T> {
		const refused = this.writeRefusal();
		if (refused !== null) return refused;
		return fromStore(make(this.#config.projectId));
	}

	/** Add a task to this project. `select`: creating and choosing it is one act and one write. */
	createTask(
		input: { title: unknown; description?: unknown; acceptance?: unknown },
		options: { select?: boolean } = {},
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return this.#change((projectId) => this.#store.createTask(projectId, input, options));
	}

	updateTask(
		taskId: string,
		expectedRevision: number,
		patch: { title?: unknown; description?: unknown; acceptance?: unknown },
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return this.#change((projectId) => this.#store.updateTask(projectId, taskId, expectedRevision, patch));
	}

	setStatus(
		taskId: string,
		expectedRevision: number,
		to: unknown,
		note?: unknown,
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return this.#change((projectId) => this.#store.setStatus(projectId, taskId, expectedRevision, to, note));
	}

	selectTask(taskId: string | null): DevelopWorkspaceResultV0<EndoDevelopProjectV0> {
		return this.#change((projectId) => this.#store.selectTask(projectId, taskId));
	}

	/**
	 * Link the task to the session connected NOW, as the host reports it. The caller names only the task and the revision it saw; the
	 * reference (source, session id, attachment, launch) is built here from the host's facts. A reference grants nothing: it is not a handle
	 * to the session and nothing reads it to control one.
	 */
	linkCurrentSession(taskId: string, expectedRevision: number): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		const refused = this.writeRefusal();
		if (refused !== null) return refused;
		const session = this.#host.session;
		if (session !== null && !isEndoDevelopSessionSourceV0(session.source))
			return { ok: false, code: "unsupported-source" };
		const connected = this.#connected();
		if (connected === null) return { ok: false, code: "no-session" };
		if (
			!ENDO_LAUNCH_ID_PATTERN_V0.test(this.#host.launchId) ||
			!isEndoDevelopSessionIdV0(connected.source, connected.sessionId)
		)
			return { ok: false, code: "unavailable" };
		const ref: Omit<EndoDevelopSessionRefV0, "linkId" | "linkedAtMs"> = {
			source: connected.source,
			sessionId: connected.sessionId,
			attachment: this.#host.attachment,
			launchId: this.#host.launchId,
			linkedBy: "operator",
			// v0 records exactly one way a reference is made; a later host's own `via` belongs to a later version of the file.
			via: "workbench",
		};
		return fromStore(this.#store.linkSession(this.#config.projectId, taskId, expectedRevision, ref));
	}

	unlinkSession(
		taskId: string,
		expectedRevision: number,
		linkId: string,
	): DevelopWorkspaceResultV0<EndoDevelopTaskV0> {
		return this.#change((projectId) => this.#store.unlinkSession(projectId, taskId, expectedRevision, linkId));
	}
}
