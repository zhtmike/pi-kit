import assert from "node:assert/strict";
import { parseApproval, foldEntry } from "../src/approvals.ts";

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
const grants = (text: string) => parseApproval(text).grants;

// --- the pinned exemplar families ------------------------------------------------------------
t("'commit the work. All have human approved.' grants commit (signal + verb, same message)", () => {
	assert.deepEqual(grants("commit the work. All have human approved."), ["commit"]);
});
t("'push a PR to demo-repo. All have human approved.' grants push and pr_create", () => {
	const g = grants("push a PR to demo-repo. All have human approved.");
	assert.ok(g.includes("push"));
	assert.ok(g.includes("pr_create"));
});
t("'Do not push, just commit. All have human approved.' covers commit only", () => {
	const g = grants("Do not push, just commit. All have human approved.");
	assert.ok(g.includes("commit"));
	assert.ok(!g.includes("push"));
});
t("'Inspect the previous commit. All have human approved.' covers nothing (noun guard)", () => {
	assert.deepEqual(grants("Inspect the previous commit. All have human approved."), []);
});
t("'pls continue pushing, I approved everything above' covers push (gerund + signal)", () => {
	assert.deepEqual(grants("pls continue pushing, I approved everything above"), ["push"]);
});
t("'LGTM' alone covers nothing but is a visible miss", () => {
	const p = parseApproval("LGTM");
	assert.deepEqual(p.grants, []);
	assert.equal(p.miss, true);
});
t("'merge it. LGTM' covers nothing (merge is never a gated verb)", () => {
	assert.deepEqual(grants("merge it. LGTM"), []);
});

// --- directive form -----------------------------------------------------------------------
t("imperative and permissive-modal directives grant", () => {
	assert.deepEqual(grants("push"), ["push"]);
	assert.deepEqual(grants("please commit the fix"), ["commit"]);
	assert.deepEqual(grants("can you push now?"), ["push"]);
	assert.deepEqual(grants("feel free to open a PR"), ["pr_create"]);
	assert.deepEqual(grants("go ahead and update the PR body"), ["pr_edit"]);
});
t("hedges do not grant", () => {
	assert.deepEqual(grants("maybe push later"), []);
	assert.deepEqual(grants("we should push eventually"), []);
});
t("noun-guarded verbs do not grant", () => {
	assert.deepEqual(grants("check the last push"), []);
	assert.deepEqual(grants("inspect this commit"), []);
});
t("prohibitions and withheld approvals never grant (the false-grant families)", () => {
	assert.deepEqual(grants("don't go ahead and push it"), []);
	assert.deepEqual(grants("I can't approve this yet — hold off before you push"), []);
	assert.deepEqual(grants("the run finished unapproved"), []);
	assert.deepEqual(grants("I committed the fix already"), []); // past-tense narration
	assert.deepEqual(grants("We pushed the hotfix"), []);
	assert.deepEqual(grants("do not try to push"), []); // negation across filler words
});
t("trailing hedges do not grant", () => {
	assert.deepEqual(grants("we can push later"), []);
});
t("negated verbs do not grant", () => {
	assert.deepEqual(grants("do not push anything"), []);
	assert.deepEqual(grants("don't commit yet"), []);
	assert.deepEqual(grants("don't ever push"), []); // negation across an adverb
	assert.deepEqual(grants("never just push"), []);
	assert.deepEqual(grants("can't simply commit"), []);
});

// --- fold/replay --------------------------------------------------------------------------
t("fold: grants accumulate in file order; a clear terminates what precedes it", () => {
	let s = new Set<string>() as any;
	s = foldEntry(s, { granted: ["push"] });
	s = foldEntry(s, { granted: ["commit"] });
	assert.deepEqual([...s].sort(), ["commit", "push"]);
	s = foldEntry(s, { cleared: true });
	assert.deepEqual([...s], []);
	s = foldEntry(s, { granted: ["pr_create"] });
	assert.deepEqual([...s], ["pr_create"]);
});

process.exit(failures === 0 ? 0 : 1);
