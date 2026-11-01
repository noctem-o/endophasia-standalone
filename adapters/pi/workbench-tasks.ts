// The workbench's task routes: the operator's project and task metadata, served to a PAIRED page and nothing else. This module is part of
// the broker's request surface (adapters/pi/workbench.ts forwards the routes below to it AFTER its grant check), and it is deliberately
// the opposite of a command surface:
//
//   GET  workspace                      the registered project, its tasks and the explicit session references. Needs the grant.
//   POST workspace/tasks/create         {title, description?, acceptance?}              add a task (and select it).
//   POST workspace/tasks/update         {taskId, expectedRevision, title?, description?, acceptance?}
//   POST workspace/tasks/status         {taskId, expectedRevision, to, note?}           the operator's own status change.
//   POST workspace/tasks/select         {taskId | null}                                 remember which task they are working on.
//   POST workspace/tasks/link-session   {taskId, expectedRevision}                      reference the session THIS workbench serves.
//   POST workspace/tasks/unlink-session {taskId, expectedRevision, linkId}
//
// What none of them can do: send a prompt, steer, queue or stop, start or resume or select a session, open or write a file, run Git or a
// shell, read the transcript, or approve anything. A task's text is never used to choose a file, a tool or a command; the project's
// registered path is compared with the launch directory and is otherwise only shown. The terminal approval and the pairing grant that govern
// runtime interventions are unchanged, and this metadata is not a second approval mechanism.
//
// The project is the one the OPERATOR registered (`endo project add`) and named for this launch (`--project`). The page names a task by id
// and a revision; it never names a project, a path, a session or a launch. A session reference is built here, from the broker's own state.

import { realpathSync } from "node:fs";
import {
	ENDO_DEVELOP_WORKSPACE_SCHEMA_V0,
	ENDO_LAUNCH_ID_PATTERN_V0,
	type EndoDevelopProjectV0,
	type EndoDevelopSessionRefV0,
	type EndoDevelopTaskV0,
	type EndoDevelopTaskViewV0,
	type EndoDevelopWorkspaceViewV0,
	endoDevelopNextStatusesV0,
} from "../../protocol/develop-tasks.ts";
import type { DevelopTasksStoreV0, EndoTasksRefusalV0, EndoTasksResultV0 } from "../../storage/develop-tasks.ts";

export interface WorkbenchTasksOptionsV0 {
	store: DevelopTasksStoreV0;
	/** The project the operator named for this launch (`--project`). The page cannot change it. */
	projectId: string;
	/** The working directory the attached process was launched in (the same one the Git context reads). */
	launchDirectory: string;
	launchId: string;
	attachment: string;
	/** The connected session, from the broker's own state: null when there is none or the workbench is over. */
	connected(): { sessionId: string } | null;
	aliasOf?: (sessionId: string) => string;
}

