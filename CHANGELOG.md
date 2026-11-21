# Changelog

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
