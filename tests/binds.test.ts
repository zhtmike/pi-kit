import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	BINDS_NAME,
	bindsPath,
	sha256File,
	readBinds,
	recordBinds,
	spendBind,
	findBind,
	type BindRow,
	type BindsFile,
} from "../src/binds.ts";

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

const me = { pid: process.pid, host: "h", token: "T" };
const BINDS_LOCK = "REVIEW_BINDS.lock";

// --- temp roots (pattern from tests/claim.test.ts) ----------------------------------------
const withRoot = (fn: (root: string) => void): void => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pikit-binds-"));
	fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
	try {
		fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
};
const withBareRoot = (fn: (root: string) => void): void => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pikit-bare-"));
	try {
		fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
};

const row = (kind: BindRow["kind"], hash: string, sid: string, at = "now"): BindRow => ({ kind, hash, sid, at });
const seedBinds = (root: string, rows: BindRow[]): void => {
	fs.writeFileSync(bindsPath(root), JSON.stringify({ version: 1, rows }) + "\n");
};
/** A foreign-host lock holder — takeLock refuses on host mismatch alone, no liveness probe. */
const holdLock = (root: string): void => {
	fs.writeFileSync(path.join(root, ".pi", BINDS_LOCK), JSON.stringify({ pid: process.pid, host: "other-host", token: "x" }) + "\n");
};

// --- BINDS_NAME / bindsPath ---------------------------------------------------------------
t("BINDS_NAME / bindsPath: the binds file lives at root/.pi/REVIEW_BINDS.json", () => {
	assert.equal(BINDS_NAME, "REVIEW_BINDS.json");
	assert.equal(bindsPath("/r"), "/r/.pi/REVIEW_BINDS.json");
});

// --- sha256File ---------------------------------------------------------------------------
t("sha256File: hex sha256 of the exact file bytes (known digests); a missing file throws ENOENT", () => {
	withBareRoot((root) => {
		const f = path.join(root, "f");
		fs.writeFileSync(f, "hello");
		assert.equal(sha256File(f), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
		fs.writeFileSync(f, "");
		assert.equal(sha256File(f), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		fs.writeFileSync(f, "hello\n");
		assert.equal(sha256File(f), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
		assert.throws(() => sha256File(path.join(root, "missing")), /ENOENT/);
	});
});

// --- readBinds -----------------------------------------------------------------------------
t("readBinds: absent file → BindsFile {version: 1, rows: []}", () => {
	withRoot((root) => {
		const v: BindsFile = readBinds(root);
		assert.deepEqual(v, { version: 1, rows: [] });
	});
});
t("readBinds: valid rows come back as-is; the file's version field is ignored (even absent or non-1)", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "h1", "lane-1", "t1")]);
		assert.deepEqual(readBinds(root), { version: 1, rows: [row("tree", "h1", "lane-1", "t1")] });
		fs.writeFileSync(bindsPath(root), JSON.stringify({ version: 99, rows: [row("tree", "x", "s", "a")] }) + "\n");
		assert.equal(readBinds(root).version, 1); // normalized — 99 never surfaces
		fs.writeFileSync(bindsPath(root), JSON.stringify({ rows: [row("tree", "x", "s", "a")] }) + "\n");
		assert.equal(readBinds(root).version, 1); // version may be missing entirely
	});
});
t("readBinds: unparseable content (empty file, garbage) throws 'not parseable JSON'", () => {
	withRoot((root) => {
		for (const bad of ["", "not json", "{trailing"]) {
			fs.writeFileSync(bindsPath(root), bad);
			assert.throws(() => readBinds(root), /not parseable JSON/);
		}
	});
});
t("readBinds: parseable but wrong shape throws 'malformed'", () => {
	withRoot((root) => {
		for (const bad of ["{}", "[]", "null", "42", '{"rows":{}}', '{"rows":1}']) {
			fs.writeFileSync(bindsPath(root), bad);
			assert.throws(() => readBinds(root), /malformed/);
		}
	});
});
t("readBinds: rows failing the kind/hash/sid shape check are silently dropped", () => {
	withRoot((root) => {
		fs.writeFileSync(
			bindsPath(root),
			JSON.stringify({
				version: 1,
				rows: [
					row("tree", "ok1", "s1"),
					{ kind: "blob", hash: "x", sid: "s", at: "a" }, // kind not tree|post
					{ kind: "tree", sid: "s", at: "a" }, // hash not a string
					{ kind: "tree", hash: "x", at: "a" }, // sid not a string
					null,
					"str",
					{ kind: "tree", hash: 7, sid: 8 },
					{ kind: "post", hash: "ok2", sid: "s2" }, // `at` absent — still kept
				],
			}) + "\n",
		);
		assert.deepEqual(readBinds(root).rows.map((r) => r.hash), ["ok1", "ok2"]);
	});
});
t("readBinds: a non-file at the binds path reads as empty binds — read errors beyond ENOENT are swallowed", () => {
	withRoot((root) => {
		// stamp.ts's lock/stamp readers rethrow everything but ENOENT; binds.ts swallows the lot
		fs.mkdirSync(bindsPath(root));
		assert.deepEqual(readBinds(root), { version: 1, rows: [] });
	});
});

