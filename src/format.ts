/**
 * pi-kit presentation — every composite human-facing text for the floors,
 * dialogs, tool results, and the statusbar footer, in one pure module (no
 * host imports). Decision-attached reasons stay with their decisions (claim
 * rows in claim.ts, classifier refusals in classify.ts); what lands here is
 * the composition: result bodies, dialog bodies, `[next: …]` hints, footer
 * labels. Hints and runtime refusals carry the workflow mechanics so the
 * tool schemas stay lean (docs/api.md's minimal-descriptions contract).
 */

/** Wrap one chained next-step hint — appended to a result only when the step is real for the caller. */
function nextHint(text: string): string {
	return `[next: ${text}]`;
}

/** bind(tree) → the commit that spends the row. */
export function bindTreeNextHint(): string {
	return nextHint("commit(subject, body) spends the row — the staged tree must not change in between");
}

/** bind(post) → the gh post that spends the row. */
export function bindPostNextHint(): string {
	return nextHint("post with --body-file <the bound file> — the file must not change in between");
}

/** commit → the review-surface follow-ups and the session close-out. */
export function commitNextHint(): string {
	return nextHint("push when ready (git push is owner-checked); draft writes the PR body from the landed commits; checkout (action clean) clears this session's scratch once the work ships");
}

/** draft → the bind that keys the post, then the post itself. */
export function draftNextHint(): string {
	return nextHint("bind (kind post, path <the draft file>) once the text is final, then gh pr create --body-file <the file> — ask-tier (a pr grant or the dialog covers it)");
}

/** review → the write/bind/post path that carries the returned text. */
export function reviewNextHint(): string {
	return nextHint("to post — write the text to a file, bind (kind post, path <file>), then gh … --body-file <file>; inline --body is refused");
}

/** checkout worktree → work under the returned path. */
export function worktreeNextHint(): string {
	return nextHint("work under the returned path — its own git dir takes its own stamp");
}

/** approve → the approved ops run without further dialogs. */
export function approveNextHint(): string {
	return nextHint("run the gated op — it proceeds without a dialog until this session quits");
}

// --- footer labels -------------------------------------------------------------------------

export function gateApprovedLabel(actions: string[]): string {
	return `approved: ${actions.join(", ")}`;
}

/** Dialog-safe command preview — one line, capped; never a wall of text over the TUI. */
export function previewCommand(cmd: string): string {
	const oneLine = cmd.replace(/\s+/g, " ").trim();
	return oneLine.length > 160 ? `${oneLine.slice(0, 157)}…` : oneLine;
}

// --- floor block reasons ---------------------------------------------------------------------

/** The shared claim-target refusal: an unexpanded path can name the wrong tree. */
export function unexpandedTargetReason(target: string): string {
	return `claim target '${target}' did not fully expand (unset variable or unsupported form) — name the path absolutely or run from inside the tree`;
}

export function ownerStampReason(): string {
	return "`.pi/OWNER.json` is the checkout stamp — tool-written only. Use checkout action 'status' to inspect it; the rows replace dead owners automatically.";
}

export function bindsFileReason(): string {
	return "`.pi/REVIEW_BINDS.json` is bind's record — tool-written only. Use bind (kind tree/post) to record; commit or a bound gh post to spend.";
}

export function postBindRefusal(file: string): string {
	return (
		`gh post refused — --body-file ${file} has no bind record. Compose the text with review, write it to a file, ` +
		"bind it (bind kind post, path <file>), then re-run with --body-file. Inline --body, heredocs, and pipes are refused outright."
	);
}

export function uncoveredReason(cmd: string, suggestion: string): string {
	return `not covered: ${cmd}. Ask-tier shapes need a standing allow, a session approval, or the interactive dialog — headless runs get none of the dialog.${suggestion}`;
}

export function destructiveUncoveredReason(shape: string, reason: string | undefined): string {
	return `destructive-tier (${shape}) with no UI and no session destructive grant covering it. ${reason ?? ""}`.trim();
}

export function dialogRefusedReason(cmd: string): string {
	return `refused in dialog: ${cmd}`;
}

/** The appendEntry failure — surfaced at the point of failure (approve error, result annotation), one line, capped. */
export function approvalRecordFailedReason(err: string): string {
	const one = err.replace(/\s+/g, " ");
	return `approval record failed: ${one.length > 120 ? `${one.slice(0, 119)}…` : one}`;
}

// --- dialog bodies ----------------------------------------------------------------------------

export function askDialogTitle(): string {
	return "pi-kit: approve this command?";
}

export function destructiveDialogBody(cmd: string): string {
	return ["pi-kit: this can destroy work — approve?", previewCommand(cmd), "It can discard work or rewrite history. Approve once, or until the session ends (every destructive shape), or refuse."].join("\n");
}

export function commitDialogTitle(): string {
	return "pi-kit: commit the staged diff?";
}

export const DIALOG_CHOICES_ONCE_REFUSE = ["Approve once", "Refuse"] as const;
export const DIALOG_CHOICES_SESSION = ["Approve once", "Approve for this session", "Refuse"] as const;
export const DIALOG_CHOICES_DESTRUCTIVE = ["Approve once", "Approve until the session ends", "Refuse"] as const;

