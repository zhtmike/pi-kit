# Changelog

## 0.3.1 — 2026-11-21

The TUI audit release: every surface states one thing, in the place it
happens.

- **Status bar = session grants only** — the seven other footer labels are
  gone (pending/ours/blocked checkout, standing/session/committed echoes,
  waiting-on-person): speculative, steady-state, or per-op echoes
  duplicating what the on-screen dialog, the blocked tool result, or the
  `[pi-kit: allowed via …]` annotation already carries. The footer renders
  `approved: <actions>` while grants stand, empty otherwise.
- **Missing-bind confirm dialog removed** — an unaudited click-through
  duplicating the approve path that already waives the bind when commit is
  pre-approved. Unbound commits refuse in TUI exactly as headless, with one
  reason naming the reviewer-lane loop (review → bind → re-call; re-review
  after edits until the staged tree matches the bound tree).
- **Record failures at the point of failure** — `approve` errors loudly when
  the session record is unwritable; a dialog whose for-this-session click
  fails to persist annotates the result (approve once + the capped reason)
  instead of writing a footer part.

## 0.3.0 — 2026-11-21

The pi-minimal-dispatch alignment release: one vocabulary, one entry, one
presentation module, lean schemas.

- **Tool renames** — `git_commit`→`commit`, `review_bind`→`bind`,
  `pr_draft`→`draft`, `review_text`→`review` (`checkout`, `approve`
  unchanged): six single-word names on one surface. No aliases — the owner's
  machines are the whole install base; the consumers (harness-setup guide,
  skills repo, local config, installed copy) follow in the same pass.
- **One gate-action vocabulary** — `commit, push, pr, comment, tag, release,
  destructive` now keys approve's params, the session-approval record, the
  footer display, AND `standingAllows` shapes (config files renaming:
  `git_commit`→`commit`, `git push`→`push`, `gh pr create`/`gh pr edit`→`pr`,
  `gh comment`→`comment`, `git tag`→`tag`, `gh release`→`release`).
  Semantic widening, named: `pr` merges `pr_create`+`pr_edit` — one trust
  domain, the PR compose surface, mirroring how `comment` already spans the
  issue/PR prose surfaces; a `pr` grant now covers edit where a create-only
  approval didn't. The shape→action map is one tested function
  (`actionOfShape`) instead of two hand-maintained tables.
- **Layout decoupling** — the three `extensions/` files collapse into one
  glue entry `src/index.ts` (the manifest lists it alone; the claim floor
  registers first, preserving the short-circuit). Untested pure logic moved
  out of extension files: `commitMessage`→`identity.ts` (also fixed: the
  trailer block now blank-separates from the body, so git parses
  `Co-authored-by` as trailers), PR-template discovery→`envelopes.ts`,
  draft's git lookups (head/base/remote/log-range)→`githelp.ts`.
- **New `src/format.ts`** — every composite human-facing text in one pure
  module: tool result bodies, dialog bodies, floor block reasons, footer
  labels, and `[next: …]` hints chaining the workflow (bind names its
  spender, commit names push/draft, draft names the post, worktree names
  working under the returned path). Schema descriptions shrank to the lean
  contract — reviewer-lane policy, bind flows, and dialog orders moved out
  of descriptions (which bill on every request) into runtime refusals and
  hints; docs/api.md stays the full reference and pins the chaining
  convention, not the hint wording.

90 unit tests across nine suites (new: format, identity); npm test and tsc
clean.

## 0.2.4 — 2026-11-21

The footer segment drops its `pi-kit:` prefix — `[checkout: … · approved:
commit, push]`. The part labels carry the domain, and the shape matches
pi-minimal-dispatch's `[lanes: …]`: bracketed segments that read apart on
pi's single shared status line. A new status suite pins the bracketed merge.

## 0.2.3 — 2026-11-21

Pre-approvals go YOLO, per the owner's direction. Every approval dialog
offers "Approve until the session ends" — the destructive dialog included,
where the session choice records one coarse `destructive` grant covering
every destructive shape (still never standing-allowable; refuse-tier
unchanged). A pre-approved commit (standing allow or session grant) waives
the missing-bind confirm outright — the bind row still spends when present,
and the uncovered case keeps the plain-language human confirm.

## 0.2.2 — 2026-11-21

Every human-facing prompt speaks plainly now. The missing-bind fallback
says what is on record (no independent review of this exact final diff —
usually because the diff changed after the reviewer ran), what confirming
means (you personally read the final diff just now), and what Cancel does
(the agent dispatches a reviewer lane, then retries). The ask dialog asks
"approve this command?" instead of naming a tier; the destructive dialog
leads with "this can destroy work" and says plainly that session approvals
never cover it. A stale "like `git add`" claim-floor comparison died in the
code comment and the docs gate list.

