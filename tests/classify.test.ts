import assert from "node:assert/strict";
import { classifyCommand, classifySegment } from "../src/classify.ts";

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
const tier = (cmd: string) => classifyCommand(cmd).tier;
const shape = (cmd: string) => classifyCommand(cmd).shape;

// --- allow rows ---------------------------------------------------------------------------
t("git status/diff/log/show/ls-files/rev-parse/describe/blame/grep/fetch are allow", () => {
	for (const sub of ["status", "diff", "log", "show", "ls-files", "rev-parse", "describe", "blame", "grep", "fetch"]) {
		assert.equal(tier(`git ${sub}`), "allow", `git ${sub}`);
	}
});
t("git --no-pager diff and git -P diff are allow", () => {
	assert.equal(tier("git --no-pager diff"), "allow");
	assert.equal(tier("git -P log --oneline -5"), "allow");
});
t("read-ish gh: pr view/diff/list, issue view/list, run list/view, repo view, search are allow", () => {
	for (const cmd of ["gh pr view 12", "gh pr diff 12", "gh pr list", "gh issue view 3", "gh issue list", "gh run list", "gh run view 99", "gh repo view", "gh search code foo", "gh search prs bar"]) {
		assert.equal(tier(cmd), "allow", cmd);
	}
});
t("gh api GET is allow, incl. the mergeability probe", () => {
	assert.equal(tier("gh api repos/o/r/pulls/12/merge"), "allow");
	assert.equal(tier("gh api -X GET repos/o/r/pulls/12"), "allow");
});

// --- ask rows -----------------------------------------------------------------------------
t("git push (plain) is ask with shape git push", () => {
	const c = classifyCommand("git push origin main");
	assert.equal(c.tier, "ask");
	assert.equal(c.shape, "git push");
});
t("gh pr create asks; --body-file carries the bind target; no body is bind-free", () => {
	const c = classifyCommand("gh pr create --title x --body-file pr_draft.md");
	assert.equal(c.tier, "ask");
	assert.equal(c.bodyFile, "pr_draft.md");
	const bare = classifyCommand("gh pr create --title x");
	assert.equal(bare.tier, "ask");
	assert.equal(bare.noBody, true);
});
t("gh pr edit with --title or --body-file asks; gh comment/review --comment ask", () => {
	assert.equal(tier("gh pr edit 12 --title y"), "ask");
	assert.equal(tier("gh pr edit 12 --body-file f.md"), "ask");
	assert.equal(shape("gh pr comment 12 --body-file f.md"), "gh comment");
	assert.equal(tier("gh pr review 12 --comment --body-file f.md"), "ask");
});
t("gh api implicit POST (any -f/-F) asks; graphql read asks", () => {
	assert.equal(tier("gh api graphql -f query='query { viewer { login } }'"), "ask");
	assert.equal(tier("gh api repos/o/r/issues -f title=x"), "ask");
});
t("git -C/--git-dir/-c/--work-tree make the tier at least ask; -C relocates the claim target", () => {
	assert.equal(tier("git -C /other status"), "ask");
	assert.equal(classifyCommand("git -C /other status").targetDir, "/other");
	assert.equal(tier("git --git-dir=/x/.git status"), "ask");
	assert.equal(classifyCommand("git --git-dir /x/.git status").targetDir, "/x/.git");
	assert.equal(tier("git -c foo.bar=1 status"), "ask");
});
t("unknown git/gh shapes ask", () => {
	assert.equal(tier("git filter-repo --dry-run"), "ask");
	assert.equal(tier("gh browse"), "ask");
});
t("compound: echo a && git push asks; cd relocates the target", () => {
	assert.equal(tier("echo a && git push"), "ask");
	const c = classifyCommand("cd /repo && git status");
	assert.equal(c.tier, "allow");
	assert.equal(c.targetDir, "/repo");
});
t("wrappers: sudo env git push classifies as the inner push", () => {
	assert.equal(tier("sudo env git push origin main"), "ask");
});
t("git add is allow with its own shape (the claim floor's gate)", () => {
	const c = classifyCommand("git add -A");
	assert.equal(c.tier, "allow");
	assert.equal(c.shape, "git add");
});

