# Changelog

## 0.7.2 — 2026-11-24

`approve` says what a blanket approval must include.

- **A pre-approved long run stopped at a dialog** — "I have pre-approved
  all gates" was recorded as `commit, push, pr, comment`; a `git stash
  drop` in the recovery then raised the destructive dialog. The
  `destructive` grant is the YOLO switch and recognition is the agent's
  judgment, not a grammar — so the judgment now reads it: `approve`'s
  description says a blanket approval is every action, `destructive`
  included, and its result names the actions left out and what still
  stops the run — a dialog for destructive shapes, a block for refuse
  ones — with a hint to add `destructive` when the approval covered every
  gate.

## 0.7.1 — 2026-11-24

`commit` refuses a message that carries its own AI-assistance disclosure.

- **A landed commit carried the footnote twice** — the body ended with a
  hand-written `AI assistance (pi coding agent, GLM-5.4) was used for this
  change.` above the trailers the tool injects (`AI-assistance:` and
  `Co-authored-by:`) (verl-omni#953, `164a7ea`). `post` owned its
  disclosure since 0.6.0; `commit` now does too: a subject, body, or
  trailer line carrying its own — the footer sentence (`AI assistance … was
  used …`, whatever its purpose), an
  `AI-assistance:` trailer, the agent's own `Co-authored-by` — refuses
  naming the line and the injected trailers; a human co-author's trailer
  passes. The sentence check now matches any purpose ("was used for this
  change" read as a finding before — only "for this review" matched).

## 0.7.0 — 2026-11-24

Thread anchors settle onto the diff; GitHub's error body reaches the result.

- **A thread on an undiffed line reached GitHub and 422'd** — the pre-check
  compared only anchor *paths* against `…/pulls/<n>/files` and dropped the
  `patch` in the same response, so `docs/examples/config.md:3` passed (the
  file was diffed, its hunk at 553-561) and the review died after the
  approval (verl-omni#947). A line outside the file's hunks now settles
  onto the nearest diffed line, the requested `file:line` becoming the
  thread's `cites` when it carried none; the dialog and the result name
  each move (`config.md:553 (was :3)`). A thread in a file with no diffed
  line to anchor — deleted, or removals only — refuses.
- **The 422 said nothing** — the failure line took `stderr || stdout`, but
  `gh api` prints GitHub's JSON error body to stdout and only
  `gh: Unprocessable Entity (HTTP 422)` to stderr, so the field GitHub
  named was discarded and diagnosing took an extra diff read. The failure
  now carries GitHub's body (`Validation Failed — comments[data][line]:
  invalid`) and, for a threaded review's 4xx, the remedy; a file without a
  rendered patch (binary, oversized, a pure rename) stays uncheckable.

## 0.6.0 — 2026-11-23

The review thread contract: the tool owns the disclosure; threads carry
severity, a label, and a cite.

- **A review posted two AI-assistance footnotes** — the review text ended
  with a hand-written footer (`AI assistance (pi, zai/glm-5.4; research
  lanes …) was used for this review.`), `post`'s exact-match check missed
  the variant and appended its own (verl-omni#933). The tool now owns every
  disclosure: a review text or comment body carrying a disclosure line —
  the footer sentence in any wording, a reply marker, an assistance
  heading — refuses naming the line; the exact-match tolerances are gone.
  A finding that merely mentions assistance passes.
- **Inline threads carried no severity** — a reader could not separate
  blocking asks from cleanup without the summary. Every thread passes
  `severity` (`blocking` | `minor`) and opens with it; the verdict and the
  threads agree (`clean` takes no comments; a `blocking` thread refuses
  under `minor`).
- **Finding lettering did not resolve** — the summary's "Fix direction
  (C1–C7)" had no counterpart on the threads, so the lettering was
  rewritten away. `label` is a short finding id the summary refers to — one
  token, unique per review — rendered bold: `**C1** [blocking] ask — fact`.
- **A finding outside the diff was mis-anchored by hand** — GitHub threads
  diffed files only; a finding on `docs/api/reward.rst:104` was anchored
  on a diffed export line with the cite hand-placed in the ask and the
  deviation narrated (verl-omni#925). `cites` names the finding's own
  location and renders between the severity and the ask; before the
  approval dialog, only when there are threads, every anchor path is
  checked against the PR's diff (one `gh api …/files` read) — an anchor
  outside refuses naming `cites` instead of GitHub's 422 after the
  approval.

## 0.5.0 — 2026-11-23

The posting audit: one tool composes and posts every review surface; verdicts standardized.

- **Posting a review took two user asks and the coarse destructive grant** — the only route that could carry inline threads (`gh api POST …/reviews`) was refuse-tier, the suggested `gh pr review --comment --body-file` route cannot carry threads at all, and in repos where `.pi/` is not gitignored every ask-tier route died at the claim floor and `bind(post)` refused — the floors funneled a routine comment post into the all-gates override (observed end-to-end on verl-omni#882). The new `post` tool composes and delivers in one call — a review (the COMMENT event pinned in the payload; it can never approve or reject a PR), a comment, a reply, a PR create/edit — gated on the existing `comment`/`pr` actions: one approval covers it, in any repo, with no bind file and no claim.
- **`review` and `post` duplicated one surface** — review composed texts post recomposed from mirrored params. `review` is deleted; `post` owns composition (verdict line, reply shape, markers, footers). Presentation stays in the conversation; post takes the same structured inputs and composes deterministically — what was approved is what posts.
- **Verdicts are standardized** — kind review picks `clean` | `minor` | `blocking` (register-free glosses; merge directives stay in the free text), kind reply keeps `addressed` | `skipped`; a token in the wrong kind is an error naming both sets.
- The tier widening is deliberate and named in docs/api.md: the raw reviews endpoint stays refuse (it can carry verdict states); post's payload structurally cannot, so it rides the ask ladder.

## 0.4.2 — 2026-11-22

Sequential milestone lanes get the latest verified commit as base.

- **The defect** — `checkout worktree` returned an existing worktree
  as-is, so a second implementation lane on the same session built on a
  stale HEAD: milestone 2's brief described work against code milestone
  1's commit had already changed. A **clean** worktree whose HEAD differs
  from the checkout's is now re-rooted at the checkout's HEAD (the
  session's own scratch tree — a clean reset loses nothing); a dirty one
  is still returned as-is (its edits are unlanded work), and the exists
  body now says which case you got.

## 0.4.1 — 2026-11-22

The ease-of-use audit: the co-author address fixed to the project's
own domain, the commit surface tightened for lanes and duplicate trailers.

- **The co-author address attributed the wrong project** — the domain under
  `Co-authored-by` derived from the model's baseUrl, so commits landed
  `noreply@z.ai` — the model provider's domain, not the harness project's.
  The address is fixed at `noreply@pi.dev` and never degrades to a bare
  name; commits before 0.4.1 carry the provider-domain address, so GitHub
  splits the co-author avatar row across the change.
- **The trailers param invited double attribution** — an agent following
generic conventions could pass its own `AI-assistance:`/`Co-authored-by:`
and double-inject the disclosure. The `trailers` param description now
states the identity trailers are injected automatically — pass only the
rest (deliberately no hard-coded dedup — name-matching heuristics drift
with conventions; the description is the contract).
- **commit could land from a lane** — a dispatched lane could commit directly,
  bypassing the parent-applies-the-patch flow. `commit` now refuses in any
  lane (`PI_MINIMAL_DISPATCH_CHILD`): lanes never land code; the parent
  session applies the patch and lands it through this gate.
- **draft silently dropped a conflicting `assistance` param** — when the
  body already carried the AI-assistance section, the param vanished
  without a word. The conflict now refuses: put the text inside the body's
  own section or drop the param.
- **Smaller** — `bind`'s description states the tree-row rule's operative
  point (your own session's tree row never pays for your own commit —
  dispatch the reviewer lane); the not-in-a-git-tree refusal names the
  remedy (`targetDir` inside the tree, or run from inside it); the claim
  floor's block no longer wraps the inner reason (`claim check failed
  first — …` is gone); the config-fence reason reads `pi-kit config is
  invalid — …`; the blind-probe and empty-sid refusals (claim runner;
  `clean`/`worktree`/`bind`) name the environment defect — report it, do
  not retry.

## 0.4.0 — 2026-11-22

The all-gates override, plus the four-repo cross-audit fixes.

- **The all-gates override** — the owner approves gates wholesale ("I have
  approved all gates") and expects that to mean every operation; the
  `destructive` grant left the refuse rows barred, so "all gates" silently
  wasn't. A session `destructive` grant now covers every shape past ask —
  destructive rows, the refuse rows (bash `git commit`, gh state verbs,
  review verdicts, non-owner pushes) — and waives a gh post's `--body-file`
  bind the way a pre-approved commit already waived its tree bind. Standing
  allows still top out at ask (config-time pre-approval never reaches
  refuse), uncovered refuse reasons name the override
  (`approve(actions: ["destructive"])`), and `selfmatch` stays outside —
  it catches the agent killing its own shell, which no grant means.
- **Draft's hint led into a wall** — `draftNextHint` pointed at
  `gh pr create --body-file` with no bind step, so the hinted command hit
  `postBindRefusal` on first attempt, every time. The hint names the bind
  step; `review` results gain the same post-path hint (write → bind →
  `--body-file`).
- **Bind's sid prose was half wrong** — "the spender's own sid never
  counts" is true of tree rows only; the post path has always accepted the
  composer's row. Description, result body, docs, and the `binds.ts`
  comment now scope it to kind `tree`.
- **Smaller** — anchorless `review` comment (the issue-comment surface:
  `file`/`line` optional but paired, `ask` required); `answers` marked
  required; `commit`'s `[next:]` gains the `checkout clean` close-out;
  description trims across checkout/approve/commit/review (~150 tokens per
  request); the footgun set's rationale documented (`-M`/`-C`/`-f` are
  recoverable force-spellings, `-D` drops unmerged commits);
  `PI_MINIMAL_DISPATCH_CHILD` documented as a cross-package contract;
  AGENTS.md states the non-goals.

## 0.3.3 — 2026-11-22

Tests: the binds ledger gets its own characterization suite.

- **The gap** — `src/binds.ts` was exercised only through `claim.test.ts`'s
  record→find→spend trio; its edge semantics (lock refusal, corrupt-file
  propagation, kind+hash keying, sid exclusion, MAX_ROWS trim, silent row
  drops) had no guard. `tests/binds.test.ts` pins current behavior
  export-by-export (24 tests, temp-rooted, the suite's local-`t` pattern)
  and joins the `npm test` chain.
- **Pinned semantics worth naming** — readBinds normalizes `version` on
  read (a file's `99` never surfaces); `spendBind` never consults `sid`
  (the self-bind guard lives solely in `findBind`); a corrupt binds file
  always throws from record/spend and is never rewritten; an empty
  `recordBinds` still creates the file when absent; read errors beyond
  ENOENT are swallowed — a non-file at the binds path reads as empty
  binds (stamp.ts's readers rethrow; pinned as-is).

## 0.3.2 — 2026-11-22

Cross-repo sessions: `bind` and `commit` take `targetDir`.

- **The defect** — a session rooted in one repo that staged work in
  another (skills fix from a harness-setup session) hit walls in sequence:
  the bash `git commit` refusal points at the `commit` tool, but `commit`
  and `bind` resolved only the session cwd — "nothing staged" in the
  session's repo, no path to the staged one. The claim floor and the
  git/gh bash floor were already per-target (`targetDir` from classified
  commands); the gated tools were the gap.
- **The fix** — both tools take optional `targetDir` (default: the
  session's cwd), expanded as the shell would with a loud block on
  unexpanded residue, exactly the bash floor's vocabulary. `commit`
  ensures the claim in that repo, so the one-editor guarantee rides the
  retarget; `bind` records the row in that repo's `.pi/REVIEW_BINDS.json`.
  Proven end-to-end headless: a bind called with a scratch repo's
  `targetDir` from an unrelated cwd landed the row in the scratch repo's
  `.pi/`, the session repo's binds file untouched.
- `draft` stays cwd-bound (PR scaffolding for the session's own repo);
  `checkout` stays the session-tree tool — cross-repo edits already claim
  per-target through the edit floor.

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
