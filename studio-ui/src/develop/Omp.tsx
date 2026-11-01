// Oh My Pi saved sessions in DEVELOP: a group in the session navigator, an activity panel of committed entries (their kinds, never their
// text) and an inspector built on the neutral surface. Everything here is read from OMP's own files when the page asks, and says so:
// none of it is live, and nothing here can reach OMP. Words are fixed in this module; from a record only closed values, numbers, times,
// a session id and tool or model names that passed the server's grammar are shown, each as React text.
import type { KeyboardEvent, ReactElement } from "react";
import type { EndoOmpActivityItemV0, EndoOmpSessionRowV0 } from "../../../protocol/omp-observation.ts";
import { presentOmpSaved } from "../model/develop-session.ts";
import { grouped } from "../model/views.ts";
import { Panel } from "../ui/Panel.tsx";
import { Note } from "../ui/text.tsx";
import type { OmpApi } from "../use-omp.ts";
import { SurfaceTag, SurfaceView } from "./Surface.tsx";

const clock = (iso: string | null): string =>
	iso === null ? "unknown" : new Date(iso).toLocaleString([], { hour12: false });

/** The row's state in words: what the file says, never what a process does. */
function stateWords(row: EndoOmpSessionRowV0): string {
	if (row.state === "unsupported-version") return "format not read";
	if (row.state !== "readable") return "not readable";
	if (row.exit !== null) return row.exit.kind === "signal" ? "exit by signal saved" : "exit saved";
	return row.turn === "open"
		? "turn open when saved"
		: row.turn === "settled"
			? "turn settled when saved"
			: "no messages";
}

const STATE_MEANING: Record<EndoOmpSessionRowV0["state"], string> = {
	readable: "Read whole, from a stable file.",
	"unsupported-version":
		"The header names an OMP session format this version does not read (it reads format 3). Nothing else was read.",
	"no-header": "No OMP session header where one must be. Nothing was read from it.",
	"too-large": "Larger than this page reads. Nothing was read from it.",
	unstable: "It changed while it was read, twice. Nothing from either read is shown; read again.",
	unreadable: "It could not be opened or read as a plain file. Nothing was read from it.",
};

const KIND_WORDS: Record<EndoOmpActivityItemV0["kind"], string> = {
	"user-message": "user message",
	"assistant-message": "assistant message",
	"tool-result": "tool result",
	"tool-start": "tool started",
	"developer-message": "developer message",
	"other-message": "other message",
	compaction: "context compacted",
	"branch-summary": "branch summary",
	"model-change": "model changed",
	"thinking-change": "thinking level changed",
	"title-change": "title changed",
	"session-exit": "OMP recorded its exit",
	extension: "extension entry",
	other: "other entry",
};

/** Arrow keys, Home and End move between the OMP rows, as they do between the recorded ones. */
function walk(event: KeyboardEvent<HTMLElement>): void {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-testid=omp-row]")];
	const at = buttons.indexOf(document.activeElement as HTMLElement);
	if (buttons.length === 0 || at < 0) return;
	event.preventDefault();
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? buttons.length - 1
				: Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
	buttons[next]?.focus();
}