## 0.2.1 — 2026-11-21

Session-scoped approval now covers every ask shape: the `approve` vocabulary
gains `comment`, `tag`, and `release`, so `gh comment`, `git tag` write forms,
and `gh release create/upload` dialogs offer "Approve for this session" (and
`standingAllows` gains the `git tag` and `gh release` shape keys). The dead
`humanChannel` helper is gone (the approve tool enforces its channel inline).

## 0.2.0 — 2026-11-21

Both bash-floor classifiers inverted to blacklists (pi-spirit): every
agent-typed git/gh command defaults to allow; only high-risk operations
gate.

- git gated rows: `git commit` bash forms (refuse — the `git_commit` tool
  route), `git push` (ask, owner-checked — unchanged), `git tag` write forms
  (new — ask; list forms flow), and the destructive footgun set
  (`reset --hard`, `clean`, `checkout --`/`.`/`./`/`:/`/force/`-B`, worktree
  `restore`, `stash drop/clear`, `branch -D`, `rebase`,
  amend/`--no-verify`/`-n`, force/delete push, `reflog expire/delete`;
  `restore --staged` alone now flows).
- gh gated rows: the post surfaces (`pr create/edit`, `pr`/`issue comment`,
  `pr review --comment`, `issue create/edit`) keep the bound-`--body-file`
  discipline (ask; inline prose refuses), state verbs and review verdicts
  keep refusing, and `release create/upload` joins at ask (the git-tag
  twin). Everything else — unlisted verbs, `pr checkout`, `gh api` GET and
  non-mutation implicit POST — flows.
- An unknown git/gh global flag asks outright (on git, known valueless
  globals like `-p`/`--paginate` shift bare): no flag's value or subcommand masquerades
  past the gate (`git -p push origin main` and `git --namespace x push`
  both ask). Claim targets and post `--body-file` paths expand
  `~`/`$VAR`/`${VAR}` as the shell would (fixes the `cd ~/repo && git …` and
  `cd $D && git …` false blocks); unexpandable residue blocks loudly.
- Routine local writes no longer stop at the claim floor (`git add`
  included) — the tracked-edit floor and the tools carry the invariant;
  `standingAllows` drops the now-allow-tier `gh api` shape.
- Footer: one-time dialog approvals annotate the tool result instead of
  persisting; session approvals render as action names; the approve record
  now persists the quoted source in its session entry (the audit trail);
  the pi-kit segment self-labels `[pi-kit: …]` on pi's shared footer line.
- Liveness probe closure deduped (claimrun uses stamp's lockProbe); the
  dead input listener is gone.

Heredoc bodies are stdin data — swallowed whole unless the receiver is a
shell (bash/sh/zsh/dash/ksh), whose body keeps classifying line by line
(an identifier-shaped tag is required, so `$((1<<2)) && git push` still
gates); escaped quotes inside double quotes no longer split a quoted
string; gate dialogs preview the command as one capped line (160 chars),
never a screen-covering echo.

78 unit tests across six suites (classify rewritten to the blacklists, new
util suite for expandShellPath); npm test and tsc clean.

## 0.1.0 — 2026-11-21

First cut: the personal hard-boundary package for the pi coding agent — three
extensions, six tools, two floors, one pure core each; no runtime
dependencies beyond the pi host.

- **checkout-claim** — one live session per git work tree: a liveness stamp
  `.pi/OWNER.json` `{sid,pid,host,token}` (uptime-based start token), rows
  0–7 (create / proceed / re-stamp / retain / replace-under-lock), the
  `checkout` tool (status/claim/worktree/clean), and the tracked-edit floor
  that resolves targets through symlinks and consults the tier classifier
  for bash shapes.
- **git-api** — the git/gh approval boundary (session approvals are the agent's judgment recorded through `approve` — no phrase matcher; `git ls-tree` joined the allow row): the tier table (allow / ask /
  destructive / refuse / self-match, per-segment most-restrictive-wins),
  `git_commit` (hooks on, identity trailers, review-bind spend, log
  verification), `review_bind` (tree/post rows, thinking floor), session
  approvals from the TUI typing channel, and per-repo `standingAllows` under
  pi's config overlay convention.
- **review-text** — `pr_draft` (template coverage, AI-assistance section,
  local compare URL) and `review_text` (comment/reply/summary with the
  marker appended); no posting, no network — the no-gh-write environment is
  a first-class mode.

74 unit tests across five plain-node suites; typecheck floors pi 1.4.0 and a
canary against latest. Install: `pi install git:github.com/zhtmike/pi-kit`.
