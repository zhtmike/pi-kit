# pi-kit API reference

Personal hard-boundary tools for the [pi](https://pi.dev) coding agent. Three
extensions, five tools, two floors. Git-installed:

```
pi install git:github.com/zhtmike/pi-kit
```

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
	"standingAllows": [                   // per-repo pre-approvals, ask-tier shapes only
		{ "repo": "zhtmike/skills", "shapes": ["git_commit", "git push"] },
		{ "repo": "*", "shapes": ["gh api"] }
	]
}
```

Standing shapes: `git_commit`, `git push`, `gh pr create`, `gh pr edit`,
`gh comment`, `gh api`. Destructive and refuse shapes are rejected at load.
The `git push` owner check (`ownerLogins`) still applies under any allow.

## The checkout claim (extension 1)

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
| `worktree` | the blocked-session escape: returns an existing-or-new detached worktree at `<root>/.pi/worktrees/<sid>`; the main checkout's claim is unchanged |
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

- `edit`/`write` on **tracked** paths outside `.pi/**` (target resolved through symlinks — an edit under a symlinked install is gated against the source repo's tree), plus `.pi/OWNER.json` (names `checkout`) and `.pi/REVIEW_BINDS.json` (names `review_bind`). Every other `.pi/**` path passes; untracked writes, non-git trees, `user_bash`, and redirections are not seen (the named tunnel — a shell redirect onto `OWNER.json` rides it).
- bash shapes that are ask-tier or destructive, plus `git add`: create-or-block the claim **before** any ask dialog (the manifest order pins this).
- A dispatched lane with `edit` granted is gated the same way.

## Git/gh operations (extension 2)

### The tier table

| shape | tier |
|---|---|
| `git status/diff/log/show/ls-files/rev-parse/describe/blame/grep`, `git reflog` (no expire/delete), `git fetch`, `git add`; `gh pr view/diff/list`, `gh issue view/diff/list`, `gh run view/list/download`, `gh repo view/list/download`, `gh label view/list`, `gh release view/list/download`, `gh workflow view/list/download`, `gh search …`; `gh api` GET | **allow** — `git add` still meets the claim floor |
| `git push` (no force form, resolved owner ∈ `ownerLogins`); `gh pr create`; `gh pr edit --title/--body-file`; gh comment/reply/label edits; other `gh api` (implicit-POST reads incl. graphql queries) | **ask** — dialog offers once / for-this-session / refuse; session approvals and `standingAllows` may cover it |
| `git rebase`, `reset --hard`, `clean`, `commit --amend`, `commit --no-verify`/`-n`, `restore`/`checkout -- <path>`/`checkout .`, `stash drop/clear`, force/delete push forms (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `+refspec`, `:branch`, `--delete`), `branch -D` | **destructive** — dialog offers once / refuse only; never covered |
| bash `git commit` in any form; `git push` to a non-`ownerLogins` (or unparseable — SSH alias, non-GitHub) remote; `gh pr review --approve/--request-changes`; `gh pr merge/close/reopen/ready`; issue close/reopen/delete; PR→draft; `gh api` non-GET that merges/closes/submits a review verdict; graphql `mutation` | **refuse** — no dialog, no coverage; the reason names `git_commit` where it exists |

Closing rules: anything that changes PR/issue state or posts a review verdict
is refuse. A gh post carrying prose is ask **only** with `--body-file` of a
[bound](#tool-review_bind) file; inline `--body`, heredocs, and pipes
(`--body-file -`) are refuse naming `--body-file`; `--title` is metadata (no
bind). Any `-f`/`-F` makes `gh api` a POST regardless of `-X`. Compound
commands evaluate per segment, most-restrictive-wins. Wrappers (`sudo`,
`env`, `bash -c`, `xargs`, …) classify the inner command; an unclassifiable
git/gh inside asks. `-C`/`--git-dir`/`-c`/`--work-tree` make the tier at
least ask; the claim target is `--git-dir`, else `-C`, else the cwd after a
leading `cd`. Bare push resolves
`branch.<name>.pushRemote` → `remote.pushDefault` → `branch.<name>.remote` →
`origin`; a URL argument is parsed itself. `pkill -f`/`pgrep -f` whose
pattern matches the calling shell's own command string blocks with the
remedy: kill by PID from `nvidia-smi --query-compute-apps=pid` /
`pgrep <exact-name>` output, after verifying the PID is not your own shell.

Headless (`--mode json`/`print`, lanes): covered ask-tier shapes proceed (the
result names the approval); uncovered ones and every destructive shape block
— approval coverage, not interactivity, is what headless execution needs.

### Session approvals

The TUI typing channel — `ctx.mode === "tui"` **and** input source
`interactive` **and** no child markers (`PI_MINIMAL_DISPATCH_CHILD`,
`NIGHTWATCH_*`) — records grants that survive compaction (session entries),
replay in file order, and end at quit (a fork starts empty; a resume keeps
the resumed session's set). Recognition is spelling-robust, not
phrase-frozen: a directive gated verb ("push", "please commit", "feel free
to open a PR") grants; an approval signal (approved / OK'd / confirmed /
green-light / "go ahead" / "ship it" / LGTM) makes verbs named in the same
message count. Guards: negated verbs and noun-governed verbs ("the previous
commit") never count; hedges ("maybe", "should we", "later") do not grant.
Coverable actions: `commit`, `push` (owner-checked), `pr create`, `pr edit`.
A named commit or push covers every later matching op until quit — new
files, public signatures, new dependencies, >50 lines included; the
fresh-review bind still runs per diff. Parse misses are visible on the
footer and the next ask quotes them — never a silent grant. Dialog
"for-this-session" clicks use the same record. Nothing else records: lanes,
night-watch children, `rpc`/`extension` sources, print/json modes.

### Tool `review_bind`

Records that a fresh review ran — the record `git_commit` (kind `tree`) and
gh posts (kind `post`) spend. Params: `kind` (`tree`/`post`), `path` (post
only). The row carries the **caller's** session id; the committer's own sid
never counts. Refuses at thinking `off`/`minimal`/`low` — a low-thinking binder
reviews nothing. The payer: a reviewer lane dispatched by `commit-gate` with
the review task in its brief and `review_bind` in its `tools` (the dispatch
default `read,grep,find,ls` does not include it — the unbound refusal says
so). Rows are hash-keyed; stale unspent rows accumulate harmlessly.

- kind `tree`: `git write-tree` of the index, re-verified by `git_commit` immediately before it commits.
- kind `post`: sha256 of the file at `path` — the `--body-file` of the coming gh post.

### Tool `git_commit`

Commits the staged diff: hooks on (never `--no-verify`), identity trailers
injected (`AI-assistance: <agent> (<model>)` and
`Co-authored-by: <agent> <noreply@<provider-domain>>`, domain derived from
the model's baseUrl — unverifiable segments drop), caller trailers ride
along. It does **not** run the fresh review — `commit-gate` still does, before
this tool is called; its reviewer lane uses the fast read-only model at high
thinking (the judgment model at maximum thinking only for design-grade
artifacts, unsettleable reads, or blocking findings). Gates, in order: the checkout claim (like `git add`); a
review bind for the staged tree (TUI fallback: the user confirms they
reviewed it because dispatch was impossible — a session approval never pays
the bind); then an approval (standing → session → dialog). On success it
verifies the landing commit in the log and spends the bind row. If a hook
mutated the index mid-commit, the commit lands but the result states the
divergence — the row stays unspent, re-review and re-bind.

## Review surfaces (extension 3)

No-gh-write environments are first-class: both tools' results are the
deliverable, paste-ready, no posting, no network. The TUI result row expands
to the full text; headless gets it as the whole response.

### Tool `pr_draft`

Writes/overwrites `pr_<branch-slug>.md` in the project root. Inputs:
`body` (the model composes it — what/why, root cause, tests+results),
`assistance` (what the agent did, what the human reviewed and stands behind —
appended as the `## AI assistance` section when the body carries none; a
body with no section and no param refuses), optional `base`/`head` (defaults:
remote HEAD branch / current branch). Where `.github/PULL_REQUEST_TEMPLATE*`
exists it is the envelope — the body must carry the template's headings or
the call refuses naming them. Returns the path, the full body, a locally
derived compare URL (`https://github.com/<owner>/<repo>/compare/<base>...<head>`),
and the landed base..head commits for body-sync. An unparseable remote is a
loud error naming the manual path. Overwrite is the update path after new
commits land.

### Tool `review_text`

Returns the text in the tool result; the marker is appended by the tool.

- kind `comment`: `file:line: <one imperative ask>` plus at most one fact.
- kind `reply`: opens `Addressed in \`<commit>\`:` (commit required) or `Skipped, with reasoning:` (reason required); fields `answers` (what it replies to, quoted or restated), `verification`. Marker: `AI-assisted reply — <agent> (<model>)`.
- kind `summary`: the caller's text closed with `AI assistance (<agent>, <model>) was used for this review.`

Verdict vocabulary is fixed: `addressed` / `skipped`. The tool refuses text
it cannot mark or attribute (unverifiable agent → error; unverifiable model
→ parenthetical drops); a marked quote never gains a second marker.

## Non-goals

No judgment gating, no MCP, no network at runtime, no cross-harness
portability, no publish. The floor is a forgetting backstop, not a sandbox.