export function OmpGroup({ omp, onChoose }: { omp: OmpApi; onChoose(selector: string): void }): ReactElement | null {
	const { list, reading, selected, problem } = omp.state;
	if (list !== null && !list.available) return null;
	if (list === null) {
		if (reading)
			return (
				<output className="loading">
					<span className="spinner" aria-hidden="true" /> Reading Oh My Pi's saved sessions…
				</output>
			);
		if (problem === null) return null;
		// No list was ever obtained (a refused or failed first read): say so and keep the way to read again, or the source would vanish.
		return (
			<section className="nav-group" aria-labelledby="develop-group-omp" data-testid="omp-group">
				<h3 id="develop-group-omp">Oh My Pi · saved files</h3>
				<Note tone="warn">
					<span data-testid="omp-problem">
						Oh My Pi's saved sessions, if this Studio observes them, could not be read: {problem}
					</span>
				</Note>
				<p>
					<button type="button" className="btn small-btn" data-testid="omp-read-again" onClick={omp.refreshList}>
						Read again
					</button>
				</p>
			</section>
		);
	}
	return (
		<section className="nav-group" aria-labelledby="develop-group-omp" data-testid="omp-group">
			<h3 id="develop-group-omp">Oh My Pi · saved files ({list.sessions.length})</h3>
			<p className="dim small" data-testid="omp-snapshot">
				A snapshot of OMP's saved files, read at {clock(list.readAt)} (server clock). Read only: Endophasia cannot
				control OMP and cannot tell whether it is running.{" "}
				<button
					type="button"
					className="btn small-btn"
					data-testid="omp-read-again"
					disabled={reading}
					onClick={omp.refreshList}
				>
					{reading ? "Reading…" : "Read again"}
				</button>
			</p>
			{problem === null ? null : <Note tone="warn">{problem}</Note>}
			{list.skipped.links +
				list.skipped.notRegular +
				list.skipped.overLimit +
				list.skipped.notRead +
				list.skipped.unreadable ===
			0 ? null : (
				<p className="dim small" data-testid="omp-skipped">
					Not read: {grouped(list.skipped.links)} link{list.skipped.links === 1 ? "" : "s"},{" "}
					{grouped(list.skipped.notRegular)} not a plain file, {grouped(list.skipped.unreadable)} not readable,{" "}
					{grouped(list.skipped.overLimit + list.skipped.notRead)} over the limits.
				</p>
			)}
			{list.sessions.length === 0 ? (
				<p className="dim small">No saved OMP session files in the named directory.</p>
			) : (
				<ul className="caplist" onKeyDown={walk}>
					{list.sessions.map((row) => (
						<li key={row.selector}>
							<button
								type="button"
								className="caprow session-row"
								aria-pressed={row.selector === selected}
								data-session-row=""
								data-testid="omp-row"
								data-state={row.state}
								onClick={() => onChoose(row.selector)}
							>
								<span className="session-name mono">{row.alias ?? "omp (no label)"}</span>
								<span className="session-state">{stateWords(row)}</span>
								<span className="session-meta">
									{grouped(row.counts.entries)} saved entr{row.counts.entries === 1 ? "y" : "ies"} ·{" "}
									{grouped(row.counts.toolCalls)} tool call{row.counts.toolCalls === 1 ? "" : "s"}
								</span>
								<SurfaceTag session={presentOmpSaved(row)} />
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function Item({ item }: { item: EndoOmpActivityItemV0 }): ReactElement {
	return (
		<li className="omp-item" data-testid="omp-item" data-kind={item.kind}>
			<span className="dim mono">
				{item.at === null ? "—" : new Date(item.at).toLocaleTimeString([], { hour12: false })}
			</span>{" "}
			<span>{KIND_WORDS[item.kind]}</span>
			{item.tools.length === 0 ? null : <span className="mono"> · {item.tools.join(", ")}</span>}
			{item.stopReason === null ? null : <span className="dim"> · stop: {item.stopReason}</span>}
			{item.isError === true ? <span className="state state-degraded"> · error</span> : null}
			{item.model === null ? null : <span className="dim mono"> · {item.model}</span>}
		</li>
	);
}

export function OmpActivity({ omp }: { omp: OmpApi }): ReactElement {
	const { detail, reading, problem } = omp.state;
	return (
		<Panel
			id="develop-activity"
			title="Activity"
			subtitle="committed entries OMP saved, without their text"
			className="develop-activity"
			resetKey={detail?.session.selector ?? null}
			tools={
				<button
					type="button"
					className="btn"
					data-testid="omp-session-read-again"
					disabled={reading || omp.state.selected === null}
					onClick={omp.refreshSession}
				>
					{reading ? "Reading…" : "Read again"}
				</button>
			}
		>
			{problem === null ? null : <Note tone="warn">{problem}</Note>}
			{detail === null ? (
				reading ? (
					<output className="loading">
						<span className="spinner" aria-hidden="true" /> Reading the saved session…
					</output>
				) : (
					<Note>Choose a saved session to read it.</Note>
				)
			) : (
				<>
					<p className="dim small" data-testid="omp-activity-note">
						Read from OMP's saved file at {clock(detail.readAt)} (server clock): a persisted snapshot, not a live
						view. OMP saves an entry when it completes, so a response being written is not here, and nothing of
						any message's text, reasoning, tool arguments or tool output is shown.
					</p>
					{detail.session.tail === "pending" ? (
						<Note tone="warn">
							The file ends in an entry OMP had not finished writing. It is left out until it is complete.
						</Note>
					) : null}
					{detail.activity.length === 0 ? (
						<Note>No committed entries on this session's current path.</Note>
					) : (
						<>
							{detail.earlier === 0 ? null : (
								<p className="dim small">
									{grouped(detail.earlier)} earlier entr{detail.earlier === 1 ? "y" : "ies"} on this path not
									shown.
								</p>
							)}
							<ol className="omp-activity" data-testid="omp-activity">
								{detail.activity.map((item, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: entries are shown in file order and never reordered
									<Item key={i} item={item} />
								))}
							</ol>
						</>
					)}
				</>
			)}
		</Panel>
	);
}

export function OmpInspector({ omp }: { omp: OmpApi }): ReactElement {
	const detail = omp.state.detail;
	const row = detail?.session ?? null;
	return (
		<Panel
			id="develop-inspector"
			title="Inspector"
			subtitle="the saved session, as its file says"
			className="develop-inspector"
			resetKey={row?.selector ?? null}
		>
			{row === null ? (
				<div className="develop-empty">
					<h3>No saved session open</h3>
					<p>
						When one is open, this panel shows where it came from, what its file says and what cannot be known
						from it.
					</p>
				</div>
			) : (
				<div className="detail" data-testid="omp-detail">
					<SurfaceView session={presentOmpSaved(row)} />
					<section className="block">
						<h3>The saved file</h3>
						<dl className="facts">
							<div className="fact">
								<dt>state</dt>
								<dd data-testid="omp-file-state">{STATE_MEANING[row.state]}</dd>
							</div>
							<div className="fact">
								<dt>format</dt>
								<dd>
									{row.format.session === null ? "unknown" : `session format ${row.format.session}`}
									{row.format.titleSlot ? " · title slot present (its title is not shown)" : ""}
								</dd>
							</div>
							<div className="fact">
								<dt>OMP versions</dt>
								<dd className="mono">
									{row.runtimeVersions.length === 0
										? "none recorded in the entries"
										: `${row.runtimeVersions.join(", ")} (as the entries record it)`}
								</dd>
							</div>
							<div className="fact">
								<dt>created</dt>
								<dd>{clock(row.createdAt)}</dd>
							</div>
							<div className="fact">
								<dt>last saved entry</dt>
								<dd>{clock(row.lastEntryAt)} (as OMP recorded it; not a heartbeat)</dd>
							</div>
							<div className="fact">
								<dt>OMP's exit record</dt>
								<dd data-testid="omp-exit">
									{row.exit === null
										? "none as the last entry: OMP may still hold this session, may have stopped without saying so, or the file may be a copy"
										: `${row.exit.kind}${row.exit.reason === null ? "" : ` (${row.exit.reason})`} at ${clock(row.exit.at)}, reported by OMP`}
								</dd>
							</div>
							<div className="fact">
								<dt>lineage</dt>
								<dd>
									{row.lineage.kind === "none"
										? "none recorded"
										: row.lineage.kind === "copied-file"
											? "copied from another saved file, as OMP recorded it (the path is not shown)"
											: `a fork or subagent of ${row.lineage.id ?? "a session whose id is not well formed"}, as OMP recorded it`}
								</dd>
							</div>
							<div className="fact">
								<dt>process now</dt>
								<dd className="dim">
									Not established. A saved file is not a process, and no file time is read as one.
								</dd>
							</div>
						</dl>
						<p className="develop-counts" data-testid="omp-counts">
							<span>
								<b>{grouped(row.counts.userMessages)}</b> user
							</span>
							<span>
								<b>{grouped(row.counts.assistantMessages)}</b> assistant
							</span>
							<span>
								<b>{grouped(row.counts.toolCalls)}</b> tool calls
							</span>
							<span>
								<b>{grouped(row.counts.toolErrors)}</b> tool errors
							</span>
							<span>
								<b>{grouped(row.counts.compactions)}</b> compactions
							</span>
							<span>
								<b>{grouped(row.tree.leaves)}</b> branch{row.tree.leaves === 1 ? "" : "es"}
							</span>
							<span>
								<b>{grouped(row.counts.unknownTypes)}</b> unknown entries
							</span>
							<span>
								<b>{grouped(row.counts.malformedLines)}</b> malformed lines
							</span>
						</p>
						{row.tree.duplicateIds + row.tree.missingParents + row.tree.cycles === 0 ? null : (
							<Note tone="warn">
								The session tree is damaged: {row.tree.duplicateIds} repeated ids, {row.tree.missingParents}{" "}
								missing parents, {row.tree.cycles} cycles. The path shown follows the last entry back as far as
								it can.
							</Note>
						)}
					</section>
				</div>
			)}
		</Panel>
	);
}