// --- destructive rows ---------------------------------------------------------------------
t("force/delete push forms are destructive", () => {
	for (const cmd of ["git push --force origin main", "git push -f origin main", "git push --force-with-lease", "git push --force-if-includes", "git push origin +HEAD:main", "git push origin :branch", "git push origin --delete branch"]) {
		assert.equal(tier(cmd), "destructive", cmd);
	}
});
t("rebase/reset --hard/clean/commit --amend/commit --no-verify/commit -n are destructive", () => {
	for (const cmd of ["git rebase main", "git reset --hard HEAD~1", "git clean -fd", "git commit --amend", "git commit --no-verify -m x", "git commit -n -m x"]) {
		assert.equal(tier(cmd), "destructive", cmd);
	}
});
t("restore/checkout -- path/checkout . /stash drop/stash clear/branch -D are destructive", () => {
	for (const cmd of ["git restore src/a.ts", "git restore .", "git checkout -- src/a.ts", "git checkout .", "git stash drop", "git stash clear", "git branch -D tmp"]) {
		assert.equal(tier(cmd), "destructive", cmd);
	}
});
t("reflog expire/delete destructive; plain reflog allow", () => {
	assert.equal(tier("git reflog"), "allow");
	assert.equal(tier("git reflog expire --expire=now --all"), "destructive");
});

// --- refuse rows --------------------------------------------------------------------------
t("bash git commit refuses naming git_commit", () => {
	for (const cmd of ["git commit -m x", "git commit -F msg.txt", "git commit -t tpl.txt", "git commit"]) {
		const c = classifyCommand(cmd);
		assert.equal(c.tier, "refuse", cmd);
		assert.match(c.reason ?? "", /git_commit/);
	}
});
t("gh state changes refuse: merge/close/reopen/ready/issue delete", () => {
	for (const cmd of ["gh pr merge 12", "gh pr close 12", "gh pr reopen 12", "gh pr ready 12", "gh issue close 3", "gh issue reopen 3", "gh issue delete 3"]) {
		assert.equal(tier(cmd), "refuse", cmd);
	}
});
t("gh pr review --approve/--request-changes refuse; --comment stays ask", () => {
	assert.equal(tier("gh pr review 12 --approve"), "refuse");
	assert.equal(tier("gh pr review 12 --request-changes"), "refuse");
	assert.equal(tier("gh pr review 12 --comment --body-file f.md"), "ask");
});
t("gh api POST to merge/close paths refuses; graphql mutation refuses; non-mutation POST asks", () => {
	assert.equal(tier("gh api -X PUT repos/o/r/pulls/12/merge"), "refuse");
	assert.equal(tier("gh api repos/o/r/pulls/12/merge -X PUT"), "refuse");
	assert.equal(tier("gh api graphql -f query='mutation { x }'"), "refuse");
	assert.equal(tier("gh api repos/o/r/issues -f title=x"), "ask");
});
t("gh api POST carrying postable prose via -f body= refuses naming the bound --body-file path", () => {
	const c = classifyCommand("gh api repos/o/r/issues/1/comments -f body='hello'");
	assert.equal(c.tier, "refuse");
	assert.match(c.reason ?? "", /--body-file/);
	assert.equal(tier("gh api repos/o/r/issues/1/comments -F body_text=x"), "refuse");
});
t("gh posts: inline --body and --body-file - refuse naming --body-file", () => {
	const c1 = classifyCommand("gh pr comment 12 --body 'hello'");
	assert.equal(c1.tier, "refuse");
	assert.match(c1.reason ?? "", /--body-file/);
	assert.equal(tier("gh pr comment 12 --body-file -"), "refuse");
	assert.equal(tier("gh pr create --title x --body 'inline'"), "refuse");
	assert.equal(tier("gh pr edit 12 --body 'inline'"), "refuse");
});

// --- self-match guard ---------------------------------------------------------------------
t("pkill -f/pgrep -f self-match blocks with the kill-by-PID remedy", () => {
	const c = classifyCommand("pkill -f night-watch");
	assert.equal(c.tier, "selfmatch");
	assert.match(c.reason ?? "", /PID/);
	assert.equal(tier("pgrep -f ray::"), "selfmatch");
});
t("pkill without -f is unseen", () => {
	assert.equal(tier("pkill python"), "allow");
});

// --- unseen -------------------------------------------------------------------------------
t("non-git commands, redirections, and python one-liners are unseen", () => {
	assert.equal(tier("echo hello"), "allow");
	assert.equal(tier("echo x >> tracked.md"), "allow");
	assert.equal(tier('python3 -c "open(\'f\',\'w\').write(\'x\')"'), "allow");
	assert.equal(shape("make build"), "other");
});

// --- most-restrictive-wins ----------------------------------------------------------------
t("compound combines most-restrictive-wins", () => {
	assert.equal(tier("git status && gh pr merge 12"), "refuse");
	assert.equal(tier("git push && git rebase main"), "destructive");
});

process.exit(failures === 0 ? 0 : 1);
