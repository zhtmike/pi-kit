import assert from "node:assert/strict";
import { ALL_ACTIONS, actionOfShape, foldEntry, isApprovalAction, refuseCovered } from "../src/approvals.ts";

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

t("the coverable vocabulary is seven single-word actions (every gate action plus the coarse destructive grant)", () => {
	assert.deepEqual([...ALL_ACTIONS], ["commit", "push", "pr", "comment", "tag", "release", "destructive"]);
	assert.equal(isApprovalAction("commit"), true);
	assert.equal(isApprovalAction("merge"), false);
});

t("shape→action: one ask-tier action per gated command shape; commit and destructive have no shape", () => {
	assert.equal(actionOfShape("git push"), "push");
	assert.equal(actionOfShape("gh pr create"), "pr");
	assert.equal(actionOfShape("gh pr edit"), "pr"); // one trust domain: the PR compose surface
	assert.equal(actionOfShape("gh comment"), "comment");
	assert.equal(actionOfShape("git tag"), "tag");
	assert.equal(actionOfShape("gh release"), "release");
	assert.equal(actionOfShape("git reset"), undefined);
	assert.equal(actionOfShape("git commit"), undefined); // bash git commit is refuse-tier; the commit tool gates directly
});

t("fold: grants accumulate in file order; a clear terminates what precedes it", () => {
	let s = new Set<string>() as any;
	s = foldEntry(s, { granted: ["push"] });
	s = foldEntry(s, { granted: ["commit"] });
	assert.deepEqual([...s].sort(), ["commit", "push"]);
	s = foldEntry(s, { cleared: true });
	assert.deepEqual([...s], []);
	s = foldEntry(s, { granted: ["pr"] });
	assert.deepEqual([...s], ["pr"]);
});

t("refuseCovered: only the coarse destructive grant covers the refuse rows", () => {
	assert.equal(refuseCovered(new Set()), false);
	assert.equal(refuseCovered(new Set(["commit", "push", "pr", "comment", "tag", "release"])), false);
	assert.equal(refuseCovered(new Set(["destructive"])), true);
	assert.equal(refuseCovered(new Set(["push", "destructive"])), true);
});

process.exit(failures === 0 ? 0 : 1);
