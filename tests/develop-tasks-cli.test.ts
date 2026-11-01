// `endo project add|list` and `endo task list|add|status` as real processes, and the refusals of `harness attach --project`. A temporary store
// root and a temporary project directory; no Pi, no model, no network.
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../cli/index.ts", import.meta.url));
const base = realpathSync(mkdtempSync(join(tmpdir(), "endo-tasks-cli-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const endo = (args: string[], cwd = base) =>
	spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: base } });
const fresh = (name: string) => {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	return dir;
};
const json = (text: string) => JSON.parse(text) as Record<string, any>;

describe("endo project", () => {
	const root = fresh("store-a");
	const project = fresh("project-a");
	let id = "";

	it("registers a directory only when it is named, and prints the id and how to use it", () => {
		const added = endo(["project", "add", root, "--name", "Parser", "--path", project]);
		expect(added.status, added.stderr).toBe(0);
		const out = json(added.stdout);
		id = out.project.id;
		expect(out.project).toMatchObject({ name: "Parser", path: project, revision: 0, selectedTaskId: null });
		expect(id).toMatch(/^endo\.project\.[0-9a-f]{32}$/);
		// Not a repository: Git was asked and nothing was recorded, which is not a failure.
		expect(out.project.observedGitRoot).toBeNull();
		expect(added.stderr).toContain(`--project ${id}`);
		// The launch-directory rule is said when the project is registered.
		expect(added.stderr).toContain("exactly this directory");
		expect(readdirSync(root)).toEqual(["develop"]);
	});

	it("resolves links, so the project is the place and not a spelling of it", () => {
		const link = join(base, "link-to-project-b");
		const target = fresh("project-b");
		symlinkSync(target, link);
		const added = endo(["project", "add", fresh("store-b"), "--name", "Linked", "--path", link]);
		expect(added.status, added.stderr).toBe(0);
		expect(json(added.stdout).project.path).toBe(target);
	});

	it("refuses a duplicate, a missing path, a file, a missing name, and an unknown flag, and writes nothing for them", () => {
		const before = readFileSync(join(root, "develop", "tasks.json"), "utf8");
		const refused = [
			endo(["project", "add", root, "--name", "Again", "--path", project]),
			endo(["project", "add", root, "--name", "Gone", "--path", join(base, "missing")]),
			endo(["project", "add", root, "--name", "File", "--path", join(project, "no-such")]),
			endo(["project", "add", root, "--path", project]),
			endo(["project", "add", root, "--name", "x"]),
			endo(["project", "add", root, "--name", "x", "--path", project, "--cwd", project]),
			endo(["project", "add", root, "--name", "x\u0007bell", "--path", fresh("project-c")]),
		];
		for (const run of refused) {
			expect(run.status).toBe(1);
			expect(run.stdout).toBe("");
		}
		expect(refused[0]?.stderr).toContain("already registered");
		expect(refused[1]?.stderr).toContain("existing directory");
		expect(readFileSync(join(root, "develop", "tasks.json"), "utf8")).toBe(before);
		// A path that is a file is not a directory.
		const file = join(base, "a-file");
		writeFileSync(file, "x");
		expect(endo(["project", "add", root, "--name", "f", "--path", file]).stderr).toContain("existing directory");
	});

	it("lists projects with a count of tasks per status, and never their text", () => {
		endo(["task", "add", root, "--project", id, "--title", "SECRET-TITLE-9f3", "--description", "SECRET-BODY"]);
		const listed = endo(["project", "list", root]);
		expect(listed.status, listed.stderr).toBe(0);
		const out = json(listed.stdout);
		expect(out.projects[0].tasks).toEqual({ open: 1, "in-progress": 0, blocked: 0, review: 0, done: 0 });
		expect(listed.stdout).not.toContain("SECRET");
	});
});

