// A child process for the store's concurrency test: it creates N tasks through its own store object, as a second `endo` process would.
import { DevelopTasksStoreV0 } from "../../storage/develop-tasks.ts";

const [root, projectId, tag, count] = process.argv.slice(2) as [string, string, string, string];
const store = new DevelopTasksStoreV0(root, { lockWaitMs: 30_000 });
for (let i = 0; i < Number(count); i += 1) {
	const made = store.createTask(projectId, { title: `writer ${tag} task ${i}` });
	if (!made.ok) {
		process.stderr.write(`refused: ${made.code}\n`);
		process.exit(1);
	}
}
