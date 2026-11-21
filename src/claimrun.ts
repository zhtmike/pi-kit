/**
 * The claim runner — the rows of `claim.ts` driven over real fs/git, shared
 * by the checkout-claim floor, the `checkout` tool, and `git_commit`'s
 * pre-commit gate. Blind probe / empty sid writes nothing and blocks; a
 * replace happens under the OWNER.lock discipline; `.pi` must be gitignored
 * before any stamp is created.
 */

import { hostname } from "node:os";
import { BLIND, decideClaim, probeWith, type StampRecord } from "./claim.ts";
import { createStamp, readStartToken, readStamp, takeLock, writeStamp } from "./stamp.ts";
import { gitRootOf, piDirIgnored, type ExecFn } from "./githelp.ts";

export type EnsureResult = { ok: true; row: number } | { ok: false; reason: string };

export function selfOf(sid: string): StampRecord {
	return { sid, pid: process.pid, host: hostname(), token: readStartToken(process.pid) };
}

const SELF_PROBE = probeWith(
	(pid) => readStartToken(pid),
	(pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	},
);

/**
 * Ensure this session holds the checkout at `root` — rows 0–6. `sid` empty or
 * our own start token unreadable is the dead-man guard: write nothing, block.
 * Callers gate `.pi`-ignore before passing (creation paths only).
 */
export function ensureClaim(root: string, self: StampRecord): EnsureResult {
	if (BLIND(self)) {
		return {
			ok: false,
			reason:
				self.sid === ""
					? "checkout-claim: this session has no session id — claims cannot be written safely; the operation blocks (no stamp was created)."
					: "checkout-claim: this process's start token is unreadable — liveness could never be verified; the operation blocks (no stamp was created).",
		};
	}
	const d = decideClaim(readStamp(root), self, SELF_PROBE);
	switch (d.action) {
		case "proceed":
			if (d.row === 2) writeStamp(root, self); // session replacement — re-stamp with the current sid
			return { ok: true, row: d.row };
		case "create":
			if (createStamp(root, self)) return { ok: true, row: 0 };
			return afterEEXIST(root, self); // a concurrent create won the race
		case "replace":
			return replaceUnderLock(root, self);
		case "block":
			return { ok: false, reason: d.reason };
	}
}

function afterEEXIST(root: string, self: StampRecord): EnsureResult {
	const d = decideClaim(readStamp(root), self, SELF_PROBE);
	if (d.action === "block") return { ok: false, reason: d.reason };
	if (d.action === "proceed") {
		if (d.row === 2) writeStamp(root, self);
		return { ok: true, row: d.row };
	}
	if (d.action === "create") return { ok: false, reason: "claim stamp vanished mid-check — retry the operation" };
	return replaceUnderLock(root, self);
}

function replaceUnderLock(root: string, self: StampRecord): EnsureResult {
	const lock = takeLock(root, "OWNER.lock", self);
	if (!lock.ok) return { ok: false, reason: lock.reason };
	try {
		// Re-read under the lock: a racing writer may have claimed it first.
		const d = decideClaim(readStamp(root), self, SELF_PROBE);
		if (d.action === "block") return { ok: false, reason: d.reason };
		if (d.action === "proceed") return { ok: true, row: d.row };
		writeStamp(root, self);
		return { ok: true, row: 5 };
	} finally {
		lock.release();
	}
}

/**
 * The async wrapper the floors use: resolve the tree root from `startDir`
 * (non-git trees pass ungated), gate on `.pi` ignore before any creation,
 * then run the rows. Returns the resolved root alongside the decision.
 */
export async function ensureClaimAt(
	exec: ExecFn,
	startDir: string,
	sid: string,
	opts?: { strict?: boolean },
): Promise<{ root: string | null; ok: boolean; row?: number; reason?: string }> {
	const root = await gitRootOf(exec, startDir);
	if (root === null) {
		// A classified git command whose toplevel cannot be resolved blocks (fail
		// closed); an edit/write in a non-git tree stays ungated.
		if (opts?.strict === true) {
			return { root: null, ok: false, reason: `could not resolve a git work tree from '${startDir}' — the claim target is unresolved, and an unresolved toplevel blocks. Fix the path or run the command from inside the tree.` };
		}
		return { root: null, ok: true, row: -1 };
	}
	const self = selfOf(sid);
	if (!BLIND(self) && readStamp(root) === null) {
		const ignored = await piDirIgnored(exec, root);
		if (!ignored) {
			return {
				root,
				ok: false,
				reason: `.pi/ is not gitignored in ${root} — stamp and bind files are never created in a tree where 'git status' would show them. Add a '.pi/' line to .gitignore (or .git/info/exclude); pi-kit never edits ignore files.`,
			};
		}
	}
	const r = ensureClaim(root, self);
	return { root, ...r };
}