/** The tool-result annotation naming what covered a gated op (the audit line for one-time approvals). */
export function allowedViaNote(source: string): string {
	return `\n[pi-kit: allowed via ${source}]`;
}

// --- tool result bodies ------------------------------------------------------------------------

export function notInGitTreeReason(from: string): string {
	return `not inside a git work tree (from ${from})`;
}

export function checkoutCleanBody(dir: string): string {
	return `deleted ${dir} (this session's scratch; siblings untouched)`;
}

export function checkoutWorktreeExists(path: string): string {
	return `worktree exists: ${path} (returned as-is)\n${worktreeNextHint()}`;
}

export function checkoutWorktreeCreated(path: string): string {
	return `worktree created (detached at HEAD): ${path}\nThe main checkout's claim is unchanged. A session working in that directory is a different git dir and takes its own stamp.\n${worktreeNextHint()}`;
}

export function piNotIgnoredReason(root: string, why: string): string {
	return `.pi/ is not gitignored in ${root} — ${why}. Add a '.pi/' line to .gitignore. pi-kit never edits ignore files.`;
}

export function unbornHeadReason(why: string, recall: string): string {
	return `the branch has no commits yet — ${why}. Land the first commit, then re-call ${recall}.`;
}

export function checkoutStatusBody(stamp: unknown, relation: string, sid: string, self: { pid: number; host: string }): string {
	return `claim stamp: ${JSON.stringify(stamp)}\nrelation: ${relation}; this session: ${sid}, this process: {pid ${self.pid}, host '${self.host}'}\nUse action 'claim' to apply the rows (replaces only a dead owner).`;
}

export function checkoutClaimBody(row: number, sid: string, root: string): string {
	return `claim holds (row ${row}): session ${sid} at ${root}`;
}

export function approveBody(actions: string[], source: string): string {
	return `recorded: ${actions.join(", ")} approved for this session ("${source}") — coverage until quit; refuse shapes stay barred.\n${approveNextHint()}`;
}

export function approveNotTuiReason(): string {
	return "approve records only in the owner's TUI session — lanes and headless runs never self-approve (their channel is standingAllows)";
}

export function bindBody(kind: "tree" | "post", hash: string, sid: string): string {
	return `bound ${kind} ${hash.slice(0, 12)} (session ${sid.slice(0, 8)}) — the commit/gh-post floors can spend it. Rows are hash-keyed; tree rows never count for the spender's own session.\n${kind === "tree" ? bindTreeNextHint() : bindPostNextHint()}`;
}

export function nothingStagedReason(): string {
	return "nothing staged — stage the diff with git add, then call commit (it commits the index, hooks on)";
}

/** commit's unbound refusal — one reason for every mode: the reviewer lane re-reviews until the tree converges. */
export function bindUnboundReason(): string {
	return (
		"refused: the staged tree is unbound — no fresh review of this exact diff is on record. " +
		"Dispatch ONE read-only reviewer lane with the review task in its brief and bind in its tools (the lane binds the tree it reviewed), then re-call commit; " +
		"re-review after any further edits until the staged tree matches the bound tree."
	);
}

export function commitUnapprovedHeadlessReason(): string {
	return "refused: no approval covers this commit (no standing allow for this repo, no session approval, no UI for a dialog). Ask the user, or add a standingAllows entry in pi-kit.json.";
}

export function commitDivergedBody(bound: string, landed: string): string {
	return (
		`commit landed, bind diverged — a hook mutated the index mid-commit (bound ${bound.slice(0, 12)}, landed ${landed.slice(0, 12)}). ` +
		"Re-review the landed diff and re-bind; amend is destructive-tier and needs the dialog. The bind row is NOT spent; no log-verified commit is recorded."
	);
}

export function commitBody(sha: string, approvalSource: string, bindSource: string, bindSpent: boolean, hookOutput: string, stat: string, message: string): string {
	return [
		`commit ${sha} (verified in the log)`,
		`approval: ${approvalSource}`,
		`bind: ${bindSource}${bindSpent ? " — row spent" : ""}`,
		`hooks: ${hookOutput === "" ? "(no output)" : hookOutput}`,
		`diff stat:\n${stat}`,
		`message:\n${message}`,
		commitNextHint(),
	].join("\n\n");
}

export function draftBody(file: string, compare: string, base: string, head: string, commits: string, body: string): string {
	return [
		`draft written: ${file} (overwrite is the update path after new commits land)`,
		`compare: ${compare}`,
		`base ${base} → head ${head}`,
		commits.trim() === "" ? "(no commits in range)" : `landed commits:\n${commits.trim()}`,
		`body:\n\n${body}`,
		draftNextHint(),
	].join("\n\n");
}

export function templateMissingReason(templatePath: string, missing: string[]): string {
	return `the repo's PR template (${templatePath}) pins headings the body lacks: ${missing.join(" | ")}. Fill the template — it is the envelope; re-run with the completed body.`;
}

export function unparseableRemoteReason(url: string, base: string, head: string, file: string): string {
	return `push remote '${url}' is not a parseable GitHub remote — no compare URL can be derived. Manual path: open ${url}/compare/${base}...${head} in a browser (the draft file is written at ${file}; only the URL is missing).`;
}

export function draftKeptNote(file: string): string {
	return `(the draft file is written at ${file} — open the PR by hand from it)`;
}