// --- recordBinds ---------------------------------------------------------------------------
t("recordBinds: returns true, prepends new rows before existing ones, leaves valid JSON and no lock/tmp residue", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "old", "lane-0", "t0")]);
		assert.equal(recordBinds(root, me, [row("tree", "new1", "lane-1", "t1"), row("post", "new2", "lane-2", "t2")]), true);
		const rows = readBinds(root).rows;
		assert.deepEqual(rows.map((r) => r.hash), ["new1", "new2", "old"]); // newest first
		const raw = fs.readFileSync(bindsPath(root), "utf8");
		assert.ok(raw.endsWith("\n"));
		assert.deepEqual(JSON.parse(raw), { version: 1, rows });
		assert.deepEqual(fs.readdirSync(path.join(root, ".pi")), [BINDS_NAME]); // lock released, no tmp leftovers
	});
});
t("recordBinds: creates .pi and an empty binds file even when add is empty", () => {
	withBareRoot((root) => {
		assert.equal(fs.existsSync(path.join(root, ".pi")), false);
		assert.equal(recordBinds(root, me, []), true);
		assert.deepEqual(readBinds(root), { version: 1, rows: [] });
	});
});
t("recordBinds: empty add over an existing file is a content no-op", () => {
	withRoot((root) => {
		const rows = [row("tree", "a", "s", "1"), row("post", "b", "s", "2")];
		seedBinds(root, rows);
		assert.equal(recordBinds(root, me, []), true);
		assert.deepEqual(readBinds(root).rows, rows);
	});
});
t("recordBinds: dedupe is kind+hash keyed — first add row wins, the same hash under the other kind survives", () => {
	withRoot((root) => {
		recordBinds(root, me, [row("tree", "x", "first", "1"), row("tree", "x", "second", "2"), row("post", "x", "third", "3")]);
		assert.deepEqual(readBinds(root).rows, [row("tree", "x", "first", "1"), row("post", "x", "third", "3")]);
	});
});
t("recordBinds: re-recording an existing kind+hash replaces the old row (replacement lands at the front)", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "old", "0"), row("tree", "y", "keep", "0")]);
		recordBinds(root, me, [row("tree", "x", "new", "1")]);
		assert.deepEqual(readBinds(root).rows.map((r: BindRow) => `${r.kind}:${r.hash}:${r.sid}`), ["tree:x:new", "tree:y:keep"]);
	});
});
t("recordBinds: MAX_ROWS — only the 100 freshest rows survive", () => {
	withRoot((root) => {
		seedBinds(root, Array.from({ length: 120 }, (_, i) => row("tree", `old-${i}`, "lane", `t${i}`)));
		recordBinds(root, me, [row("tree", "fresh", "lane", "now")]);
		const rows = readBinds(root).rows;
		assert.equal(rows.length, 100);
		assert.equal(rows[0].hash, "fresh");
		assert.deepEqual(rows.slice(1).map((r) => r.hash), Array.from({ length: 99 }, (_, i) => `old-${i}`)); // old-99..old-119 dropped
	});
});
t("recordBinds: returns false when the lock is held live — the file is not touched", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "s", "1")]);
		holdLock(root);
		assert.equal(recordBinds(root, me, [row("tree", "y", "s", "2")]), false);
		assert.deepEqual(readBinds(root).rows.map((r) => r.hash), ["x"]);
	});
});
t("recordBinds/spendBind: a corrupt binds file is never rewritten — the parse error propagates and content stands", () => {
	withRoot((root) => {
		fs.writeFileSync(bindsPath(root), "{corrupt");
		assert.throws(() => recordBinds(root, me, [row("tree", "x", "s", "1")]), /not parseable JSON/);
		assert.equal(fs.readFileSync(bindsPath(root), "utf8"), "{corrupt");
		assert.throws(() => spendBind(root, me, "tree", "x"), /not parseable JSON/);
		assert.equal(fs.readFileSync(bindsPath(root), "utf8"), "{corrupt");
	});
});