describe("endo task", () => {
	const root = fresh("store-t");
	const dir = fresh("project-t");
	const id = json(endo(["project", "add", root, "--name", "T", "--path", dir]).stdout).project.id as string;

	it("adds, lists and moves a task with explicit statuses and the revision it read", () => {
		const added = endo([
			"task",
			"add",
			root,
			"--project",
			id,
			"--title",
			"Write the docs",
			"--acceptance",
			"reads well",
		]);
		expect(added.status, added.stderr).toBe(0);
		const task = json(added.stdout).task;
		expect(task).toMatchObject({ title: "Write the docs", status: "open", revision: 0 });
		const moved = endo([
			"task",
			"status",
			root,
			"--project",
			id,
			"--task",
			task.id,
			"--to",
			"in-progress",
			"--note",
			"started",
		]);
		expect(moved.status, moved.stderr).toBe(0);
		expect(json(moved.stdout).task).toMatchObject({ status: "in-progress", revision: 1 });
		const listed = json(endo(["task", "list", root, "--project", id]).stdout);
		expect(listed.tasks.map((t: { title: string; status: string }) => [t.title, t.status])).toEqual([
			["Write the docs", "in-progress"],
		]);
		// A stale revision is refused, as a page's would be.
		const stale = endo([
			"task",
			"status",
			root,
			"--project",
			id,
			"--task",
			task.id,
			"--to",
			"review",
			"--revision",
			"0",
		]);
		expect(stale.status).toBe(1);
		expect(stale.stderr).toContain("changed since that revision");
	});

	it("refuses a status that is not a next step, one that does not exist, and a project or task that is not there", () => {
		const [task] = json(endo(["task", "list", root, "--project", id]).stdout).tasks as { id: string }[];
		for (const to of ["done", "finished", ""]) {
			const run = endo(["task", "status", root, "--project", id, "--task", task!.id, "--to", to]);
			expect(run.status).toBe(1);
		}
		expect(endo(["task", "list", root, "--project", `endo.project.${"0".repeat(32)}`]).stderr).toContain(
			"no such project",
		);
		expect(
			endo(["task", "status", root, "--project", id, "--task", `endo.task.${"0".repeat(32)}`, "--to", "blocked"])
				.status,
		).toBe(1);
		expect(endo(["task", "add", root, "--project", id, "--title", ""]).status).toBe(1);
		expect(endo(["task", "add", root, "--project", id]).status).toBe(1);
	});

	it("says a damaged file is unusable and leaves it exactly as it was", () => {
		const damaged = fresh("store-d");
		const where = fresh("project-d");
		const made = json(endo(["project", "add", damaged, "--name", "D", "--path", where]).stdout).project.id as string;
		const file = join(damaged, "develop", "tasks.json");
		writeFileSync(file, "{ torn");
		for (const args of [
			["task", "add", damaged, "--project", made, "--title", "x"],
			["task", "list", damaged, "--project", made],
			["project", "list", damaged],
			["project", "add", damaged, "--name", "E", "--path", fresh("project-e")],
		]) {
			const run = endo(args);
			expect(run.status, args.join(" ")).toBe(1);
			expect(run.stderr).toContain("cannot be used");
		}
		expect(readFileSync(file, "utf8")).toBe("{ torn");
	});
});

describe("the command families", () => {
	it("are usage errors without a subcommand or with an inherited property name", () => {
		for (const family of ["project", "task"])
			for (const sub of [undefined, "constructor", "toString", "__proto__"]) {
				const run = endo(sub === undefined ? [family] : [family, sub]);
				expect(run.status, `${family} ${sub}`).toBe(1);
				expect(run.stderr).toMatch(new RegExp(`usage: endo ${family}`));
			}
		expect(endo(["--help"]).stdout).toContain("project add");
	});
});

describe("endo harness attach --project", () => {
	it("belongs to the workbench and takes a project id, and is refused before anything starts otherwise", () => {
		const root = fresh("store-h");
		const withoutBench = endo([
			"harness",
			"attach",
			root,
			"--control",
			"--project",
			`endo.project.${"a".repeat(32)}`,
		]);
		expect(withoutBench.status).toBe(1);
		expect(withoutBench.stderr).toContain("--project belongs to the workbench");
		// The flag belongs to attach alone: the other harness commands still refuse it as unknown.
		for (const command of ["status", "check", "identify", "overview"]) {
			const run = endo(["harness", command, root, "--project", `endo.project.${"a".repeat(32)}`]);
			expect(run.status, command).toBe(1);
			expect(run.stderr, command).toContain("unknown flag --project");
		}
		// A malformed id is refused before the terminal is even asked about.
		const malformed = endo(["harness", "attach", root, "--control", "--workbench", "--project", "parser"]);
		expect(malformed.status).toBe(1);
		expect(malformed.stderr).toContain("--project is a project id");
		expect(readdirSync(root)).toEqual([]);
	});
});
