// Oh My Pi's saved sessions, as the server observed them: one read at a time. The list is read ONCE on its own, the first time DEVELOP is
// shown, and again only when the operator asks ("Read again"); one session is read when it is chosen, and again when asked. Nothing
// polls and nothing is scheduled: what is shown is a snapshot of OMP's files at the moment of the last read, and the page says so. Nothing
// here can reach OMP: the routes only read files the operator's command named.
import { useCallback, useEffect, useRef, useState } from "react";
import type { EndoOmpSessionV0 } from "../../protocol/omp-observation.ts";
import { fetchOmp, type OmpRequest } from "./api.ts";
import type { OmpList } from "./model/omp-wire.ts";

export interface OmpState {
	/** null before the first read. `available: false`: this server observes no OMP directory. */
	list: OmpList | null;
	selected: string | null;
	detail: EndoOmpSessionV0 | null;
	reading: boolean;
	problem: string | null;
}

export interface OmpApi {
	state: OmpState;
	/** Read the list of saved sessions again. */
	refreshList(): void;
	/** Read the chosen session again. */
	refreshSession(): void;
	choose(selector: string | null): void;
}

export function useOmp(active: boolean): OmpApi {
	const [state, setState] = useState<OmpState>({
		list: null,
		selected: null,
		detail: null,
		reading: false,
		problem: null,
	});
	const latest = useRef(state);
	latest.current = state;
	const running = useRef(false);
	const entered = useRef(false);
	const controller = useRef<AbortController | null>(null);

	// A read asked for while one runs is kept (the latest one) and run when it ends, so a session chosen during a read is not lost.
	const again = useRef<OmpRequest | null>(null);
	const read = useCallback(async (request: OmpRequest): Promise<void> => {
		if (running.current) {
			again.current = request;
			return;
		}
		running.current = true;
		controller.current = new AbortController();
		setState((s) => ({ ...s, reading: true, problem: null }));
		const reply = await fetchOmp(request, controller.current.signal);
		running.current = false;
		setState((s) => {
			if (reply.kind === "list") {
				const sessions = reply.record.available ? reply.record.sessions : [];
				// A chosen session that is no longer listed is not kept: its selector named a file that is gone or was replaced.
				const keep = s.selected !== null && sessions.some((r) => r.selector === s.selected);
				return {
					...s,
					list: reply.record,
					reading: false,
					selected: keep ? s.selected : null,
					detail: keep ? s.detail : null,
				};
			}
			if (reply.kind === "session")
				return reply.record.session.selector === s.selected
					? { ...s, detail: reply.record, reading: false }
					: { ...s, reading: false };
			return {
				...s,
				reading: false,
				problem: reply.message,
				...(reply.stale && request.kind === "session" ? { detail: null } : {}),
			};
		});
		const next = again.current;
		again.current = null;
		if (next !== null) await read(next);
	}, []);

	useEffect(() => {
		if (active && !entered.current) {
			entered.current = true;
			void read({ kind: "list" });
		}
	}, [active, read]);
	useEffect(() => () => controller.current?.abort(), []);

	const refreshList = useCallback(() => void read({ kind: "list" }), [read]);
	const refreshSession = useCallback(() => {
		const selected = latest.current.selected;
		if (selected !== null) void read({ kind: "session", selector: selected });
	}, [read]);
	const choose = useCallback(
		(selector: string | null) => {
			setState((s) => ({ ...s, selected: selector, detail: null, problem: null }));
			if (selector !== null) void read({ kind: "session", selector });
		},
		[read],
	);
	return { state, refreshList, refreshSession, choose };
}