const reply = (status: number, body: unknown) => ({ status, body });
const refuse = (status: number, error: string) => reply(status, { error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The body has exactly the keys it must and may have, and no others. */
function keysOk(body: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const keys = Object.keys(body);
	return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

const HTTP: Record<EndoTasksRefusalV0, [number, string]> = {
	"not-found": [404, "not-found"],
	"stale-revision": [409, "stale-revision"],
	"invalid-transition": [409, "invalid-transition"],
	"bad-request": [400, "bad-request"],
	limit: [409, "limit-reached"],
	duplicate: [409, "duplicate"],
	unreadable: [409, "unreadable"],
	busy: [503, "busy"],
	"storage-failed": [503, "storage-failed"],
};

const realpath = (path: string): string | null => {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
};

export class WorkbenchTasksV0 {
	readonly #o: WorkbenchTasksOptionsV0;

	constructor(options: WorkbenchTasksOptionsV0) {
		this.#o = options;
	}

	/** The workspace as the page sees it, read from the file now. */
	view(): EndoDevelopWorkspaceViewV0 {
		const o = this.#o;
		const base = {
			schemaVersion: ENDO_DEVELOP_WORKSPACE_SCHEMA_V0 as typeof ENDO_DEVELOP_WORKSPACE_SCHEMA_V0,
			available: true as const,
			launchId: o.launchId,
		};
		const read = o.store.read();
		if (!read.ok)
			return {
				...base,
				state: "unreadable",
				reason: read.reason,
				revision: 0,
				project: null,
				writable: false,
				readOnlyReason: "unreadable",
				linkable: false,
				tasks: [],
				selectedTaskId: null,
			};
		const project = read.file.projects.find((p) => p.id === o.projectId);
		if (project === undefined)
			return {
				...base,
				state: "unknown-project",
				reason: null,
				revision: read.file.revision,
				project: null,
				writable: false,
				readOnlyReason: "unknown-project",
				linkable: false,
				tasks: [],
				selectedTaskId: null,
			};
		const launch = this.#launchRelation(project);
		const connected = o.connected();
		// The grant that reaches this route ends with the session (adapters/pi/workbench.ts), so "over" is never answered here.
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
			tasks: read.file.tasks
				.filter((t) => t.projectId === project.id)
				.map((t) => this.#taskView(t, connected?.sessionId ?? null)),
			selectedTaskId: project.selectedTaskId,
		};
	}

	/** The registered directory against the directory this process was launched in (links resolved on both sides, at this moment). */
	#launchRelation(project: EndoDevelopProjectV0): "same" | "different" | "missing" {
		const registered = realpath(project.path);
		if (registered === null) return "missing";
		const launched = realpath(this.#o.launchDirectory);
		return launched === registered ? "same" : "different";
	}

	#taskView(task: EndoDevelopTaskV0, connectedSession: string | null): EndoDevelopTaskViewV0 {
		const o = this.#o;
		return {
			...task,
			next: [...endoDevelopNextStatusesV0(task.status)],
			sessions: task.sessions.map((s) => ({
				linkId: s.linkId,
				source: s.source,
				alias: o.aliasOf?.(s.sessionId) ?? null,
				attachment: s.attachment,
				launchId: s.launchId,
				linkedAtMs: s.linkedAtMs,
				linkedBy: s.linkedBy,
				// Current only if the reference was made in THIS launch, to the session connected now. A Pi session id can survive a
				// restart; the launch cannot, so a reference from another launch is a historical claim whatever the ids say.
				relation:
					s.launchId === o.launchId && connectedSession !== null && s.sessionId === connectedSession
						? "current"
						: "historical",
			})),
		};
	}

	/** A route under `workspace/`. The broker has already checked the grant. */
	handle(
		route: readonly string[],
		method: "GET" | "POST",
		query: string,
		body: unknown,
	): { status: number; body: unknown } {
		const [, a, b, ...more] = route;
		if (method === "GET") {
			if (a !== undefined || query !== "")
				return refuse(a === undefined ? 400 : 404, a === undefined ? "bad-request" : "not-found");
			return reply(200, this.view());
		}
		if (a !== "tasks" || b === undefined || more.length > 0 || query !== "") return refuse(404, "not-found");
		if (!isRecord(body)) return refuse(400, "bad-request");
		const view = this.view();
		// Reading is allowed in every state; changing is allowed only when the file is readable, the project is the one this process was
		// launched in, and the workbench is not over. A stale or mismatched association never writes.
		if (!view.writable) return reply(409, { error: "read-only", reason: view.readOnlyReason });
		const o = this.#o;
		const projectId = o.projectId;
		const done = <T>(result: EndoTasksResultV0<T>) => {
			if (result.ok) return reply(200, this.view());
			const [status, error] = HTTP[result.code];
			return reply(status, result.reason === undefined ? { error } : { error, reason: result.reason });
		};
		const revisionOf = (v: unknown): number =>
			typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : Number.NaN;
		const taskOf = (v: unknown): string | null => (typeof v === "string" ? v : null);
		switch (b) {
			case "create": {
				if (!keysOk(body, ["title"], ["description", "acceptance"])) return refuse(400, "bad-request");
				return done(
					o.store.createTask(
						projectId,
						{ title: body.title, description: body.description, acceptance: body.acceptance },
						{ select: true },
					),
				);
			}
			case "update": {
				if (!keysOk(body, ["taskId", "expectedRevision"], ["title", "description", "acceptance"]))
					return refuse(400, "bad-request");
				const id = taskOf(body.taskId);
				if (id === null) return refuse(400, "bad-request");
				return done(
					o.store.updateTask(projectId, id, revisionOf(body.expectedRevision), {
						title: body.title,
						description: body.description,
						acceptance: body.acceptance,
					}),
				);
			}
			case "status": {
				if (!keysOk(body, ["taskId", "expectedRevision", "to"], ["note"])) return refuse(400, "bad-request");
				const id = taskOf(body.taskId);
				if (id === null) return refuse(400, "bad-request");
				return done(o.store.setStatus(projectId, id, revisionOf(body.expectedRevision), body.to, body.note));
			}
			case "select": {
				if (!keysOk(body, ["taskId"])) return refuse(400, "bad-request");
				if (body.taskId !== null && typeof body.taskId !== "string") return refuse(400, "bad-request");
				return done(o.store.selectTask(projectId, body.taskId));
			}
			case "link-session": {
				if (!keysOk(body, ["taskId", "expectedRevision"])) return refuse(400, "bad-request");
				const id = taskOf(body.taskId);
				const connected = o.connected();
				// Nothing is linked to a session that is not connected, and nothing the page said describes the session.
				if (id === null) return refuse(400, "bad-request");
				if (connected === null) return refuse(409, "no-session");
				if (!ENDO_LAUNCH_ID_PATTERN_V0.test(o.launchId)) return refuse(503, "unavailable");
				const ref: Omit<EndoDevelopSessionRefV0, "linkId" | "linkedAtMs"> = {
					source: "pi-live",
					sessionId: connected.sessionId,
					attachment: o.attachment,
					launchId: o.launchId,
					linkedBy: "operator",
					via: "workbench",
				};
				return done(o.store.linkSession(projectId, id, revisionOf(body.expectedRevision), ref));
			}
			case "unlink-session": {
				if (!keysOk(body, ["taskId", "expectedRevision", "linkId"])) return refuse(400, "bad-request");
				const id = taskOf(body.taskId);
				if (id === null || typeof body.linkId !== "string") return refuse(400, "bad-request");
				return done(o.store.unlinkSession(projectId, id, revisionOf(body.expectedRevision), body.linkId));
			}
			default:
				return refuse(404, "not-found");
		}
	}
}
