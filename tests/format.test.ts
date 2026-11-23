import assert from "node:assert/strict";
import {
	approveBody,
	approveNextHint,
	approvalRecordFailedReason,
	bindBody,
	bindUnboundReason,
	bindPostNextHint,
	bindTreeNextHint,
	commitBody,
	commitLaneReason,
	checkoutWorktreeExists,
	checkoutWorktreeSynced,
	commitNextHint,
	draftBody,
	draftNextHint,
	assistanceConflictReason,
	gateApprovedLabel,
	notInGitTreeReason,
	previewCommand,
	postBody,
	postDialogBody,
	postLaneReason,
	postRepoUnresolvedReason,
	uncoveredReason,
	worktreeNextHint,
} from "../src/format.ts";

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

t("every hint is one bracketed [next: …] line naming a concrete step", () => {
	for (const h of [bindTreeNextHint(), bindPostNextHint(), commitNextHint(), draftNextHint(), worktreeNextHint(), approveNextHint()]) {
		assert.match(h, /^\[next: [^\s][^\n]*\]$/);
	}
});

t("result bodies end with their chain hint", () => {
	assert.match(bindBody("tree", "abcdef0123456789", "sid-1234"), /\n\[next: commit\(subject, body\) spends the row[^\n]*\]$/);
	assert.match(bindBody("post", "abcdef0123456789", "sid-1234"), /\n\[next: post with --body-file[^\n]*\]$/);
	assert.match(commitBody("sha1234567890", "dialog", "bind row (session abcd1234)", true, "", "stat", "msg"), /\n\[next: push when ready[^\n]*\]$/);
	assert.match(commitNextHint(), /checkout \(action clean\) clears this session's scratch once the work ships\]$/);
	assert.match(draftBody("pr_x.md", "https://x", "main", "feat", "abc123 x", "body"), /\n\[next: post \(kind pr, title, body <the checked body>\)[^\n]*\]$/);
	assert.match(approveBody(["commit", "push"], "push it"), /\n\[next: run the gated op[^\n]*\]$/);
});

t("commit body names approval, bind spend, hooks, stat, message — in that order", () => {
	const body = commitBody("deadbeef", "session approval", "waived (standing allow)", false, "hook out", "1 file", "subject\n\nbody");
	const order = ["commit deadbeef", "approval: session approval", "bind: waived (standing allow)", "hooks: hook out", "diff stat:", "message:"].map((s) => body.indexOf(s));
	assert.deepEqual([...order].sort((a, b) => a - b), order);
	assert.equal(order.every((i) => i >= 0), true);
});

t("footer label and the record-failure message", () => {
	assert.equal(gateApprovedLabel(["commit", "pr"]), "approved: commit, pr");
	assert.equal(approvalRecordFailedReason("short err"), "approval record failed: short err");
	assert.equal(approvalRecordFailedReason("x".repeat(200)), `approval record failed: ${"x".repeat(119)}…`);
	assert.equal(approvalRecordFailedReason("line\nbreaks   collapse"), "approval record failed: line breaks collapse");
});

t("dialog preview collapses whitespace and caps at 160", () => {
	assert.equal(previewCommand("git   push\n\t origin"), "git push origin");
	const capped = previewCommand(`x`.repeat(200));
	assert.equal(capped.length, 158);
	assert.ok(capped.endsWith("…"));
});

t("the uncovered refusal names the command and the three coverage channels", () => {
	const r = uncoveredReason("git push origin", "");
	assert.match(r, /^not covered: git push origin\./);
	assert.match(r, /standing allow, a session approval, or the interactive dialog/);
});

t("bind body scopes the own-sid rule to tree rows", () => {
	assert.match(bindBody("tree", "abcdef0123456789", "sid-1234"), /tree rows never count for the spender's own session/);
	assert.equal(bindBody("post", "abcdef0123456789", "sid-1234").includes("own sid never counts"), false);
});

t("the unbound refusal names the reviewer-lane convergence loop", () => {
	const r = bindUnboundReason();
	assert.match(r, /^refused: the staged tree is unbound/);
	assert.match(r, /reviewer lane with the review task in its brief and bind in its tools/);
	assert.match(r, /re-review after any further edits until the staged tree matches the bound tree/);
});

t("commit's lane refusal and the git-tree refusal carry their remedies", () => {
	assert.equal(
		commitLaneReason(),
		"commit refuses in a dispatched lane — lanes never land code; the parent session applies the patch and lands it through this gate",
	);
	assert.equal(
		notInGitTreeReason("/tmp/x"),
		"not inside a git work tree (from /tmp/x) — pass targetDir pointing inside the tree, or run from inside it",
	);
	assert.equal(assistanceConflictReason(), "body already carries an AI-assistance section — put the text inside it or drop the assistance param");
});

t("worktree bodies: exists names the as-is cases; synced names the re-root", () => {
	assert.match(checkoutWorktreeExists("/wt"), /worktree exists: \/wt \(returned as-is — already current, or dirty: its edits are unlanded work\)/);
	assert.equal(
		checkoutWorktreeSynced("/wt", "abcdef1234567890"),
		"worktree synced /wt to abcdef123456 (clean tree — re-rooted at the checkout's HEAD)\n[next: work under the returned path — its own git dir takes its own stamp]",
	);
});

t("post bodies: target, url, submitted, approval — in that order; lane and repo refusals name the fix", () => {
	const body = postBody("review", "owner/repo#12", "https://x/review", "summary 100 chars + 2 inline threads (a.ts:1, b.ts:2)", "session approval");
	const order = ["posted review → owner/repo#12", "https://x/review", "submitted:", "approval: session approval"].map((s) => body.indexOf(s));
	assert.deepEqual([...order].sort((a, b) => a - b), order);
	assert.equal(order.every((i) => i >= 0), true);
	assert.match(postLaneReason(), /refuses in a dispatched lane/);
	assert.match(postRepoUnresolvedReason(), /pass repo \('owner\/name'\)/);
	assert.match(postDialogBody("owner/repo#12", "summary 100 chars + 2 inline threads"), /^pi-kit: post to GitHub\?\nowner\/repo#12\nsummary 100 chars \+ 2 inline threads$/);
});

process.exit(failures === 0 ? 0 : 1);
