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
disagreement, not just the code. Non-goals (docs/api.md): no judgment
gating, no MCP, no network beyond the user's gh CLI, no cross-harness
portability, no publish.

Surface discipline: the settled tools are the whole surface — `checkout`,
`approve`, `commit`, `bind`, `draft`, `post`; no slash commands, no
new option, state, or action without a payer against docs/api.md. Tool
descriptions stay lean (purpose, workflow skeleton, semantics the parameter
names don't carry, warnings code cannot enforce) — schema text rides every
request, so a description that grows past that core is a defect; workflow
mechanics ride runtime refusals and the `[next: …]` result hints instead.
The full reference never enters context.

## Layout

- `src/index.ts` — the ONE manifest entry and all glue: config fence, the claim floor (registered first — its block short-circuits before any ask dialog), the git/gh bash floor, the six tools, dialogs, quit hygiene, the footer sink
- `src/classify.ts` — the tier table (pure)
- `src/claim.ts` / `src/claimrun.ts` / `src/stamp.ts` — claim rows, runner, stamp/lock IO
- `src/approvals.ts` — the gate-action vocabulary, shape→action map, session-approval record/replay core (pure; recognition is the agent's judgment via `approve`)
- `src/envelopes.ts` — review-surface shapes (verdict vocabularies, markers, footers), PR-template discovery, remote-URL parsing (pure)
- `src/post.ts` — the post tool's pure core: kind validation, text composition, and the REST payloads, the review event pinned to COMMENT (pure)
- `src/identity.ts` — agent/model identity, trailers, commit messages, markers, disclosures (pure)
- `src/format.ts` — every composite human-facing text: result bodies, dialog bodies, `[next: …]` hints, footer labels (pure; decision-attached reasons stay with their decisions in claim/classify)
- `src/binds.ts` — `.pi/REVIEW_BINDS.json` under the lock discipline
- `src/config.ts` — pi-convention nested config (defaults → agent dir → project)
- `src/githelp.ts` — git shells over `pi.exec` (passed in; host-free module) plus draft's lookups (head/base/remote/log-range)
- `src/status.ts` — the one footer status line, parts merged
- `src/util.ts` — pure helpers (slugify, shell-path expansion)
- `tests/*.test.ts` — plain `node` scripts, no framework; the pure modules under `src/**` import no host package (only `src/index.ts`, the glue entry, does) so the tests run bare

## Working rules

- Fail loudly, never silently fall back: a refusal names the exact fix — the API tool, the config key, the escape action. Wrong input names itself and the valid choices.
- Fail closed at gate and init: a config error registers the blocking handler first, then aborts (`ctx.shutdown()` in TUI/RPC; `process.exit(1)` in print/JSON) — a factory throw would silently drop the extension and leave the process ungated.
- Handler registration order inside `src/index.ts` is the short-circuit order — the claim floor registers before the git/gh floor; cross-package order is pi's (loose extensions load first — assumed absent on the owner's machines).
- The bash floors are token-grade, not a shell AST: git and gh both gate by blacklist — only the high-risk rows of docs/api.md gate, everything else allows (an unknown global flag asks). The redirection/script, alias-injection, and exotic-writer tunnels are named in docs/api.md, not "fixed" with a parser.
- Standing assumptions recorded, not enforced: no git aliases on the owner's machines (if one appears, `git config --get alias.<word>` shows the expansion before trusting the aliased command); a human-run `git clean -fdx`/`git stash -u` destroys `.pi/worktrees/*` (nested worktrees are invisible to it).
- Config is pi's overlay convention at both layers (`~/.pi/agent/pi-kit.json`, `.pi/pi-kit.json`); unknown keys and destructive/refuse standing shapes throw at load.
- Tabs for indentation; WHY-comments only, two lines max; no PR/issue citations in comments.
- Every behavior change ships with a unit test in the same change; run `npm test` and `npx tsc --noEmit` before declaring done.

## Testing

`npm test` (eleven plain-node suites on the pure cores) and the typecheck gates
in CI (floor 1.4.0, canary latest). UI/event wiring is proven by live runs —
the proving scenarios live in the repo's design history; when you exercise
one, record what ran in the PR description.
