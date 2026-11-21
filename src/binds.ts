/**
 * `.pi/REVIEW_BINDS.json` — tool-written rows recording a fresh review
 * (kind `tree`: an index tree hash; kind `post`: a file-content sha256).
 * Updated under the stamp lock discipline: concurrent lane-binds and
 * parent-spends cannot lose updates or double-spend. Rows are hash-keyed;
 * stale unspent rows accumulate harmlessly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { takeLock, type ReadStamp, readStampAt } from "./stamp.ts";

export const BINDS_NAME = "REVIEW_BINDS.json";
const BINDS_LOCK = "REVIEW_BINDS.lock";
const MAX_ROWS = 100;

export interface BindRow {
	kind: "tree" | "post";
	hash: string;
	/** The reviewing session's id — never the committer's own. */
	sid: string;
	at: string;
}

export interface BindsFile {
	version: 1;
	rows: BindRow[];
}

export function bindsPath(root: string): string {
	return path.join(root, ".pi", BINDS_NAME);
}

export function sha256File(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readBindsAt(file: string): BindsFile {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return { version: 1, rows: [] }; // absent file = no binds yet
	}
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch (e) {
		throw new Error(`${file} is not parseable JSON — inspect it by hand; pi-kit never rewrites a corrupt binds file (${(e as Error).message})`);
	}
	if (v === null || typeof v !== "object" || !Array.isArray((v as any).rows)) {
		throw new Error(`${file} is malformed (expected {version, rows[]}) — inspect it by hand; pi-kit never rewrites a corrupt binds file`);
	}
	return { version: 1, rows: (v as any).rows.filter((r: any) => r && (r.kind === "tree" || r.kind === "post") && typeof r.hash === "string" && typeof r.sid === "string") };
}

export function readBinds(root: string): BindsFile {
	return readBindsAt(bindsPath(root));
}

/**
 * Append rows under the lock; hash-keyed dedupe keeps one row per kind+hash,
 * `MAX_ROWS` most recent survive. Returns false when the lock is held live.
 */
export function recordBinds(root: string, self: { pid: number; host: string; token: string }, add: BindRow[]): boolean {
	const lock = takeLock(root, BINDS_LOCK, self);
	if (!lock.ok) return false;
	try {
		const file = bindsPath(root);
		fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
		const cur = readBindsAt(file);
		// hash-keyed: dedupe within `add` (first wins) and against existing rows
		const fresh: BindRow[] = [];
		for (const r of add) {
			if (!fresh.some((a) => a.kind === r.kind && a.hash === r.hash)) fresh.push(r);
		}
		const rows = [...fresh, ...cur.rows.filter((r) => !fresh.some((a) => a.kind === r.kind && a.hash === r.hash))].slice(0, MAX_ROWS);
		const tmp = `${file}.tmp-${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, rows }) + "\n");
		fs.renameSync(tmp, file);
		return true;
	} finally {
		lock.release();
	}
}

/**
 * Spend one row (kind+hash) under the lock — exactly-once: a second spender
 * finds the row gone. Returns false when the lock is held live.
 */
export function spendBind(root: string, self: { pid: number; host: string; token: string }, kind: BindRow["kind"], hash: string): boolean {
	const lock = takeLock(root, BINDS_LOCK, self);
	if (!lock.ok) return false;
	try {
		const file = bindsPath(root);
		const cur = readBindsAt(file);
		const rows = cur.rows.filter((r) => !(r.kind === kind && r.hash === hash));
		if (rows.length === cur.rows.length) return true; // already spent — nothing to do
		const tmp = `${file}.tmp-${process.pid}`;
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, rows }) + "\n");
		fs.renameSync(tmp, file);
		return true;
	} finally {
		lock.release();
	}
}

/**
 * Find an unspent row. `notSid` rejects the committer's own rows — a bind
 * must come from a reviewing session, not the one spending it.
 */
export function findBind(root: string, kind: BindRow["kind"], hash: string, notSid: string): BindRow | undefined {
	return readBinds(root).rows.find((r) => r.kind === kind && r.hash === hash && r.sid !== "" && r.sid !== notSid);
}
