/**
 * Checkout-claim rows — the pure decision core. A stamp is
 * `.pi/OWNER.json` = `{sid, pid, host, token}` at the git work tree's root;
 * `token` is the owner process's start token (Linux `/proc/<pid>/stat` field
 * 22 — uptime ticks; elsewhere `ps -o lstart=`), immune to wall-clock steps.
 * `unknown` liveness is retained, never dead. Token comparison happens only
 * same-host. No fs, no processes here — the extension supplies probes.
 */

export interface StampRecord {
	sid: string;
	pid: number;
	host: string;
	token: string;
}

export type Liveness = "alive" | "dead" | "unknown";

export type ClaimDecision =
	| { row: 0; action: "create" }
	| { row: 1 | 2; action: "proceed" }
	| { row: 5; action: "replace" }
	| { row: 3 | 4 | 6 | 7; action: "block"; reason: string };

export interface ClaimSelf {
	sid: string;
	pid: number;
	host: string;
	token: string;
}

export interface ClaimProbe {
	/** Liveness of a foreign record's pid+token on this host. */
	(rec: StampRecord): Liveness;
}

export const BLIND = (self: ClaimSelf): boolean => self.sid === "" || self.token === "";

/** Rows 0–6. Callers handle the blind probe (write nothing, block) before calling. */
export function decideClaim(stamp: StampRecord | null | "malformed", self: ClaimSelf, probe: ClaimProbe): ClaimDecision {
	if (stamp === null) return { row: 0, action: "create" };
	if (stamp === "malformed") return { row: 6, action: "block", reason: "claim stamp .pi/OWNER.json is malformed or incomplete — retained, not replaced. Inspect it by hand; delete it only if you know its writer is gone (checkout action 'status' shows the record)." };
	if (stamp.sid === self.sid) return { row: 1, action: "proceed" };
	if (stamp.pid === self.pid && stamp.token === self.token && stamp.host === self.host) return { row: 2, action: "proceed" };
	if (stamp.host !== self.host) {
		return {
			row: 3,
			action: "block",
			reason: `checkout held by session '${stamp.sid}' on host '${stamp.host}' — a foreign-host claim is retained (its liveness cannot be probed from here). Work in a worktree instead (checkout action 'worktree').`,
		};
	}
	const live = probe(stamp);
	if (live === "alive") {
		return {
			row: 4,
			action: "block",
			reason: `checkout held by live session '${stamp.sid}' (pid ${stamp.pid} on host '${stamp.host}'). Either wait for that session, or run your task in a worktree: checkout action 'worktree' returns an escape under .pi/worktrees/<sid>.`,
		};
	}
	if (live === "unknown") {
		return {
			row: 7,
			action: "block",
			reason: `checkout stamp held by session '${stamp.sid}' (pid ${stamp.pid}) whose liveness is unknown — unknown is retained, never treated as dead. Inspect the process by hand, or take a worktree (checkout action 'worktree').`,
		};
	}
	return { row: 5, action: "replace" };
}

/**
 * Liveness of a foreign pid+token on this host, given a start-token reader
 * (the extension's processStartId). Empty token on either side → unknown
 * (never dead). Different token kinds (date vs ticks) or a reused pid → dead.
 */
export function probeWith(startTokenOf: (pid: number) => string, exists: (pid: number) => boolean): ClaimProbe {
	return (rec) => {
		if (rec.token === "") return "unknown";
		const now = startTokenOf(rec.pid);
		if (now === "") return exists(rec.pid) ? "unknown" : "dead";
		return now === rec.token ? "alive" : "dead";
	};
}
