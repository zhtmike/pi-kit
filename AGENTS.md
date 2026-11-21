# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`pi-kit` is a personal [pi](https://pi.dev) extensions package (pi ≥ 1.4.0) —
hard-boundary tools for the owner's machines: a checkout claim (one live
session per git work tree), a git/gh approval floor, and review-surface
scaffolds. It is git-installed (`pi install git:github.com/zhtmike/pi-kit`),
never published to npm. Read [docs/api.md](docs/api.md) first — it is the
user-facing contract; tool schemas are the model-facing half of the same
contract. When code and docs disagree, that is a bug in one of them; fix the
disagreement, not just the code.

Surface discipline: the settled tools are the whole surface — `checkout`,
`git_commit`, `review_bind`, `pr_draft`, `review_text`; no slash commands, no
new option, state, or action without a payer against docs/api.md. Tool
descriptions stay lean (purpose, workflow skeleton, semantics the parameter
names don't carry, warnings code cannot enforce) — schema text rides every
request, so a description that grows past that core is a defect. The full
reference never enters context.

## Layout

- `extensions/checkout-claim.ts` — listed FIRST in the manifest: its claim block short-circuits before any ask dialog
- `extensions/git-api.ts` — `git_commit`, `review_bind`, the git/gh bash floor, session approvals
- `extensions/review-text.ts` — `pr_draft`, `review_text`
- `src/classify.ts` — the tier table (pure)
- `src/claim.ts` / `src/claimrun.ts` / `src/stamp.ts` — claim rows, runner, stamp/lock IO
- `src/approvals.ts` — session-approval matcher (pure)
- `src/envelopes.ts` — review-surface shapes + remote-URL parsing (pure)
- `src/identity.ts` — agent/model identity, trailers, markers, disclosures (pure)
- `src/binds.ts` — `.pi/REVIEW_BINDS.json` under the lock discipline
- `src/config.ts` — pi-convention nested config (defaults → agent dir → project)
- `src/githelp.ts` — git shells over `pi.exec` (passed in; host-free module)
- `src/status.ts` — the one footer status line, parts merged across extensions
- `src/util.ts` — pure helpers (slugify)
- `extensions/shared.ts` — host-adjacent helpers shared by the three extensions (stringEnum, ok, the init fence); not in the manifest
- `tests/*.test.ts` — plain `node` scripts, no framework; `src/**` imports no host package so tests run bare

## Working rules

- Fail loudly, never silently fall back: a refusal names the exact fix — the API tool, the config key, the escape action. Wrong input names itself and the valid choices.
- Fail closed at gate and init: a config error registers the blocking handler first, then aborts (`ctx.shutdown()` in TUI/RPC; `process.exit(1)` in print/JSON) — a factory throw would silently drop the extension and leave the process ungated.
- Extension order in the manifest is the short-circuit order; cross-package order is pi's (loose extensions load first — assumed absent on the owner's machines).
- The bash floors are token-grade, not a shell AST: unknown shapes ask, never allow; the redirection/script tunnel is named in docs/api.md, not "fixed" with a parser.
- Standing assumptions recorded, not enforced: no git aliases on the owner's machines (if one appears, the dialog shows `git config --get alias.<word>`'s expansion); a human-run `git clean -fdx`/`git stash -u` destroys `.pi/worktrees/*` (nested worktrees are invisible to it).
- Config is pi's overlay convention at both layers (`~/.pi/agent/pi-kit.json`, `.pi/pi-kit.json`); unknown keys and destructive/refuse standing shapes throw at load.
- Tabs for indentation; WHY-comments only, two lines max; no PR/issue citations in comments.
- Every behavior change ships with a unit test in the same change; run `npm test` and `npx tsc --noEmit` before declaring done.

## Testing

`npm test` (five plain-node suites on the pure cores) and the typecheck gates
in CI (floor 1.4.0, canary latest). UI/event wiring is proven by live runs —
the proving scenarios live in the repo's design history; when you exercise
one, record what ran in the PR description.
