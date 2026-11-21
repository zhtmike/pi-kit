import assert from "node:assert/strict";
import { DEFAULT_CONFIG, loadConfig, standingCovers, ASK_SHAPES } from "../src/config.ts";
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

const withDir = (files: Record<string, string>, fn: (dir: string) => void): void => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pikit-cfg-"));
	for (const [rel, text] of Object.entries(files)) {
		const p = path.join(dir, rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, text);
	}
	try {
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

t("defaults: no files → empty owners, no standing allows", () => {
	withDir({}, (dir) => {
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = path.join(dir, "agent");
		try {
			const cfg = loadConfig(path.join(dir, "proj"));
			assert.deepEqual(cfg.ownerLogins, []);
			assert.deepEqual(cfg.standingAllows, []);
			assert.equal(cfg.agentName, "pi");
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});
});

t("nested overwrite: agent dir then project, later layers win whole keys", () => {
	withDir(
		{
			"agent/pi-kit.json": JSON.stringify({ agentName: "k", ownerLogins: ["a"], standingAllows: [{ repo: "a/r", shapes: ["git push"] }] }),
			"proj/.pi/pi-kit.json": JSON.stringify({ ownerLogins: ["b"] }),
		},
		(dir) => {
			const prev = process.env.PI_CODING_AGENT_DIR;
			process.env.PI_CODING_AGENT_DIR = path.join(dir, "agent");
			try {
				const cfg = loadConfig(path.join(dir, "proj"));
				assert.equal(cfg.agentName, "k"); // untouched key survives from agent layer
				assert.deepEqual(cfg.ownerLogins, ["b"]); // arrays replace, never merge
				assert.equal(cfg.standingAllows.length, 1);
			} finally {
				if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = prev;
			}
		},
	);
});

t("unknown key throws naming the file and valid keys", () => {
	withDir({ "agent/pi-kit.json": JSON.stringify({ nope: 1 }) }, (dir) => {
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = path.join(dir, "agent");
		try {
			assert.throws(() => loadConfig(dir), /unknown config key 'nope'.*agentName, ownerLogins, standingAllows/);
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});
});

t("destructive/refuse shapes are rejected at load with the valid list", () => {
	withDir({ "agent/pi-kit.json": JSON.stringify({ standingAllows: [{ repo: "a/r", shapes: ["git push --force"] }] }) }, (dir) => {
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = path.join(dir, "agent");
		try {
			assert.throws(() => loadConfig(dir), /not a standing-allowable shape.*git_commit/);
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});
});

t("standingCovers: exact repo, wildcard, and miss", () => {
	const cfg = { ...DEFAULT_CONFIG, standingAllows: [{ repo: "zhtmike/skills", shapes: ["git_commit" as const] }, { repo: "*", shapes: ["gh comment" as const] }] };
	assert.equal(standingCovers(cfg, "zhtmike/skills", "git_commit"), true);
	assert.equal(standingCovers(cfg, "ZhtMike/Skills", "git_commit"), true); // case-insensitive
	assert.equal(standingCovers(cfg, "zhtmike/other", "git_commit"), false);
	assert.equal(standingCovers(cfg, "zhtmike/other", "gh comment"), true); // *
	assert.equal(standingCovers(cfg, undefined, "gh comment"), true); // * matches even unresolvable repos
	assert.equal(standingCovers(cfg, undefined, "git_commit"), false);
});

t("ask shapes are the only allowable set", () => {
	assert.equal(ASK_SHAPES.length, 5);
});

process.exit(failures === 0 ? 0 : 1);
