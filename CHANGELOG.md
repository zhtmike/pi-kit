# Changelog

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
