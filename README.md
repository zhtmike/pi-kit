# pi-kit

Personal hard-boundary tools for the [pi](https://pi.dev) coding agent — three
extensions, six tools, two floors. Git-installed, never published; no runtime
dependencies beyond the pi host.

```bash
pi install git:github.com/zhtmike/pi-kit
```

## The tools

| tool | what it does |
|---|---|
| `checkout` | one live session per git work tree — status / claim / worktree escape / `clean` (this session's `.pi/work/s/<sid>`) |
| `approve` | record a session approval the agent judged from the user's TUI message (quoted source = the audit trail) |
| `git_commit` | commit the staged diff: hooks on, identity trailers, the review bind spent, the approval named |
| `review_bind` | record that a fresh review ran (the staged tree, or a to-be-posted text file) — what `git_commit` and gh posts spend |
| `pr_draft` | write/overwrite `pr_<branch-slug>.md`: template coverage, AI-assistance section, local compare URL, landed commits |
| `review_text` | paste-ready review texts in-result: one summary + one comment per thread + one reply per answered thread |

## The floors

- **Claim floor** — tracked `edit`/`write` outside `.pi/**` (resolved through
  symlinks) and ask/destructive bash shapes meet the claim before anything
  else; a live foreign claim blocks, `checkout worktree` is the escape.
- **Git/gh tier floor** — both gate by blacklist: agent-typed git/gh
  defaults to allow; the high-risk rows only (`git commit` bash forms → the
  tool; `git push`, `git tag` writes, gh post surfaces and release
  publishing → ask; the destructive footguns) gate. Ask-tier needs
  coverage (standing allow, session approval, dialog), destructive dialogs
  offering once / until-session-ends / refuse (a session destructive grant
  covers the whole class), refuse shapes block naming the fix. `pkill -f` /
  `pgrep -f` self-match blocks with the kill-by-PID remedy.

## Configuration

pi's overlay convention — defaults, then `~/.pi/agent/pi-kit.json`, then
`<project>/.pi/pi-kit.json`; later layers overwrite keys whole:

```json
{
	"agentName": "pi",
	"ownerLogins": ["zhtmike"],
	"standingAllows": [{ "repo": "zhtmike/skills", "shapes": ["git_commit", "git push"] }]
}
```

A bad config fences every gated op and aborts the session at startup.

Full reference: [docs/api.md](docs/api.md) · repo guide:
[AGENTS.md](AGENTS.md) · contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