// --- spendBind -----------------------------------------------------------------------------
t("spendBind: removes exactly the matching row — exactly-once; a repeat spend is a true no-op", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "lane", "1"), row("post", "y", "lane", "2")]);
		assert.equal(spendBind(root, me, "tree", "x"), true);
		assert.deepEqual(readBinds(root).rows.map((r) => r.hash), ["y"]); // only x gone
		assert.equal(spendBind(root, me, "tree", "x"), true); // already spent — still true
		assert.deepEqual(readBinds(root).rows.map((r) => r.hash), ["y"]); // nothing else lost
	});
});
t("spendBind: a missing row returns true and writes nothing — an absent file is not created", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "lane", "1")]);
		assert.equal(spendBind(root, me, "tree", "nope"), true);
		assert.equal(readBinds(root).rows.length, 1);
	});
	withRoot((root) => {
		assert.equal(spendBind(root, me, "tree", "x"), true);
		assert.equal(fs.existsSync(bindsPath(root)), false);
	});
});
t("spendBind: the key is kind+hash — the same hash under the other kind survives", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "lane", "1"), row("post", "x", "lane", "2")]);
		spendBind(root, me, "tree", "x");
		assert.deepEqual(readBinds(root).rows.map((r) => r.kind), ["post"]);
	});
});
t("spendBind: sid is not consulted — the committer's own row is spent like any other", () => {
	withRoot((root) => {
		recordBinds(root, me, [row("tree", "own", "me", "1")]);
		assert.equal(findBind(root, "tree", "own", "me"), undefined); // find refuses the self-bind…
		assert.equal(spendBind(root, me, "tree", "own"), true); // …but spend removes it anyway
		assert.deepEqual(readBinds(root).rows, []);
	});
});
t("spendBind: returns false when the lock is held live — rows untouched", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "lane", "1")]);
		holdLock(root);
		assert.equal(spendBind(root, me, "tree", "x"), false);
		assert.equal(readBinds(root).rows.length, 1);
	});
});

// --- findBind ------------------------------------------------------------------------------
t("findBind: absent file → undefined", () => {
	withRoot((root) => {
		assert.equal(findBind(root, "tree", "x", "committer"), undefined);
	});
});
t("findBind: skips empty-sid and notSid rows, first surviving row wins, kind must match", () => {
	withRoot((root) => {
		seedBinds(root, [
			row("tree", "x", "", "1"), // empty sid never counts
			row("tree", "x", "committer", "2"), // the committer's own row
			row("tree", "x", "lane-1", "3"),
			row("tree", "x", "lane-2", "4"), // later duplicate — not reached
			row("post", "x", "lane-3", "5"), // kind mismatch for a tree query
			row("tree", "other", "lane-4", "6"), // hash mismatch
		]);
		const found = findBind(root, "tree", "x", "committer");
		assert.ok(found);
		assert.deepEqual(found, row("tree", "x", "lane-1", "3"));
		assert.equal(findBind(root, "post", "x", "nobody")?.sid, "lane-3"); // kind-keyed query
	});
});
t("findBind: notSid excludes exactly one sid — other rows (even the old committer row) still match", () => {
	withRoot((root) => {
		seedBinds(root, [row("tree", "x", "", "1"), row("tree", "x", "committer", "2"), row("tree", "x", "lane", "3")]);
		// excluding the lane bind leaves the committer row findable…
		assert.equal(findBind(root, "tree", "x", "lane")?.sid, "committer");
		// …and an empty notSid only guards against empty-sid rows
		assert.equal(findBind(root, "tree", "x", "")?.sid, "committer");
	});
});

process.exit(failures === 0 ? 0 : 1);
