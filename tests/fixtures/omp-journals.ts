// Synthetic Oh My Pi saved-session journals for the observer's tests. Format as OMP 18.x writes it (omp.sh/docs/session-format): an
// optional 256-byte title slot, a version-3 header, then tree entries. Every text field carries a CANARY so a test can prove none of it
// reaches a record, a route or the page. No real session, prompt, path or credential is in here.

export const CANARY = "CANARY-omp-7f3a1c";

/** OMP's fixed-width title slot: exactly 256 bytes with its newline, padding inside the JSON string. */
export function titleSlot(title = `${CANARY} title`): string {
	const bare = JSON.stringify({
		type: "title",
		v: 1,
		title,
		source: "auto",
		updatedAt: "2026-10-01T10:00:00.000Z",
		pad: "",
	});
	const pad = " ".repeat(Math.max(0, 255 - Buffer.byteLength(bare)));
	return `${JSON.stringify({ type: "title", v: 1, title, source: "auto", updatedAt: "2026-10-01T10:00:00.000Z", pad })}\n`;
}

export function header(id: string, extra: Record<string, unknown> = {}): string {
	return `${JSON.stringify({
		type: "session",
		version: 3,
		id,
		timestamp: "2026-10-01T10:00:00.000Z",
		cwd: `/home/someone/${CANARY}-project`,
		providerPromptCacheKey: `${CANARY}-cache-key`,
		...extra,
	})}\n`;
}

let n = 0;
const nextId = () => {
	n += 1;
	return n.toString(16).padStart(8, "0");
};
export const resetIds = () => {
	n = 0;
};

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString();
const runtime = { version: "18.14.1" };

export interface Built {
	text: string;
	last: string | null;
}

/** A conversation: user asks, assistant thinks and calls a tool, the tool answers, the assistant answers. Every text is a canary. */
export function conversation(parent: string | null = null, start = 1): Built {
	const ids = [nextId(), nextId(), nextId(), nextId(), nextId(), nextId(), nextId(), nextId()];
	const lines = [
		{
			type: "model_change",
			id: ids[0],
			parentId: parent,
			timestamp: at(start),
			model: "anthropic/claude-test",
			runtime,
		},
		{
			type: "credential_pin",
			id: ids[1],
			parentId: ids[0],
			timestamp: at(start),
			provider: "anthropic",
			hash: `${CANARY}-pin`,
		},
		{
			type: "message",
			id: ids[2],
			parentId: ids[1],
			timestamp: at(start + 1),
			runtime,
			message: { role: "user", content: [{ type: "text", text: `${CANARY} user prompt` }], timestamp: 1 },
		},
		{
			type: "message",
			id: ids[3],
			parentId: ids[2],
			timestamp: at(start + 2),
			runtime,
			message: {
				role: "assistant",
				api: "anthropic-messages",
				provider: "anthropic",
				model: "claude-test",
				stopReason: "toolUse",
				errorMessage: `${CANARY} error message`,
				usage: { input: 1, output: 1 },
				content: [
					{ type: "thinking", thinking: `${CANARY} reasoning`, thinkingSignature: `${CANARY}-sig` },
					{ type: "text", text: `${CANARY} assistant text` },
					{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: `rm -rf ${CANARY}` } },
				],
				timestamp: 2,
			},
		},
		{
			type: "custom",
			id: ids[4],
			parentId: ids[3],
			timestamp: at(start + 3),
			customType: "tool_execution_start",
			data: {
				toolCallId: "call_1",
				toolName: "bash",
				intent: `${CANARY} intent`,
				args: { command: CANARY },
				startedAt: 3,
			},
		},
		{
			type: "message",
			id: ids[5],
			parentId: ids[4],
			timestamp: at(start + 4),
			runtime,
			message: {
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "bash",
				isError: true,
				content: [{ type: "text", text: `${CANARY} tool output AKIA${CANARY}` }],
				details: { stdout: CANARY },
				timestamp: 4,
			},
		},
		{
			type: "compaction",
			id: ids[6],
			parentId: ids[5],
			timestamp: at(start + 5),
			summary: `${CANARY} summary`,
			shortSummary: CANARY,
			firstKeptEntryId: ids[2],
			tokensBefore: 10,
		},
		{
			type: "message",
			id: ids[7],
			parentId: ids[6],
			timestamp: at(start + 6),
			runtime,
			message: {
				role: "assistant",
				provider: "anthropic",
				model: "claude-test",
				stopReason: "stop",
				content: [{ type: "text", text: `${CANARY} final answer` }],
				timestamp: 5,
			},
		},
	];
	return { text: lines.map((l) => `${JSON.stringify(l)}\n`).join(""), last: ids[7]! };
}

/** Entries every OMP session may hold that carry private text: each must be withheld. */
export function privateExtras(parent: string | null): Built {
	const ids = [nextId(), nextId(), nextId(), nextId()];
	const lines = [
		{
			type: "session_init",
			id: ids[0],
			parentId: parent,
			timestamp: at(30),
			systemPrompt: `${CANARY} system prompt`,
			task: `${CANARY} task`,
			tools: ["bash"],
		},
		{
			type: "title_change",
			id: ids[1],
			parentId: ids[0],
			timestamp: at(31),
			title: `${CANARY} new`,
			previousTitle: CANARY,
			source: "user",
		},
		{
			type: "custom_message",
			id: ids[2],
			parentId: ids[1],
			timestamp: at(32),
			customType: `com.example.${CANARY}`,
			content: `${CANARY} injected`,
			display: true,
		},
		{ type: "ttsr_injection", id: ids[3], parentId: ids[2], timestamp: at(33), injectedRules: [CANARY] },
	];
	return { text: lines.map((l) => `${JSON.stringify(l)}\n`).join(""), last: ids[3]! };
}

export function exitEntry(parent: string | null, kind = "normal", reason = "manual"): Built {
	const id = nextId();
	return {
		text: `${JSON.stringify({
			type: "custom",
			id,
			parentId: parent,
			timestamp: at(40),
			customType: "session_exit",
			data: { kind, reason, recordedAt: at(40) },
		})}\n`,
		last: id,
	};
}

/** A whole saved session: title slot, header, a conversation, private extras, and optionally OMP's exit record. */
export function session(
	id: string,
	options: { exit?: boolean; title?: boolean; extra?: Record<string, unknown> } = {},
): string {
	const convo = conversation();
	const extras = privateExtras(convo.last);
	const exit = options.exit === false ? { text: "", last: extras.last } : exitEntry(extras.last);
	return `${options.title === false ? "" : titleSlot()}${header(id, options.extra)}${convo.text}${extras.text}${exit.text}`;
}
