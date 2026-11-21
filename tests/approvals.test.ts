import assert from "node:assert/strict";
import { ALL_ACTIONS, foldEntry, isApprovalAction } from "../src/approvals.ts";

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

t("the coverable vocabulary is the four ask-tier actions", () => {
	assert.deepEqual([...ALL_ACTIONS], ["commit", "push", "pr_create", "pr_edit"]);
	assert.equal(isApprovalAction("commit"), true);
	assert.equal(isApprovalAction("merge"), false);
});

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
