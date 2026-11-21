import assert from "node:assert/strict";
import { BLIND, decideClaim, probeWith, type StampRecord } from "../src/claim.ts";
import { recordBinds, spendBind, findBind, readBinds } from "../src/binds.ts";
import { createStamp, readStamp, lockPath, takeLock, readStartToken } from "../src/stamp.ts";
import { slugify } from "../src/util.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let failures = 0;
const t = (name: string, fn: () => void) => {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL - ${name}: ${(e as Error).message}`);
	}
};

const self: StampRecord = { sid: "s1", pid: process.pid, host: "h", token: "T" };
const other = (over: Partial<StampRecord>): StampRecord => ({ sid: "s2", pid: 99999, host: "h", token: "T2", ...over });
const probeAlive = () => "alive" as const;
const probeDead = () => "dead" as const;
const probeUnknown = () => "unknown" as const;

// --- rows ---------------------------------------------------------------------------------
t("row 0: absent stamp → create", () => {
	assert.deepEqual(decideClaim(null, self, probeAlive), { row: 0, action: "create" });
});
t("row 1: our sid → proceed", () => {
	assert.deepEqual(decideClaim(self, self, probeAlive), { row: 1, action: "proceed" });
});
t("row 2: our pid+token under a new sid (session replacement) → proceed", () => {
	const stamp = { ...self, sid: "older-session" };
	assert.deepEqual(decideClaim(stamp, self, probeAlive), { row: 2, action: "proceed" });
});
t("row 3: foreign host → block, retain", () => {
	const d = decideClaim(other({ host: "other-host" }), self, probeAlive);
	assert.equal(d.action, "block");
	assert.match((d as any).reason, /foreign-host/);
});
t("row 4: same host, alive, token matches → block naming the owner and the worktree escape", () => {
	const d = decideClaim(other({}), self, probeAlive);
	assert.equal(d.action, "block");
	assert.match((d as any).reason, /worktree/);
});
t("row 5: same host, dead (or reused pid) → replace", () => {
	assert.deepEqual(decideClaim(other({}), self, probeDead), { row: 5, action: "replace" });
});
t("row 5: same host, token differs (reused pid) → replace", () => {
	// a real probe: our own pid is alive, its current token is 'realToken' — a stamp
	// holding a different token for this pid is stale (reused pid) → dead → replace
	const probe = probeWith(
		(pid) => (pid === process.pid ? "realToken" : ""),
		(pid) => pid === process.pid,
	);
	assert.deepEqual(decideClaim(other({ pid: process.pid, token: "different" }), self, probe), { row: 5, action: "replace" });
});
t("row 6: malformed stamp → block, retain", () => {
	const d = decideClaim("malformed", self, probeDead);
	assert.equal(d.action, "block");
	assert.match((d as any).reason, /malformed/);
});
t("unknown liveness is retained, never dead — blocks instead of replacing", () => {
	const d = decideClaim(other({}), self, probeUnknown);
	assert.equal(d.action, "block");
});
t("blind self: empty sid or unreadable token is the dead-man guard", () => {
	assert.equal(BLIND({ ...self, sid: "" }), true);
	assert.equal(BLIND({ ...self, token: "" }), true);
});

// --- probe --------------------------------------------------------------------------------
t("probe: empty stamp token → unknown; matching token → alive; differing → dead", () => {
	const p = probeWith(
		(pid) => (pid === 1 ? "tokA" : ""),
		(pid) => pid === 1,
	);
	assert.equal(p(other({ pid: 1, token: "" })), "unknown");
	assert.equal(p(other({ pid: 1, token: "tokA" })), "alive");
	assert.equal(p(other({ pid: 1, token: "tokB" })), "dead"); // reused pid
	assert.equal(p(other({ pid: 2, token: "tokA" })), "dead"); // no such pid
});

// --- binds (fs on temp dirs) ---------------------------------------------------------------
const withRoot = (fn: (root: string) => void): void => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pikit-binds-"));
	fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
	try {
		fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
};

t("stamps: wx create; EEXIST returns false; a live foreign stamp is retained", () => {
	withRoot((root) => {
		assert.equal(createStamp(root, { sid: "a", pid: 1, host: "h", token: "t1" }), true);
		assert.equal(createStamp(root, { sid: "b", pid: 2, host: "h", token: "t2" }), false); // never clobber
		const stamp = readStamp(root);
		assert.ok(stamp !== null && stamp !== "malformed" && stamp.sid === "a");
	});
});
t("locks: a dead or malformed holder is taken over; our own leftover is re-taken", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: readStartToken(process.pid) };
		fs.writeFileSync(lockPath(root, "test.lock"), JSON.stringify({ pid: 999999, host: "h", token: "gone" }));
		const live = takeLock(root, "test.lock", me);
		assert.equal(live.ok, true); // dead holder replaced
		if (live.ok) live.release();
		fs.writeFileSync(lockPath(root, "test.lock"), "not json");
		const malformed = takeLock(root, "test.lock", me);
		assert.equal(malformed.ok, true);
		if (malformed.ok) malformed.release();
		fs.writeFileSync(lockPath(root, "test.lock"), JSON.stringify({ pid: process.pid, host: "h", token: readStartToken(process.pid) }));
		const own = takeLock(root, "test.lock", me);
		assert.equal(own.ok, true); // own leftover re-taken, stale file gone
		if (own.ok) own.release();
	});
});
t("locks: a live foreign holder blocks", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: readStartToken(process.pid) };
		fs.writeFileSync(lockPath(root, "test.lock"), JSON.stringify({ pid: process.pid, host: "h", token: readStartToken(process.pid) }));
		const foreign = takeLock(root, "test.lock", { pid: -1, host: "other", token: "x" });
		assert.equal(foreign.ok, false); // foreign-host holder retained
	});
});
t("slugify: branch names → file slugs", () => {
	assert.equal(slugify("feat/slices-1_3"), "feat-slices-1-3");
	assert.equal(slugify("??"), "branch"); // never empty
});
t("binds: record → find (foreign sid) → spend exactly once", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: "T" };
		assert.equal(recordBinds(root, me, [{ kind: "tree", hash: "abc", sid: "lane-1", at: "now" }]), true);
		const found = findBind(root, "tree", "abc", "committer");
		assert.ok(found);
		assert.equal(found.sid, "lane-1");
		assert.equal(spendBind(root, me, "tree", "abc"), true);
		assert.equal(findBind(root, "tree", "abc", "committer"), undefined); // spent
	});
});
t("binds: the committer's own row never counts, another session's does", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: "T" };
		recordBinds(root, me, [{ kind: "tree", hash: "h1", sid: "me", at: "now" }]);
		assert.equal(findBind(root, "tree", "h1", "me"), undefined); // self-bind is a rubber stamp
		const found = findBind(root, "tree", "h1", "someone-else"); // another session may spend it
	assert.ok(found);
		assert.equal(found.sid, "me");
	});
});
t("binds: empty sid never counts", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: "T" };
		recordBinds(root, me, [{ kind: "post", hash: "h2", sid: "", at: "now" }]);
		assert.equal(findBind(root, "post", "h2", "x"), undefined);
	});
});
t("binds: re-recording the same hash dedupes; file stays valid JSON", () => {
	withRoot((root) => {
		const me = { pid: process.pid, host: "h", token: "T" };
		recordBinds(root, me, [
			{ kind: "tree", hash: "x", sid: "a", at: "1" },
			{ kind: "tree", hash: "x", sid: "b", at: "2" },
		]);
		const rows = readBinds(root).rows.filter((r) => r.hash === "x");
		assert.equal(rows.length, 1);
		assert.equal(rows[0].sid, "a"); // first (newest) wins
	});
});

process.exit(failures === 0 ? 0 : 1);
