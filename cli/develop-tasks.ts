/**
 * `endo project add|list` and `endo task list|add|status`: the operator's own metadata about their work, kept in the store root's
 * `develop/tasks.json` (storage/develop-tasks.ts). These commands are the only way to REGISTER a project, and the way to read and edit tasks
 * when no workbench is attached (a workbench page can change tasks only while it is paired to a live session).
 *
 * Registering a project is an explicit statement: "this directory is this project". The directory is named with --path (there is no default,
 * so no registration happens by being somewhere), resolved to the place the system calls it, and must be an existing directory. It is not
 * opened, searched or run; Git is asked once, read-only, what the worktree root there is, and the answer is kept as an observation. The
 * registration grants no access to anything: a workbench uses the project only when it is started with `--project <id>` from that directory.
 *
 * Nothing here talks to Pi, a model, the event store or the network, and no command sends a prompt or changes a worktree.
 */
import { realpathSync, statSync } from "node:fs";
import { GitProjectInspectorV0 } from "../adapters/git/project-inspector.ts";
import {
	ENDO_DEVELOP_TASK_STATUSES_V0,
	type EndoDevelopTasksFileV0,
	type EndoDevelopTaskV0,
} from "../protocol/develop-tasks.ts";
import { canonicalEndoJsonV0 } from "../runtime/contracts/canonical-json.ts";
import { DevelopTasksStoreV0, type EndoTasksResultV0 } from "../storage/develop-tasks.ts";
import { announceEndoRootV0, takeEndoRootV0 } from "./root-args.ts";

const PROJECT_USAGE =
	"usage: endo project add [<root> | --root dir] --name <name> --path <directory> | endo project list [<root> | --root dir]";
const TASK_USAGE =
	"usage: endo task list [<root> | --root dir] --project <id> | endo task add ... --project <id> --title <t> [--description <d>] [--acceptance <a>] | endo task status ... --project <id> --task <id> --to <status> [--note <n>] [--revision n]";

const REFUSALS: Readonly<Record<string, string>> = {
	"not-found": "no such project or task in this store",
	"stale-revision": "the task changed since that revision; read it again",
	"invalid-transition": "that status change is not allowed from the task's current status",
	"bad-request": "the input was not acceptable (check lengths, control characters and the status name)",
	limit: "a limit of the task store was reached (see docs/develop-tasks.md)",
	duplicate: "that directory is already registered as a project",
	unreadable: "the task file exists but cannot be used; it was not changed",
	busy: "another process is writing the task file; try again",
	"storage-failed": "the task file could not be written; nothing was changed",
};

function flagsOf(argv: readonly string[], values: readonly string[], usage: string, positionals = 0) {
	const taken = takeEndoRootV0(argv, positionals, new Set(values));
	const flags = new Map<string, string>();
	const rest = [...taken.rest];
	while (rest.length > 0) {
		const flag = rest.shift() as string;
		if (!flag.startsWith("--") || !values.includes(flag)) throw new TypeError(usage);
		const value = rest.shift();
		if (value === undefined) throw new TypeError(`the flag ${flag} needs a value`);
		if (flags.has(flag)) throw new TypeError(`${flag} was given more than once`);
		flags.set(flag, value);
	}
	announceEndoRootV0(taken);
	return { root: taken.root, flags };
}

function unwrap<T>(result: EndoTasksResultV0<T>): T {
	if (result.ok) return result.value;
	const why = result.reason === undefined ? "" : ` (${result.reason})`;
	throw new Error(`${REFUSALS[result.code] ?? result.code}${why}`);
}

const print = (value: unknown): void => {
	process.stdout.write(`${canonicalEndoJsonV0(value as never)}\n`);
};

function readFile(store: DevelopTasksStoreV0): EndoDevelopTasksFileV0 {
	const read = store.read();
	if (!read.ok) throw new Error(`the task file cannot be used (${read.reason}); it was not changed`);
	return read.file;
}

