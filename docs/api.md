# pi-kit API reference

Personal hard-boundary tools for the [pi](https://pi.dev) coding agent. One
extension entry (`src/index.ts`), six single-word tools, two floors.
Git-installed:

```
pi install git:github.com/zhtmike/pi-kit
```

Descriptions are minimal by contract — purpose, workflow skeleton,
non-inferable semantics, unenforceable warnings; the mechanics below are
enforced by runtime errors and chained `[next: …]` result hints, not schema
prose.

## The gate-action vocabulary

One table keys every gated surface — `approve`'s params, the session-approval
record, the footer display, and `standingAllows` shapes:

| action | covers | classifier shape | standing-allowable |
|---|---|---|---|
| `commit` | the `commit` tool's own gate | — (bash `git commit` is refuse-tier) | yes |
| `push` | `git push` (owner-checked under any allow) | `git push` | yes |
| `pr` | PR compose surfaces, create and edit — and `post` kind `pr` | `gh pr create` · `gh pr edit` | yes |
| `comment` | prose on issues/PRs — `pr`/`issue comment`, `pr review --comment`, `issue create/edit` — and `post` kinds `review`/`comment`/`reply` | `gh comment` | yes |
| `tag` | `git tag` write forms | `git tag` | yes |
| `release` | `gh release create/upload` (the git-tag twin) | `gh release` | yes |
| `destructive` | every shape past ask — destructive and refuse rows, non-owner pushes (the coarse all-gates grant) | — (per-shape never) | no — session-grantable only |

## Configuration

pi's overlay convention — defaults, then `~/.pi/agent/pi-kit.json`
(`PI_CODING_AGENT_DIR`), then `<project>/.pi/pi-kit.json`; later layers
overwrite keys whole (arrays replace). Any layer may be partial; unknown keys
and invalid values throw naming the file and the valid choices. A config
error fences the session: every gated operation blocks naming the error, and
the process aborts (TUI shows the block and shuts down; print/JSON exit 1).

```jsonc
{
	"agentName": "pi",                    // identity in trailers, markers, disclosures
	"ownerLogins": ["zhtmike"],           // logins whose remotes `git push` may resolve to (empty = every push refused)
	"standingAllows": [                   // per-repo pre-approvals, ask-tier actions only
		{ "repo": "zhtmike/skills", "shapes": ["commit", "push"] },
		{ "repo": "*", "shapes": ["comment"] }
	]
}
```

Standing shapes: the ask-tier rows of the table above — `commit`, `push`,
`pr`, `comment`, `tag`, `release`. Destructive and refuse shapes are
rejected at load.
The `git push` owner check (`ownerLogins`) still applies under any standing
allow; a session `destructive` grant overrides it (the all-gates override).

## The checkout claim

One live session per git work tree. The stamp is `.pi/OWNER.json` =
`{sid, pid, host, token}` at the work-tree root; `token` is the process start
token (Linux `/proc/<pid>/stat` field 22 — uptime ticks, immune to
wall-clock steps; elsewhere `ps -o lstart=`). Stamp and bind files are
created only where `.pi/` is gitignored — pi-kit never edits ignore files.

### Tool `checkout`

| action | behavior |
|---|---|
| `status` | stamp state + owner liveness |
| `claim` | take the checkout; replaces only a dead same-host owner |
| `worktree` | the blocked-session escape: returns an existing-or-new detached worktree at `<root>/.pi/worktrees/<sid>`; an existing **clean** worktree whose HEAD differs from the checkout's is re-rooted at the checkout's HEAD (sequential milestone lanes get the latest verified commit as base); a dirty one is returned as-is (its edits are unlanded work); the main checkout's claim is unchanged |
| `clean` | delete exactly `.pi/work/s/<own sid>/` — siblings unreachable, empty sid refuses |

There is no `release` action — the stamp is not a chore the model performs; a
quit/exit unlinks it best-effort (reload/new/resume/fork keep it).

### The claim rows

| row | condition | outcome |
|---|---|---|
| 0 | stamp absent | create (`O_EXCL`) and proceed — unless blind probe/empty sid (write nothing, block) or `.pi/` unignored (block) |
| 1 | our sid | proceed |
| 2 | our pid+token, older sid (session replacement after `/new`…) | re-stamp with the current sid, proceed |
| 3 | other host | block, retain |
| 4 | same host, pid alive, token matches | block, name the owner, name the worktree escape |
| 5 | same host, pid dead or token differs (reused pid) | replace under `.pi/OWNER.lock` |
| 6 | malformed/incomplete stamp | block, retain |
| 7 | liveness unknown | block, retain — unknown is never dead |

### What the floor sees

- `edit`/`write` on **tracked** paths outside `.pi/**` (target resolved through symlinks — an edit under a symlinked install is gated against the source repo's tree), plus `.pi/OWNER.json` (names `checkout`) and `.pi/REVIEW_BINDS.json` (names `bind`). Every other `.pi/**` path passes; untracked writes, non-git trees, `user_bash`, and redirections are not seen (the named tunnel — a shell redirect onto `OWNER.json` rides it).
- bash shapes that are ask-tier or destructive: create-or-block the claim **before** any ask dialog (the claim floor registers first). Allow-tier git shapes — `git add` included — do not stop at the claim floor; a local write into a foreign-held tree is standing-assumption residue (the tracked-edit floor and the tools carry the invariant for the paths that matter). A refuse row covered by a session `destructive` grant also skips the claim stop — the all-gates grant carries the tree's fate with it.
- A dispatched lane with `edit` granted is gated the same way.

## Git/gh operations

### The tier table

| shape | tier |
|---|---|
| every other agent-typed git command — reads, routine local writes (branch/switch/checkout/stash/merge/pull/`restore --staged`/soft-mixed reset/config/remote/rm/add/worktree/submodule/…), unlisted subcommands, and relocated (`-C`/`--git-dir`/`GIT_DIR`) or `-c`-configured forms; and every other gh command — all reads/downloads/searches, `pr checkout`, unlisted verbs, and `gh api` GET, implicit POST, or explicit `-X` with no state path and no prose fields | **allow** — no dialog, no claim-floor stop |
| `git push` (no force form, resolved owner ∈ `ownerLogins`); `git tag` write forms (create/`-f`/`-d`; list forms flow); gh post surfaces — `gh pr create`, `gh pr edit`, `gh pr/issue comment`, `gh pr review --comment`, `gh issue create/edit` (inline prose is refuse below); `gh release create/upload` (the git-tag twin) | **ask** — dialog offers once / for-this-session / refuse; session approvals and `standingAllows` may cover it |
| `git reset --hard`, `clean`, `checkout -- <path>`/`checkout .`/`./`/`:/`/force/`-B` (bare `checkout <file>` without `--` is documented residue), `restore` (worktree forms; `--staged`-only flows), `stash drop/clear`, `branch -D`, `rebase`, `commit --amend`, `commit --no-verify`/`-n`, force/delete push forms (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `+refspec`, `:branch`, `--delete`), `git reflog expire/delete` | **destructive** — dialog offers once / until-session-ends / refuse; a session `destructive` grant covers every destructive shape (never standing-allowable) |
| bash `git commit` in any plain form (`-m`, `-F`, `-t`; the `--amend`/`--no-verify`/`-n` forms are destructive-tier); `git push` to a non-`ownerLogins` (or unparseable — SSH alias, non-GitHub) remote; gh state verbs — `pr merge/close/reopen/ready`, `issue close/reopen/delete`, PR→draft, `release delete/archive`, and the state verbs on any gh noun; `gh pr review --approve/--request-changes`; `gh api` (GET or POST) that merges/closes/submits a review verdict, graphql `mutation`, or prose via `-f body=`; inline gh prose (`--body`, heredoc, `--body-file -`) | **refuse** — no dialog; the reason names `commit` where it exists — covered only by a session `destructive` grant (the all-gates override) |

Closing rules: anything that changes PR/issue state or posts a review verdict
is refuse. A gh post carrying prose is ask **only** with `--body-file` of a
[bound](#tool-bind) file (the `post` tool is the bind-free route — the text
rides the call); inline `--body`, heredocs, and pipes
(`--body-file -`) are refuse naming `--body-file`; `--title` is metadata (no
bind). Any `-f`/`-F` makes `gh api` a POST regardless of `-X`. Compound
commands evaluate per segment, most-restrictive-wins; a heredoc body is
stdin data — swallowed whole unless the receiver is a shell (`bash`/`sh`/
`zsh`/`dash`/`ksh`), whose body keeps classifying segment by segment —
an unclosed quote inside such a body (an apostrophe in a comment, say)
swallows the rest of the script into one lump (residue, below). Wrappers (`sudo`,
`env`, `bash -c`, `xargs`, …) classify the inner command; a git or gh
first token that is not a plausible subcommand asks, and an unknown global
flag asks outright — on git, known valueless globals (`-p`/`--paginate`
and friends) shift bare; no flag's value or subcommand masquerades past the
gate. `-C`/`--git-dir`/`GIT_DIR` record
the claim target (`--git-dir`/`GIT_DIR` first, else `-C`, else the cwd after
a leading `cd`) and never change a tier; `-c` and other global flags only
consume their value. Claim targets and post `--body-file` paths expand
`~`/`$VAR`/`${VAR}` as the shell would; unexpandable names (same-line
assignments, `${VAR:-def}`) block loudly at resolution. Bare push resolves
`branch.<name>.pushRemote` → `remote.pushDefault` → `branch.<name>.remote` →
`origin`; a URL argument is parsed itself. `pkill -f`/`pgrep -f` whose
pattern matches the calling shell's own command string blocks with the
remedy: kill by PID from `nvidia-smi --query-compute-apps=pid` /
`pgrep <exact-name>` output, after verifying the PID is not your own shell.

Headless (`--mode json`/`print`, lanes): covered ask-tier shapes proceed (the
result names the approval); uncovered ones and session-uncovered destructive shapes block
— approval coverage, not interactivity, is what headless execution needs.

### Session approvals

Recognition is the **session agent's judgment, not a hard-coded grammar**.
When the user's TUI message grants gated actions — a directive ("push it"),
an approval of named verbs, or a blanket approval of the session/gate ("I
have approved the gate", "I have human approved the session") — the agent
calls `approve` with the actions it judged granted and a short quote of
the user's words. Hedges, negations, and questions are not approvals; the agent
decides, and the record is the audit trail. A blanket approval — "all
gates", YOLO, everything — is the whole vocabulary, `destructive`
included: the result names the actions left out, and until `destructive`
is granted a destructive shape still stops at a dialog mid-run and a
refuse shape blocks.

**Tool `approve`** — params: `actions` (the vocabulary table's actions:
`commit`, `push`, `pr`, `comment`, `tag`, `release`, `destructive`),
`source` (the quoted approving words). Records only in the
owner's TUI session (mode `tui`, no child markers — lanes and headless runs
never self-approve; their channel is `standingAllows`; child detection keys
on `PI_MINIMAL_DISPATCH_CHILD=1`, the marker pi-minimal-dispatch sets on its
lanes — renaming it is a cross-package contract). Grants last until
quit, survive compaction (session entries), replay in file order, and show
on the footer as action names (`approved: commit, push`; the quoted source
lives in the session entry — the audit trail, not the footer). Dialog
"for-this-session" clicks use
the same record. A named `commit` or `push` covers every later matching op
until quit — new files, public signatures, new dependencies, >50 lines
included. `push` stays
owner-checked except under the coarse grant; refuse-tier shapes are covered only by a session `destructive` grant (the all-gates override — standing allows never reach it), and a covered gh post waives its `--body-file` bind the same way a pre-approved commit waives its bind.

### Tool `bind`

Records that a fresh review ran — the record `commit` (kind `tree`) and gh
posts (kind `post`) spend. Params: `kind` (`tree`/`post`), `path` (post
only), `targetDir` (optional: operate on the repo containing this path —
default: the session's cwd; cross-repo sessions bind the tree they reviewed).
The row carries the **caller's** session id; a tree row never counts for
the spender's own session (a post row spends for its composer too). Refuses at thinking `off`/`minimal`/`low` — a low-thinking
binder reviews nothing. The payer: a reviewer lane dispatched by
commit-gate with the review task in its brief and `bind` in its `tools`
(the dispatch default `read,grep,find,ls` does not include it — the
unbound refusal says so). Rows are hash-keyed; stale unspent rows
accumulate harmlessly.

- kind `tree`: `git write-tree` of the index, re-verified by `commit` immediately before it commits.
- kind `post`: sha256 of the file at `path` — the `--body-file` of the coming gh post. The `post` tool records no row — its call's own bytes are the record.

### Tool `commit`

Commits the staged diff: hooks on (never `--no-verify`), identity trailers
injected (`AI-assistance: <agent> (<model>)` and
`Co-authored-by: <agent> <noreply@pi.dev>` — the harness project's own
domain, fixed rather than derived from the model's baseUrl; commits before
0.4.1 carry the provider-domain address, so GitHub splits the co-author
avatar row across the change), caller trailers ride along — the identity
trailers are injected automatically (the `trailers` param says so; pass
only the rest). The tool owns the disclosure: a subject, body, or trailer
line carrying its own — the footer sentence (`AI assistance … was used
…`, whatever its purpose), an
`AI-assistance:` trailer, the agent's own `Co-authored-by` — refuses
naming the line and the trailers the tool injects, so a landed message
never carries the footnote twice; a human co-author's trailer passes.
It does **not** run the fresh review — `commit-gate` still does,
before this tool is called; its reviewer lane uses the fast read-only
model at high thinking (the judgment model at maximum thinking only for
design-grade artifacts, unsettleable reads, or blocking findings). Params:
`subject`, `body` (optional), `trailers` (optional), `targetDir` (optional:
operate on the repo containing this path — default: the session's cwd; the
claim is ensured in that repo, so a cross-repo session lands where it
staged). Gates,
in order: the checkout claim; a review bind for the staged tree (a
pre-approved commit — standing allow or session grant — waives the missing
bind; otherwise the refusal names the reviewer-lane loop: dispatch a
read-only reviewer lane with bind in its tools, re-call commit, re-review
after further edits until the staged tree matches the bound tree); then an
approval (standing → session → dialog). A dispatched lane is refused
outright — lanes never land code; the parent session applies the patch and
lands it through this gate. On success it verifies the landing commit
in the log and spends the bind row. If a hook mutated the index
mid-commit, the commit lands but the result states the divergence — the
row stays unspent, re-review and re-bind.

## Review surfaces

`draft` composes and checks the PR body; `post` composes and delivers the
review surfaces (a review with inline threads, a comment, a reply, a PR).
Present the composed texts in the conversation — post takes the same
structured inputs, and its composition is deterministic: what was approved
is what posts.

### Tool `draft`

Writes/overwrites `pr_<branch-slug>.md` in the project root. Inputs:
`body` (the model composes it — what/why, root cause, tests+results),
`assistance` (what the agent did, what the human reviewed and stands
behind — appended as the `## AI assistance` section when the body carries
none; a body with no section and no param refuses, and passing `assistance`
while the body already carries the section refuses too — put the text
inside it or drop the param), optional `base`/`head`
(defaults: remote HEAD branch / current branch). Where a PR template exists
it is the envelope — a single file (`.github/PULL_REQUEST_TEMPLATE.md`,
`PULL_REQUEST_TEMPLATE.md`, `docs/PULL_REQUEST_TEMPLATE.md`, either case) or
a template directory (`.github/PULL_REQUEST_TEMPLATE/` — `default.md`, else
the first `.md`) — the body must carry the template's headings (any level,
line-exact) or the call refuses naming them. A template that carries its own
AI/assistance section makes filling that section the disclosure: nothing is
appended. Returns the path, the full body, a locally derived compare URL
(`https://github.com/<owner>/<repo>/compare/<base>...<head>`), and the
landed base..head commits for body-sync. An unparseable remote is a loud
error naming the manual path. Overwrite is the update path after new commits
land.

### Tool `post`

One call composes and posts to GitHub through the user's authenticated `gh`
(pi-kit opens no connection of its own). The review event is pinned to
`COMMENT` — post never submits an approve or request-changes verdict and
never merges/closes/reopens/marks ready: those stay refuse-tier, user-only.
The standardized summary verdicts are prose inside a comment review, never
GitHub states — accepting or rejecting a PR remains a human action.

- kind `review`: `number`, `verdict` (`clean` — "no findings" / `minor` —
  "no blocking findings; everything below is cleanup-grade" / `blocking` —
  "blocking findings below" — register-free severity glosses, fixed),
  `text` (the body below the verdict line: findings, coverage, accounting —
  no disclosure of its own; the footer is the tool's), `comments[]` of
  `{file, line, severity, label?, cites?, ask, fact?}` — inline threads.
  `severity` is `blocking` or `minor` (never `clean` — clean means no
  threads) and opens the thread as `[severity]`; `label` is a short finding
  id the summary text refers to (`C1`) — one token, unique across the
  review — rendered bold before the severity; `cites` is the finding's own
  location when it is outside the diff, rendered between the severity and
  the ask. The posted summary is the verdict line, the text, and the
  disclosure footer (`AI assistance (<agent>, <model>) was used for this
  review.`); each posted thread body is `**label** [severity] cites — ask —
  fact`, each optional part dropped when absent (the API anchors; a cite is
  the one location that rides the body — GitHub threads diffed lines
  only, so a finding elsewhere anchors on the nearest diffed line and
  passes `cites`; before the approval dialog, only when there are
  threads, every anchor is checked against the PR's diff — the files
  endpoint's patches: a path outside refuses naming `cites`, a thread in
  a file with no diffed line — deleted, or removals only — refuses the
  same way, and a line outside the
  file's hunks moves to the nearest diffed line, the requested
  `file:line` becoming its `cites` when it carried none — the dialog and
  the result name each move, `a.md:553 (was :3)`. A file without a
  rendered patch — binary, oversized, a pure rename — is not
  line-checked; GitHub's 422 then surfaces with its error body and the
  remedy). Verdict and threads agree: `clean` takes no comments, a
  `blocking` thread refuses under `minor` (`blocking` with no blocking
  thread stands — a design-level finding lives in the summary). Inline
  threads carry no marker — the review's footer discloses.
- kind `comment`: `number` (PR or issue), `body` — one standalone comment
  (free prose, no disclosure of its own); the
  `<sub>AI-assisted reply — <agent> (<model>)</sub>` marker is appended (a
  standalone comment carries the tool's disclosure).
- kind `reply`: `number`, `inReplyTo` (a review-comment id), `verdict`
  (`addressed`/`skipped`), `quote`, `answers`, `commit` (required for
  addressed), `reason` (required for skipped), `verification` — composes
  the reply: the quote as a `>` blockquote (survives collapsed threads),
  `Addressed in \`<commit>\`:` / `Skipped, with reasoning:`, answers and
  verification as bullets, the marker. Lands in the thread it answers —
  never as a top-level comment.
- kind `pr`: create (`title`, `body`, optional `base`/`head` — `owner:branch`
  for fork PRs; defaults: the remote HEAD branch / the current branch) or
  edit (`number` plus `title` and/or `body` — the body-sync flow). The draft
  envelope applies at the posting boundary: a body missing the template's
  pinned headings or the AI-assistance section refuses — draft is the
  composer.

Verdict vocabularies are fixed and kind-scoped: `clean`/`minor`/`blocking`
serve kind review, `addressed`/`skipped` serve kind reply — a token in the
wrong kind is an error naming both sets. The tool refuses text it cannot
attribute (unverifiable agent → error; unverifiable model → parenthetical
drops). The tool owns every disclosure: a review text or comment body
carrying a disclosure line — the footer sentence (`AI assistance … was used
…`, whatever its purpose), a reply
marker, an assistance heading; a finding that merely mentions assistance is
not one — refuses naming the line, so the tool's is the only one. A reply
still ends in its own marker exactly once: a quoted marker is the quoted
reply's own and never suppresses it, and a reply already ending in its own
marker never gains a second.

`repo` (`owner/name`) names a target that is not the session's own —
fork→upstream posts pass it; an unresolvable target refuses demanding it.
The result reports what was **submitted** (from the request — response
echoes are not verification) and the returned URL.

Gating: kind `pr` maps to the `pr` action, every other kind to `comment` —
the existing ladder (standing allow keyed on the target repo, session grant,
dialog; headless refuses naming standingAllows). The tier is a deliberate
widening, not a side effect: the raw `gh api` reviews endpoint stays refuse
(it can carry verdict states); post's payload structurally cannot, so it
rides the ask ladder. post takes no checkout claim (it writes nothing
local) and records no bind row — the gate works in any repo, including
trees where `.pi/` is not ignored. Refuses at thinking off/minimal/low (a
low-thinking poster publishes nothing unverified) and in dispatched lanes
(the parent presents, takes the approval, and posts).

## Result hints

Tool results chain the workflow with one bracketed `[next: …]` line,
appended only when the named step is real for the caller — `bind` names its
spender, `commit` names the push/draft follow-ups, `draft` names the `post`
step, `checkout
worktree` names working under the returned path; `approve`'s body names the
ops still stopping the run, its hint the blanket-approval follow-up when
`destructive` is not among the grants. The convention (not the wording) is the contract;
the texts live in `src/format.ts` under test.

## Status bar

One footer line: `approved: <actions>` while session grants are in force,
empty otherwise — grants render as action names and survive reload/resume
(rebuilt from session entries; fork and quit clear them). Everything else
lives where it happens: claim blocks and refusals in the blocked tool
result, approval-record failures at the point of failure (the `approve`
tool errors; a dialog whose for-this-session click failed to persist says
so in the result annotation), covered ops in the `[pi-kit: allowed via …]`
result annotation and landed commits in the `commit` result's own body —
the audit line lives in the transcript, never the footer.

## Non-goals

No judgment gating, no MCP, no network beyond the user's gh CLI (the `post`
tool rides its authentication), no cross-harness portability, no publish.
The floor is a forgetting backstop, not a sandbox.
Standing-assumption residue, documented rather than gated: git aliases
(`git config --get alias.<word>` shows any that appear), `GIT_CONFIG_*`
injections, exotic plumbing writers (`filter-repo`, `update-ref`,
`replace`, `fast-import`, …), force-bundled local spellings past the footgun
set (`rm -f`, `branch -f`/`-M`, `switch -C`, bare `checkout <file>` without
`--`) — `branch -f`/`-M` and `switch -C` are force-spellings of recoverable
operations (the reflog retains the prior ref), unlike their gated siblings
(`branch -D` drops unmerged commits, `reset --hard` discards worktree work);
bare `checkout <file>` rides allow as parsing residue — ambiguous with branch
checkout — not recoverability — and gh run/workflow triggers
(`run cancel/rerun`, `workflow run`) ride the
default-allow; a heredoc fed to a NON-shell interpreter (`python3 - <<EOF`)
is stdin data, swallowed whole — interpreter-side shell-string smuggling is
unseen; inside a shell-fed heredoc body, an unclosed quote (apostrophes in
comments) swallows the remainder past the gate — the no-git-aliases assumption on the owner's machines is
recorded in AGENTS.md.
