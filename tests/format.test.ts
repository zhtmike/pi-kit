import assert from "node:assert/strict";
import { identityFrom } from "../src/identity.ts";
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
	commitOwnDisclosureReason,
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
	postAnchorOutsideDiffReason,
	postAnchorDeletedReason,
	postGhFailedReason,
	postRepoUnresolvedReason,
	postThreadAnchors,
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
	for (const h of [bindTreeNextHint(), bindPostNextHint(), commitNextHint(), draftNextHint(), worktreeNextHint(), approveNextHint(), approveNextHint(true)]) {
		assert.match(h, /^\[next: [^\s][^\n]*\]$/);
	}
});

t("result bodies end with their chain hint", () => {
	assert.match(bindBody("tree", "abcdef0123456789", "sid-1234"), /\n\[next: commit\(subject, body\) spends the row[^\n]*\]$/);
	assert.match(bindBody("post", "abcdef0123456789", "sid-1234"), /\n\[next: post with --body-file[^\n]*\]$/);
	assert.match(commitBody("sha1234567890", "dialog", "bind row (session abcd1234)", true, "", "stat", "msg"), /\n\[next: push when ready[^\n]*\]$/);
	assert.match(commitNextHint(), /checkout \(action clean\) clears this session's scratch once the work ships\]$/);
	assert.match(draftBody("pr_x.md", "https://x", "main", "feat", "abc123 x", "body"), /\n\[next: post \(kind pr, title, body <the checked body>\)[^\n]*\]$/);
	assert.match(approveBody(["commit", "push"], "push it"), /\n\[next: if the approval covered every gate[^\n]*\]$/);
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

t("approve's result names the actions left out; destructive among them names the mid-run stop and the blanket-approval follow-up", () => {
	// the pre-approved long run: "all gates" recorded as four actions, then a stash drop stopped at a dialog
	assert.equal(
		approveBody(["commit", "push", "pr", "comment"], "I have pre-approved all gates"),
		'recorded: commit, push, pr, comment approved for this session ("I have pre-approved all gates") — coverage until quit. Not granted: tag, release, destructive.\n' +
			"A destructive shape — git reset --hard, git stash drop, checkout -- <path>, rebase, a force push, commit --amend — still stops at a dialog mid-run; a refuse shape — bash git commit, gh pr merge, gh pr review --approve, gh api prose — blocks naming the destructive grant.\n" +
			'[next: if the approval covered every gate ("all gates", YOLO), call approve with destructive too — it covers every shape past ask; the granted ops already run without a dialog]',
	);
	assert.equal(
		approveBody(["push", "destructive"], "push it, and yes to the reset"),
		'recorded: push, destructive approved for this session ("push it, and yes to the reset") — coverage until quit. Not granted: commit, pr, comment, tag, release.\n' +
			"Those shapes still stop the run.\n" +
			"[next: run the granted ops — they proceed without a dialog until this session quits]",
	);
	assert.equal(
		approveBody(["commit", "push", "pr", "comment", "tag", "release", "destructive"], "yolo"),
		'recorded: commit, push, pr, comment, tag, release, destructive approved for this session ("yolo") — coverage until quit. Every gate is covered.\n' +
			"[next: run — every gate action is covered until this session quits]",
	);
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
	assert.equal(
		commitOwnDisclosureReason("body line 3: AI assistance (pi coding agent, GLM-5.4) was used for this change.", identityFrom("pi", { id: "glm-5.4" })),
		'the commit message carries its own AI-assistance disclosure — body line 3: AI assistance (pi coding agent, GLM-5.4) was used for this change. — and the tool injects its own ("AI-assistance: pi (glm-5.4)", "Co-authored-by: pi <noreply@pi.dev>")\ndrop the line: a message carrying both lands the footnote twice',
	);
	// no model: the injected set is the co-author alone
	assert.match(commitOwnDisclosureReason("trailer 1: AI-assistance: pi", identityFrom("pi", undefined)), /injects its own \("Co-authored-by: pi <noreply@pi.dev>"\)$/m);
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
	assert.equal(
		postAnchorOutsideDiffReason(["docs/api/reward.rst:104"]),
		"comment on 'docs/api/reward.rst:104' anchors outside the diff — GitHub threads diffed files only; anchor on the nearest diffed line (file/line) and pass cites for the finding's own location",
	);
	assert.match(postAnchorOutsideDiffReason(["a.rst:1", "b.md:2"]), /^comments on 'a\.rst:1', 'b\.md:2' anchor outside the diff — GitHub threads diffed files only/);
	assert.equal(
		postAnchorDeletedReason(["removed.py:1"]),
		"comment on 'removed.py:1' anchors in a file with no diffed line to thread — its changes are removals only; anchor in a diffed file and pass cites for the finding's own location",
	);
});

t("post's thread list names each moved anchor; the gh failure keeps GitHub's body and adds the anchor remedy only for a threaded 4xx", () => {
	const threads = [
		{ file: "a.md", line: 553, severity: "minor" as const, ask: "x" },
		{ file: "b.py", line: 36, severity: "minor" as const, ask: "y" },
	];
	assert.equal(postThreadAnchors(threads, [{ index: 0, from: 3, to: 553 }]), "a.md:553 (was :3), b.py:36");
	assert.equal(postThreadAnchors(threads, []), "a.md:553, b.py:36");
	assert.equal(postThreadAnchors([], []), "");
	const seven = Array.from({ length: 7 }, (_, i) => ({ file: `f${i}`, line: i + 1, severity: "minor" as const, ask: "x" }));
	assert.equal(postThreadAnchors(seven, []), "f0:1, f1:2, f2:3, f3:4, f4:5, …");

	const body = '{\n  "message": "Validation Failed",\n  "errors": [\n    {\n      "field": "comments[data][line]",\n      "code": "invalid"\n    }\n  ]\n}';
	const gh = postGhFailedReason("POST", "repos/o/r/pulls/947/reviews", 1, "gh: Unprocessable Entity (HTTP 422)\n", body, 3);
	const lines = gh.split("\n");
	assert.equal(lines.length, 3);
	assert.equal(lines[0], "gh api POST repos/o/r/pulls/947/reviews failed (exit 1): gh: Unprocessable Entity (HTTP 422)");
	assert.equal(lines[1], "GitHub: Validation Failed — comments[data][line]: invalid");
	assert.match(lines[2], /^Threads anchor on the PR diff's right-side lines at its current head/);
	// no threads, or not a 4xx: no anchor remedy (the body still shows); a stdout-only failure still shows its line
	assert.equal(
		postGhFailedReason("POST", "repos/o/r/issues/1/comments", 1, "gh: Unprocessable Entity (HTTP 422)\n", '{"message":"Validation Failed"}', 0),
		"gh api POST repos/o/r/issues/1/comments failed (exit 1): gh: Unprocessable Entity (HTTP 422)\nGitHub: Validation Failed",
	);
	const serverError = postGhFailedReason("POST", "repos/o/r/pulls/947/reviews", 1, "gh: Internal Server Error (HTTP 500)\n", body, 3).split("\n");
	assert.equal(serverError.length, 2);
	assert.equal(serverError[1], "GitHub: Validation Failed — comments[data][line]: invalid");
	assert.equal(postGhFailedReason("POST", "repos/o/r/pulls", 1, "", "raw failure text", 2), "gh api POST repos/o/r/pulls failed (exit 1): raw failure text");
});

process.exit(failures === 0 ? 0 : 1);