async function projectAdd(argv: readonly string[]): Promise<void> {
	const { root, flags } = flagsOf(argv, ["--name", "--path"], PROJECT_USAGE);
	const name = flags.get("--name");
	const given = flags.get("--path");
	if (name === undefined || given === undefined) throw new TypeError(PROJECT_USAGE);
	let path: string;
	try {
		path = realpathSync(given);
		if (!statSync(path).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error("--path must be an existing directory");
	}
	// What Git says the worktree root is there, read-only, as an observation to compare later. Not finding one is not a failure.
	const inspector = new GitProjectInspectorV0({ cwd: path });
	let observedGitRoot: string | null = null;
	try {
		const overview = await inspector.overview();
		observedGitRoot = overview.state === "ready" && overview.repository !== null ? overview.repository.root : null;
	} finally {
		inspector.dispose();
	}
	const project = unwrap(new DevelopTasksStoreV0(root).registerProject({ name, path, observedGitRoot }));
	print({ project });
	process.stderr.write(
		`registered. Start a workbench for it from that directory with: endo harness attach --root ${root} --cwd ${path} --control --workbench --project ${project.id}\nthe workbench may change this project's tasks only when launched in exactly this directory (${path}); from a subdirectory or elsewhere it shows them read-only. Register the subdirectory instead if that is where you work.\n`,
	);
}

function projectList(argv: readonly string[]): void {
	const { root } = flagsOf(argv, [], PROJECT_USAGE);
	const file = readFile(new DevelopTasksStoreV0(root));
	print({
		revision: file.revision,
		projects: file.projects.map((p) => ({
			id: p.id,
			name: p.name,
			path: p.path,
			observedGitRoot: p.observedGitRoot,
			tasks: Object.fromEntries(
				ENDO_DEVELOP_TASK_STATUSES_V0.map((s) => [
					s,
					file.tasks.filter((t) => t.projectId === p.id && t.status === s).length,
				]),
			),
		})),
	});
}

const summary = (t: EndoDevelopTaskV0) => ({
	id: t.id,
	title: t.title,
	status: t.status,
	revision: t.revision,
	updatedAtMs: t.updatedAtMs,
	sessionReferences: t.sessions.length,
});

function taskList(argv: readonly string[]): void {
	const { root, flags } = flagsOf(argv, ["--project"], TASK_USAGE);
	const project = flags.get("--project");
	if (project === undefined) throw new TypeError(TASK_USAGE);
	const file = readFile(new DevelopTasksStoreV0(root));
	if (!file.projects.some((p) => p.id === project)) throw new Error(REFUSALS["not-found"]);
	print({ tasks: file.tasks.filter((t) => t.projectId === project).map(summary) });
}

function taskAdd(argv: readonly string[]): void {
	const { root, flags } = flagsOf(argv, ["--project", "--title", "--description", "--acceptance"], TASK_USAGE);
	const project = flags.get("--project");
	const title = flags.get("--title");
	if (project === undefined || title === undefined) throw new TypeError(TASK_USAGE);
	const task = unwrap(
		new DevelopTasksStoreV0(root).createTask(project, {
			title,
			description: flags.get("--description"),
			acceptance: flags.get("--acceptance"),
		}),
	);
	print({ task: summary(task) });
}

function taskStatus(argv: readonly string[]): void {
	const { root, flags } = flagsOf(argv, ["--project", "--task", "--to", "--note", "--revision"], TASK_USAGE);
	const project = flags.get("--project");
	const taskId = flags.get("--task");
	const to = flags.get("--to");
	if (project === undefined || taskId === undefined || to === undefined) throw new TypeError(TASK_USAGE);
	const store = new DevelopTasksStoreV0(root);
	let revision: number;
	if (flags.has("--revision")) {
		const given = flags.get("--revision") as string;
		if (!/^(0|[1-9][0-9]{0,9})$/.test(given)) throw new TypeError("--revision is a non-negative integer");
		revision = Number(given);
	} else {
		const found = readFile(store).tasks.find((t) => t.id === taskId && t.projectId === project);
		if (found === undefined) throw new Error(REFUSALS["not-found"]);
		revision = found.revision;
	}
	print({ task: summary(unwrap(store.setStatus(project, taskId, revision, to, flags.get("--note")))) });
}

export const PROJECT_COMMANDS_V0: Record<string, (argv: readonly string[]) => void | Promise<void>> = {
	add: projectAdd,
	list: projectList,
};
export const TASK_COMMANDS_V0: Record<string, (argv: readonly string[]) => void | Promise<void>> = {
	list: taskList,
	add: taskAdd,
	status: taskStatus,
};
