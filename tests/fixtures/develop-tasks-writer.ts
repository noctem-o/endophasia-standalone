// A child process for the store's concurrency test: it creates N tasks through its own store object, as a second `endo` process would.
// It reports "ready" once it is loaded, then waits for the go-file before its first write, so that every writer starts together.
import { existsSync } from "node:fs";
import { DevelopTasksStoreV0 } from "../../storage/develop-tasks.ts";

const [root, projectId, tag, count, go] = process.argv.slice(2) as [string, string, string, string, string];
const store = new DevelopTasksStoreV0(root, { lockWaitMs: 30_000 });
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
	const made = store.createTask(projectId, { title: `writer ${tag} task ${i}` });
	if (!made.ok) {
		process.stderr.write(`refused: ${made.code}\n`);
		process.exit(1);
	}
}
