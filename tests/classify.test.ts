import assert from "node:assert/strict";
import { classifyCommand } from "../src/classify.ts";

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
const check = (cmd: string, expected: string) => {
	const got = tier(cmd);
	if (got !== expected) throw new Error(`${cmd}: expected ${expected}, got ${got}`);
};

// --- the allow default ---------------------------------------------------------------------
t("git reads are allow (with --no-pager/-P)", () => {
	for (const sub of ["status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "describe", "blame", "grep", "fetch", "reflog"]) {
		check(`git ${sub}`, "allow");
	}
	check("git --no-pager diff", "allow");
	check("git -P log --oneline -5", "allow");
});
t("routine local writes are allow — the blacklist gates only high risk", () => {
	for (const cmd of [
		"git branch feature",
		"git branch -m old new",
		"git branch -d feature",
		"git branch -f main abc123",
		"git switch main",
		"git switch -c feature",
		"git switch -C main abc123",
		"git checkout main",
		"git checkout src/a.ts", // bare file path — documented residue
		"git checkout -b feature",
		"git stash",
		"git stash push -m wip",
		"git stash pop",
		"git restore --staged src/a.ts",
		"git reset",
		"git reset HEAD~1",
		"git merge main",
		"git pull",
		"git pull --rebase origin main",
		"git cherry-pick abc123",
		"git revert abc123",
		"git am patch.mbox",
		"git config user.name x",
		"git config --global user.name x",
		"git config alias.doom '!git clean -fdx'",
		"git add -A",
		"git gc",
		"git gc --prune=now",
		"git prune",
		"git filter-repo --force",
		"git replace abc123 def456",
		"git worktree add ../wt",
		"git worktree remove -f ../wt",
		"git submodule update --init",
		"git clone https://github.com/o/r.git",
		"git init",
		"git rm -f src/a.ts",
		"git rm -rf build",
		"git remote add upstream git@github.com:o/r.git",
		"git remote remove origin",
		"git remote set-url origin git@github.com:o/r.git",
		"git remote prune origin",
		"git update-ref refs/heads/x abc123",
		"git update-ref -d refs/heads/x",
		"git symbolic-ref HEAD refs/heads/other",
		"git notes list",
		"git bisect start",
	]) {
		check(cmd, "allow");
	}
});
t("unlisted plausible subcommands default to allow", () => {
	for (const cmd of ["git var GIT_AUTHOR_IDENT", "git archive HEAD", "git bundle create x.bundle main", "git fast-export main"]) {
		check(cmd, "allow");
	}
});
t("relocated and -c-configured forms keep the tier (no escalation)", () => {
	const c = classifyCommand("git -C /other log");
	if (c.tier !== "allow" || c.targetDir !== "/other") throw new Error(`git -C /other log: ${JSON.stringify(c)}`);
	check("git --git-dir=/x/.git status", "allow");
	if (classifyCommand("git --git-dir /x/.git status").targetDir !== "/x/.git") throw new Error("--git-dir target lost");
	check("git -c foo.bar=1 status", "allow");
	check("git -c alias.x='!y' status", "allow");
	check("git --work-tree=/x status", "allow");
	check("git -C /other push origin main", "ask");
});
t("GIT_DIR relocates the claim target; GIT_* env never escalates", () => {
	const c = classifyCommand("GIT_DIR=/x/.git git log");
	if (c.tier !== "allow") throw new Error(`GIT_DIR git log: ${c.tier}`);
	if (c.targetDir !== "/x/.git") throw new Error(`target: ${c.targetDir}`);
	check("GIT_WORK_TREE=/x git status", "allow");
	check("env GIT_DIR=/x/.git git log", "allow");
});
t("relocated daily shapes flow at compound level", () => {
	check("git -C /repo switch feature", "allow");
	check("git -C /repo switch feature && git pull", "allow");
});
t("valueless git globals shift bare; unknown globals ask; implausible tokens ask", () => {
	check("git -p push origin main", "ask");
	check("git --bare push origin main", "ask");
	check("git --no-replace-objects status", "allow");
	check("git --weird-bool push origin main", "ask");
	check("git --namespace x push origin main", "ask");
	check("git", "ask");
	check("git --weird-value-path /tmp/x", "ask");
});

// --- ask -----------------------------------------------------------------------------------
t("git push (plain) is ask with shape git push", () => {
	const c = classifyCommand("git push origin main");
	if (c.tier !== "ask" || c.shape !== "git push") throw new Error(JSON.stringify(c));
});
t("git tag write forms ask; list forms flow", () => {
	check("git tag", "allow");
	check("git tag -l 'v*'", "allow");
	check("git tag --list", "allow");
	check("git tag -n5", "allow");
	check("git tag v1.0", "ask");
	check("git tag -a v1.0 -m msg", "ask");
	check("git tag -f v1.0 abc", "ask");
	check("git tag -d v1.0", "ask");
});
t("gh pr create asks; --body-file carries the bind target; no body is bind-free", () => {
	const c = classifyCommand("gh pr create --title x --body-file pr_draft.md");
	if (c.tier !== "ask" || c.bodyFile !== "pr_draft.md") throw new Error(JSON.stringify(c));
	const bare = classifyCommand("gh pr create --title x");
	if (bare.tier !== "ask" || bare.noBody !== true) throw new Error(JSON.stringify(bare));
});
t("gh pr edit with --title or --body-file asks; gh comment/review --comment ask", () => {
	check("gh pr edit 12 --title y", "ask");
	check("gh pr edit 12 --body-file f.md", "ask");
	if (classifyCommand("gh pr comment 12 --body-file f.md").shape !== "gh comment") throw new Error("shape");
	check("gh pr review 12 --comment --body-file f.md", "ask");
});
t("gh api implicit POST (any -f/-F) allows when no state path or prose rides it", () => {
	check("gh api graphql -f query='query { viewer { login } }'", "allow");
	check("gh api repos/o/r/issues -f title=x", "allow");
});
t("unlisted gh verbs allow; release publishing asks; unknown gh globals ask", () => {
	check("gh pr checkout 12", "allow");
	check("gh run watch 99", "allow");
	check("gh label create bug", "allow");
	check("gh issue create -t x", "ask");
	check("gh release create v1.0", "ask");
	check("gh release upload v1.0 a.zip", "ask");
	check("gh release delete v1.0", "refuse");
	check("gh browse", "allow");
	check("gh --weird-global pr merge 12", "ask");
	check("gh --hostname github.example.com pr view 12", "allow");
});
t("read-ish gh: pr view/diff/list, issue view/list, run list/view, repo view, search are allow", () => {
	for (const cmd of ["gh pr view 12", "gh pr diff 12", "gh pr list", "gh issue view 3", "gh issue list", "gh run list", "gh run view 99", "gh repo view", "gh search code foo", "gh search prs bar"]) {
		check(cmd, "allow");
	}
});
t("gh api GET is allow, incl. the mergeability probe", () => {
	check("gh api repos/o/r/pulls/12/merge", "allow");
	check("gh api -X GET repos/o/r/pulls/12", "allow");
});
t("gh -R/--repo consume their value (no misshapen subcommand)", () => {
	check("gh -R zhtmike/pi-kit pr view 12", "allow");
});

// --- destructive ---------------------------------------------------------------------------
t("worktree-discard and index-loss forms are destructive", () => {
	for (const cmd of [
		"git checkout -- src/a.ts",
		"git checkout .",
		"git checkout ./",
		"git checkout :/",
		"git checkout -f main",
		"git checkout -B main abc123",
		"git checkout HEAD -- src/a.ts",
		"git restore src/a.ts",
		"git restore --staged --worktree src/a.ts",
		"git restore -W src/a.ts",
		"git reset --hard HEAD~1",
		"git stash drop",
		"git stash clear",
		"git branch -D tmp",
		"git rebase main",
		"git clean -fd",
		"git commit --amend",
		"git commit --no-verify -m x",
		"git commit -n -m x",
		"git reflog expire --expire=now --all",
		"git reflog delete HEAD@{0}",
	]) {
		check(cmd, "destructive");
	}
});
t("force/delete push forms are destructive", () => {
	for (const cmd of ["git push --force origin main", "git push -f origin main", "git push --force-with-lease", "git push --force-if-includes", "git push origin +HEAD:main", "git push origin :branch", "git push origin --delete branch"]) {
		check(cmd, "destructive");
	}
});

// --- refuse --------------------------------------------------------------------------------
t("bash git commit refuses naming git_commit", () => {
	for (const cmd of ["git commit -m x", "git commit -F msg.txt", "git commit -t tpl.txt", "git commit"]) {
		const c = classifyCommand(cmd);
		if (c.tier !== "refuse" || !/git_commit/.test(c.reason ?? "")) throw new Error(`${cmd}: ${JSON.stringify(c)}`);
	}
});
t("gh state changes refuse: merge/close/reopen/ready/issue delete", () => {
	for (const cmd of ["gh pr merge 12", "gh pr close 12", "gh pr reopen 12", "gh pr ready 12", "gh issue close 3", "gh issue reopen 3", "gh issue delete 3"]) {
		check(cmd, "refuse");
	}
});
t("gh pr review --approve/--request-changes refuse; --comment stays ask", () => {
	check("gh pr review 12 --approve", "refuse");
	check("gh pr review 12 --request-changes", "refuse");
	check("gh pr review 12 --comment --body-file f.md", "ask");
});
t("gh api POST to merge/close paths refuses; graphql mutation refuses", () => {
	check("gh api -X PUT repos/o/r/pulls/12/merge", "refuse");
	check("gh api repos/o/r/pulls/12/merge -X PUT", "refuse");
	check("gh api graphql -f query='mutation { x }'", "refuse");
	check("gh api repos/o/r/issues -f title=x", "allow");
});
t("gh api POST carrying postable prose via -f body= refuses naming the bound --body-file path", () => {
	const c = classifyCommand("gh api repos/o/r/issues/1/comments -f body='hello'");
	if (c.tier !== "refuse" || !/--body-file/.test(c.reason ?? "")) throw new Error(JSON.stringify(c));
	check("gh api repos/o/r/issues/1/comments -F body_text=x", "refuse");
});
t("gh posts: inline --body and --body-file - refuse naming --body-file", () => {
	const c1 = classifyCommand("gh pr comment 12 --body 'hello'");
	if (c1.tier !== "refuse" || !/--body-file/.test(c1.reason ?? "")) throw new Error(JSON.stringify(c1));
	check("gh pr comment 12 --body-file -", "refuse");
	check("gh pr create --title x --body 'inline'", "refuse");
	check("gh pr edit 12 --body 'inline'", "refuse");
});

// --- self-match guard ----------------------------------------------------------------------
t("pkill -f/pgrep -f self-match blocks with the kill-by-PID remedy", () => {
	const c = classifyCommand("pkill -f night-watch");
	if (c.tier !== "selfmatch" || !/PID/.test(c.reason ?? "")) throw new Error(JSON.stringify(c));
	check("pgrep -f ray::", "selfmatch");
});
t("heredoc bodies are data — python bodies never gate; shell bodies stay commands", () => {
	// a python heredoc body containing git-shaped strings and apostrophes is stdin data
	check(`python3 - <<'PYEOF'\nt = t.replace(anchor, 'The blacklist's rows; check("git pull", "allow");')\nPYEOF\ngit status`, "allow");
	// a heredoc fed to a shell IS a script — its lines keep classifying
	check("bash <<EOF\ngit push origin main\nEOF", "ask");
	check("bash <<'EOF'\ngh pr merge 12\nEOF", "refuse");
	// arithmetic << cannot fake a heredoc tag and smuggle a gated command
	check("echo $((1<<2)) && git push origin main", "ask");
	// receiver spellings: no-space, wrapper, pipe, timeout, -s all land shell-side
	for (const c of ["sh<<EOF\ngit push origin main\nEOF", "sudo bash<<EOF\ngit push origin main\nEOF", "echo x | bash <<EOF\ngit push origin main\nEOF", "timeout 30 bash <<EOF\ngit push origin main\nEOF", "bash -s <<EOF\ngit push origin main\nEOF", "bash <<EOF && git push origin main\nbody\nEOF"]) {
		check(c, "ask");
	}
	// escaped quotes inside double quotes keep the string whole — no false split
	check('echo "a \"b\" && git push origin main"', "allow");
});

t("pkill without -f is unseen", () => {
	check("pkill python", "allow");
});

// --- unseen --------------------------------------------------------------------------------
t("non-git commands, redirections, and python one-liners are unseen", () => {
	check("echo hello", "allow");
	check("echo x >> tracked.md", "allow");
	check(`python3 -c "open('f','w').write('x')"`, "allow");
});

// --- compounds -----------------------------------------------------------------------------
t("compound combines most-restrictive-wins; cd relocates the target", () => {
	check("git status && gh pr merge 12", "refuse");
	check("git push && git rebase main", "destructive");
	check("echo a && git push", "ask");
	const c = classifyCommand("cd /repo && git status");
	if (c.tier !== "allow" || c.targetDir !== "/repo") throw new Error(JSON.stringify(c));
});
t("push args ride the git-push segment, not a naive token scan", () => {
	const c = classifyCommand("git log --grep push && git push origin main");
	if (c.tier !== "ask" || JSON.stringify(c.pushArgs) !== JSON.stringify(["origin", "main"])) throw new Error(JSON.stringify(c));
});
t("wrappers: sudo env git push classifies as the inner push", () => {
	check("sudo env git push origin main", "ask");
});

process.exit(failures === 0 ? 0 : 1);
