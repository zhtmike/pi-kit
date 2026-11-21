/**
 * Stamp and lock IO — `.pi/OWNER.json` and the `wx` lock discipline shared
 * with the binds file. Pure Node (fs/child_process), no host imports, so the
 * tests drive it on temp dirs. Records are written whole (atomic tmp+rename
 * where a reader could race); creation is always `wx` — never a silent
 * overwrite of a foreign record.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { probeWith, type StampRecord } from "./claim.ts";

export const STAMP_NAME = "OWNER.json";
export const LOCK_NAME = "OWNER.lock";

export function stampPath(root: string): string {
	return path.join(root, ".pi", STAMP_NAME);
}
export function lockPath(root: string, name = LOCK_NAME): string {
	return path.join(root, ".pi", name);
}

export type ReadStamp = StampRecord | null | "malformed";

function parseRecord(text: string): StampRecord | "malformed" {
	try {
		const v = JSON.parse(text);
		if (
			v === null || typeof v !== "object" || Array.isArray(v) ||
			typeof (v as any).sid !== "string" || typeof (v as any).pid !== "number" ||
			typeof (v as any).host !== "string" || typeof (v as any).token !== "string"
		) {
			return "malformed";
		}
		return { sid: (v as any).sid, pid: (v as any).pid, host: (v as any).host, token: (v as any).token };
	} catch {
		return "malformed";
	}
}

export function readStampAt(file: string): ReadStamp {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (e: any) {
		if (e.code === "ENOENT") return null;
		throw e;
	}
	return parseRecord(raw);
}

export function readStamp(root: string): ReadStamp {
	return readStampAt(stampPath(root));
}

/** `wx` create — false on EEXIST (a foreign record is never clobbered here). */
export function createStamp(root: string, rec: StampRecord): boolean {
	fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
	try {
		fs.writeFileSync(stampPath(root), JSON.stringify(rec) + "\n", { flag: "wx" });
		return true;
	} catch (e: any) {
		if (e.code === "EEXIST") return false;
		throw e;
	}
}

/** Atomic rewrite of a record we own (row 2 re-stamp). */
export function writeStamp(root: string, rec: StampRecord): void {
	const file = stampPath(root);
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(rec) + "\n");
	fs.renameSync(tmp, file);
}

export function unlinkIfOurs(root: string, sid: string): void {
	try {
		const cur = readStamp(root);
		if (cur !== null && cur !== "malformed" && cur.sid === sid) fs.unlinkSync(stampPath(root));
	} catch {
		// best-effort on quit/exit
	}
}

// --- locks -------------------------------------------------------------------------------

function startTokenOf(pid: number): string {
	return readStartToken(pid);
}

/** The liveness probe used by both locks and stamps. */
export const lockProbe = probeWith(readStartToken, (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
});

/**
 * Take `<root>/.pi/<name>` with `wx`, holding `{pid, host, token}`. On EEXIST:
 * a live holder blocks (reason returned); a dead or malformed holder is taken
 * over; our own leftover is re-taken. Returns the release function on success.
 */
export function takeLock(root: string, name: string, self: { pid: number; host: string; token: string }): { ok: true; release: () => void } | { ok: false; reason: string } {
	const file = lockPath(root, name);
	fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
	const rec = { pid: self.pid, host: self.host, token: self.token };
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(file, JSON.stringify(rec) + "\n", { flag: "wx" });
			return {
				ok: true,
				release: () => {
					try {
						fs.unlinkSync(file);
					} catch {
						// already gone
					}
				},
			};
		} catch (e: any) {
			if (e.code !== "EEXIST") throw e;
			const holder = readStampAt(file);
			if (holder === null) continue; // released between EEXIST and read — retry
			if (holder === "malformed") {
				fs.unlinkSync(file); // a malformed lock is replaced
				continue;
			}
			if (holder.pid === self.pid && holder.token === self.token && holder.host === self.host) {
				return { ok: true, release: () => undefined }; // our own leftover from a crashed take
			}
			if (holder.host !== self.host) {
				return { ok: false, reason: `lock ${file} is held by pid ${holder.pid} on host '${holder.host}' — a foreign-host lock is retained; retry after it clears or work elsewhere.` };
			}
			const live = lockProbe(holder);
			if (live === "alive" || live === "unknown") {
				return { ok: false, reason: `lock ${file} is held by live pid ${holder.pid} — retry when it releases.` };
			}
			fs.unlinkSync(file); // dead holder — take over
		}
	}
	return { ok: false, reason: `could not take lock ${file} after a takeover retry` };
}

// --- process start tokens ----------------------------------------------------------------

/**
 * A pid's start token: Linux `/proc/<pid>/stat` field 22 (clock ticks since
 * boot — uptime-based, immune to wall-clock steps); elsewhere `ps -o lstart=`.
 * Empty string = unreadable.
 */
export function readStartToken(pid: number): string {
	if (process.platform === "linux") {
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			const close = stat.lastIndexOf(")");
			if (close < 0) return "";
			const fields = stat.slice(close + 2).split(/\s+/);
			const start = fields[19]; // field 22 overall: state(3) is fields[0]
			return start ?? "";
		} catch {
			return "";
		}
	}
	try {
		return execSync(`ps -o lstart= -p ${pid}`, { encoding: "utf8", timeout: 5000 }).trim();
	} catch {
		return "";
	}
}
