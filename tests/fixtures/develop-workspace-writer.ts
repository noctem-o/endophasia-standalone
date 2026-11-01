// A child process for the service's concurrency test: it creates N tasks through the workspace service, through either the operator scope
// (as the CLI does) or a launch scope (as the workbench does), each with its own store object, as a second process would.
// It reports "ready" once it is loaded, then waits for the go-file before its first write, so that every writer starts together.
import { existsSync } from "node:fs";
import { DevelopWorkspaceServiceV0 } from "../../runtime/contracts/develop-workspace.ts";
import { DevelopTasksStoreV0 } from "../../storage/develop-tasks.ts";

const [root, projectId, directory, scope, tag, count, go] = process.argv.slice(2) as [
	string,
	string,
	string,
	"operator" | "launch",
	string,
	string,
	string,
];
const service = new DevelopWorkspaceServiceV0(new DevelopTasksStoreV0(root, { lockWaitMs: 30_000 }));
const launch = service.forLaunch(
	{ projectId, launchDirectory: directory },
	{ launchId: "0a0a0a0a0a0a0a0a", attachment: "fixture.writer", session: null },
);
process.stdout.write("ready\n");
const pause = new Int32Array(new SharedArrayBuffer(4));
const give = Date.now() + 30_000;
while (!existsSync(go)) {
	if (Date.now() > give) {
		process.stderr.write("no start signal\n");
		process.exit(1);
	}
	Atomics.wait(pause, 0, 0, 2);
}
for (let i = 0; i < Number(count); i += 1) {
	const title = `writer ${tag} task ${i}`;
	const made = scope === "operator" ? service.createTask(projectId, { title }) : launch.createTask({ title });
	if (!made.ok) {
		process.stderr.write(`refused: ${made.code}\n`);
		process.exit(1);
	}
	// And one status change each, against the revision just made: never stale, since no other writer touches this task.
	const moved =
		scope === "operator"
			? service.setStatus(projectId, made.value.id, made.value.revision, "in-progress")
			: launch.setStatus(made.value.id, made.value.revision, "in-progress");
	if (!moved.ok) {
		process.stderr.write(`status refused: ${moved.code}\n`);
		process.exit(1);
	}
}
