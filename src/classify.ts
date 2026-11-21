/**
 * Pure command classification for the git/gh floors — the tier table.
 * Token/glob grade, not a shell AST: unknown shapes ask (never allow), a
 * redirection or a script write is not seen, and compound commands evaluate
 * per segment, most-restrictive-wins. No state, no fs, no processes: the
 * floors resolve owners, claim targets, and binds at use time.
 */

export type Tier = "allow" | "ask" | "destructive" | "refuse" | "selfmatch";

const TIER_RANK: Record<Tier, number> = { allow: 0, ask: 1, destructive: 2, selfmatch: 3, refuse: 4 };

export interface Classification {
	tier: Tier;
	/** Canonical shape id ("git push", "gh pr create", "git add", "pkill -f", "other", …) — the standingAllows key where one exists. */
	shape: string;
	/** Block reason for refuse/selfmatch — names the API tool or the escape. */
	reason?: string;
	/** Claim target: `--git-dir`, else `-C`, else the directory after a leading `cd`. */
	targetDir?: string;
	/** Path after `--body-file` on a gh post — the bind the floor checks. */
	bodyFile?: string;
	/** The gh post carries no body at all (title/metadata only) — ask without a bind. */
	noBody?: boolean;
	/** Args after `git push` of the segment that carried it (remote/refspec resolution). */
	pushArgs?: string[];
}

// --- shell-word tokenization (quotes only; no expansion — token-grade by design) ---------

export function shellWords(s: string): string[] {
	const words: string[] = [];
	let cur = "";
	let quote: '"' | "'" | null = null;
	let has = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote !== null) {
			if (c === quote) quote = null;
			else cur += c;
		} else if (c === '"' || c === "'") {
			quote = c;
			has = true;
		} else if (/\s/.test(c)) {
			if (cur !== "" || has) words.push(cur);
			cur = "";
			has = false;
		} else cur += c;
	}
	if (cur !== "" || has) words.push(cur);
	return words;
}

/** Split a command line on top-level `&&` `||` `;` `|` and newlines, quote-aware. */
function splitSegments(cmd: string): string[] {
	const segs: string[] = [];
	let cur = "";
	let quote: '"' | "'" | null = null;
	const flush = () => {
		if (cur.trim() !== "") segs.push(cur.trim());
		cur = "";
	};
	for (let i = 0; i < cmd.length; i++) {
		const c = cmd[i];
		if (quote !== null) {
			cur += c;
			if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			cur += c;
			continue;
		}
		if (c === "&" && cmd[i + 1] === "&") {
			flush();
			i++;
		} else if (c === "|" && cmd[i + 1] === "|") {
			flush();
			i++;
		} else if (c === "|" || c === ";") {
			flush();
		} else cur += c;
	}
	flush();
	return segs;
}

// --- git ---------------------------------------------------------------------------------

const GIT_ALLOW = new Set(["status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "describe", "blame", "grep", "fetch", "add"]);
const GIT_DESTRUCTIVE = new Set(["rebase", "clean"]);

/** A `+` refspec or an empty-source deletion refspec (`:branch`). */
function isForceRefspec(words: string[]): boolean {
	return words.some((w) => w === "+" || w.startsWith("+") || /^:[^^]/.test(w) || /:[^/]+\.\.\./.test(w));
}

function classifyGit(words: string[]): Classification {
	const rest = [...words];
	let targetDir: string | undefined;
	let gitDir: string | undefined;
	let ctxFlag = false;
	// global flags before the subcommand: --no-pager/-P stripped; -C/--git-dir claim-target;
	// -c/--work-tree (and any -C) make the tier ask — they relocate or reconfigure the run.
	while (rest.length > 0 && rest[0].startsWith("-")) {
		const w = rest[0];
		if (w === "--no-pager" || w === "-P") rest.shift();
		else if (w === "-C") {
			targetDir = rest[1];
			ctxFlag = true;
			rest.splice(0, 2);
		} else if (w.startsWith("-C")) {
			targetDir = w.slice(2);
			ctxFlag = true;
			rest.shift();
		} else if (w === "--git-dir") {
			gitDir = rest[1];
			ctxFlag = true;
			rest.splice(0, 2);
		} else if (w.startsWith("--git-dir=")) {
			gitDir = w.slice("--git-dir=".length);
			ctxFlag = true;
			rest.shift();
		} else if (w === "--work-tree") {
			ctxFlag = true;
			rest.splice(0, 2);
		} else if (w.startsWith("--work-tree=")) {
			ctxFlag = true;
			rest.shift();
		} else if (w === "-c") {
			ctxFlag = true;
			rest.splice(0, 2);
		} else if (w.startsWith("-c")) {
			ctxFlag = true;
			rest.shift();
		} else if (w === "--") break;
		else rest.shift(); // any other global flag: strip and continue
	}
	const target = gitDir ?? targetDir;
	const sub = rest[0];
	if (sub === undefined) return ask("git", "unknown git form", target);
	const args = rest.slice(1);

	if (sub === "commit") {
		if (args.includes("--amend") || args.includes("--no-verify") || args.includes("-n")) {
			return destructive(`git ${sub}`, target);
		}
		return refuse(`git ${sub}`, "git commit is refused in bash — use the git_commit tool (hooks on, identity trailers, review bind). --amend/--no-verify are destructive-tier and need the dialog.", target);
	}
	if (sub === "push") {
		const c0 = { tier: "ask", shape: "git push", targetDir: target, pushArgs: args } as Classification;
		const flags = args.filter((a) => a.startsWith("-"));
		const force = flags.some((f) => f === "-f" || f === "--force" || f === "--force-with-lease" || f === "--force-if-includes" || f.startsWith("--force")) || args.includes("--delete") || args.includes("-d") || isForceRefspec(args);
		if (force) {
			return destructive("git push", target, "force/delete push forms are destructive-tier — approve-once dialog only, never covered by any approval.");
		}
		return c0;
	}
	if (sub === "reset") {
		if (args.includes("--hard")) return destructive("git reset", target);
		return ask("git reset", "git reset (unlisted form)", target);
	}
	if (sub === "checkout" || sub === "restore") {
		// `checkout <branch>` switches branches (ask); `checkout -- <path>` / `checkout .` / `restore` discard work — destructive.
		if (sub === "restore" || args.includes("--") || args[0] === ".") return destructive(`git ${sub}`, target);
		return ask(`git ${sub}`, `git ${sub} (unlisted form)`, target);
	}
	if (sub === "stash") {
		if (args[0] === "drop" || args[0] === "clear") return destructive("git stash", target);
		return ask("git stash", "git stash (unlisted form)", target);
	}
	if (sub === "branch") {
		if (args.includes("-D")) return destructive("git branch", target);
		return ask("git branch", "git branch (unlisted form)", target);
	}
	if (sub === "reflog") {
		if (args.includes("expire") || args.includes("delete")) return destructive("git reflog", target);
		return allow("git reflog", target);
	}
	if (GIT_DESTRUCTIVE.has(sub)) return destructive(`git ${sub}`, target);
	if (GIT_ALLOW.has(sub)) {
		const shape = sub === "add" ? "git add" : `git ${sub}`;
		if (ctxFlag) return ask(shape, `${shape} with -C/--git-dir/-c/--work-tree`, target);
		return allow(shape, target);
	}
	return ask(`git ${sub}`, `git ${sub} (unlisted subcommand)`, target);
}

// --- gh ----------------------------------------------------------------------------------

const GH_ALLOW_SUBS = new Set(["view", "diff", "list"]);
const GH_STATE_WORDS = new Set(["merge", "close", "reopen", "delete", "ready", "archive", "lock", "unlock"]);

function ghBodyArgs(args: string[]): { inline?: boolean; bodyFile?: string; stdin?: boolean } {
	const out: { inline?: boolean; bodyFile?: string; stdin?: boolean } = {};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--body" || a === "-b") out.inline = true;
		else if (a.startsWith("--body=")) out.inline = true;
		else if (a === "--body-file" || a === "-F") {
			const v = args[i + 1];
			if (v === undefined || v === "-") out.stdin = true;
			else out.bodyFile = v;
			i++;
		} else if (a.startsWith("--body-file=")) {
			const v = a.slice("--body-file=".length);
			if (v === "") out.stdin = true;
			else if (v === "-") out.stdin = true;
			else out.bodyFile = v;
		}
	}
	return out;
}

function ghPostRefusal(what: string): string {
	return `${what} with inline --body (or stdin/heredoc/pipe) is refused — compose the text with review_text, write it to a file, bind it (review_bind kind post), then re-post with --body-file <file>.`;
}

function classifyGh(words: string[]): Classification {
	const rest = [...words];
	while (rest.length > 0 && rest[0].startsWith("-") && rest[0] !== "--") {
		const w = rest.shift() as string;
		// value-taking global flags: consume their argument so it is not mistaken for the subcommand
		if ((w === "-R" || w === "--repo") && rest.length > 0 && !rest[0].startsWith("-")) rest.shift();
	}
	if (rest[0] === "--") rest.shift();
	const sub = rest[0];
	if (sub === undefined) return ask("gh", "unknown gh form");

	if (sub === "api") {
		const args = rest.slice(1);
		let method = "GET";
		const fields = new Map<string, string>();
		const positional: string[] = [];
		for (let i = 0; i < args.length; i++) {
			const a = args[i];
			if (a === "-X" || a === "--method") {
				method = (args[i + 1] ?? "").toUpperCase();
				i++;
			} else if (a.startsWith("--method=")) method = a.slice("--method=".length).toUpperCase();
			else if (a === "-f" || a === "--field" || a === "-F" || a === "--raw-field") {
				const kv = args[i + 1] ?? "";
				const eq = kv.indexOf("=");
				if (eq >= 0) fields.set(kv.slice(0, eq), kv.slice(eq + 1));
				else fields.set(kv, "");
				i++;
			} else if (a.startsWith("--field=")) {
				const kv = a.slice("--field=".length);
				const eq = kv.indexOf("=");
				fields.set(eq >= 0 ? kv.slice(0, eq) : kv, eq >= 0 ? kv.slice(eq + 1) : "");
			} else if (a.startsWith("-")) {
				// value-taking gh api flags: consume their argument so it is not mistaken for the path
				if (i + 1 < args.length && !args[i + 1].startsWith("-")) i++;
			} else positional.push(a);
		}
		if (fields.size > 0) method = "POST"; // any -f/-F makes gh api a POST regardless of -X
		const path = positional[0] ?? "";
		if (method === "GET") return allow("gh api");
		const query = fields.get("query") ?? "";
		if (/\bmutation\b/.test(query)) {
			return refuse("gh api", "gh api graphql mutation — a mutation is a write; refuse-tier for agents. Ask the user to run it.");
		}
		if (/\/(merge|update_branch)(\/|$)/.test(path) || /\/(pulls|issues)\/\d+\/(close|merge)(\/|$)/.test(path)) {
			return refuse("gh api", `gh api POST ${path} merges/closes — PR/issue state changes are refuse-tier for agents; ask the user.`);
		}
		if (/\/reviews$/.test(path)) {
			return refuse("gh api", `gh api POST ${path} submits a review verdict — refuse-tier for agents; post comments via gh pr review --comment with a bound --body-file instead.`);
		}
		// Postable prose via -f fields (comment bodies) rides the same bind rule as --body.
		const prose = ["body", "body_text", "bodyMarkdown", "comment"].filter((k) => fields.has(k));
		if (prose.length > 0) {
			return refuse("gh api", `gh api POST carrying postable prose via -f ${prose[0]}= — refuse-tier. Compose the text with review_text, then post it via 'gh pr comment <n> --body-file <file>' bound through review_bind (kind post).`);
		}
		return ask("gh api");
	}

	if (sub === "pr" || sub === "issue") {
		const verb = rest[1];
		const args = rest.slice(2);
		if (verb === undefined) return ask(`gh ${sub}`, `gh ${sub} (no verb)`);
		if (GH_STATE_WORDS.has(verb)) {
			return refuse(`gh ${sub} ${verb}`, `gh ${sub} ${verb} changes PR/issue state — refuse-tier for agents; ask the user to do it.`);
		}
		if (verb === "review") {
			if (args.includes("--approve") || args.includes("--request-changes")) {
				return refuse("gh pr review", "gh pr review --approve/--request-changes posts a review verdict — refuse-tier for agents; post findings as comments (review_text comment + gh pr review --comment --body-file).");
			}
			if (args.includes("--comment")) {
				const b = ghBodyArgs(args);
				if (b.inline) return refuse("gh pr review", ghPostRefusal("gh pr review --comment"));
				if (b.stdin) return refuse("gh pr review", ghPostRefusal("gh pr review --comment"));
				if (b.bodyFile) return { tier: "ask", shape: "gh comment", bodyFile: b.bodyFile };
				return { tier: "ask", shape: "gh comment", noBody: true };
			}
			return ask(`gh pr review`, "gh pr review (unlisted form)");
		}
		if (verb === "comment") {
			const b = ghBodyArgs(args);
			if (b.inline) return refuse(`gh ${sub} comment`, ghPostRefusal(`gh ${sub} comment`));
			if (b.stdin) return refuse(`gh ${sub} comment`, ghPostRefusal(`gh ${sub} comment`));
			if (b.bodyFile) return { tier: "ask", shape: "gh comment", bodyFile: b.bodyFile };
			return { tier: "ask", shape: "gh comment", noBody: true };
		}
		if (verb === "create") {
			if (sub === "pr") {
				const b = ghBodyArgs(args);
				if (b.inline) return refuse("gh pr create", ghPostRefusal("gh pr create"));
				if (b.stdin) return refuse("gh pr create", ghPostRefusal("gh pr create"));
				if (b.bodyFile) return { tier: "ask", shape: "gh pr create", bodyFile: b.bodyFile };
				return { tier: "ask", shape: "gh pr create", noBody: true };
			}
			return ask("gh issue create", "gh issue create (unlisted)");
		}
		if (verb === "edit") {
			const b = ghBodyArgs(args);
			if (b.inline) return refuse(`gh ${sub} edit`, ghPostRefusal(`gh ${sub} edit`));
			if (b.stdin) return refuse(`gh ${sub} edit`, ghPostRefusal(`gh ${sub} edit`));
			if (b.bodyFile) return { tier: "ask", shape: sub === "pr" ? "gh pr edit" : "gh comment", bodyFile: b.bodyFile };
			return { tier: "ask", shape: sub === "pr" ? "gh pr edit" : "gh comment", noBody: true };
		}
		if (GH_ALLOW_SUBS.has(verb)) return allow(`gh ${sub} ${verb}`);
		return ask(`gh ${sub} ${verb}`, `gh ${sub} ${verb} (unlisted form)`);
	}

	if (sub === "search") return allow("gh search");
	if (sub === "run" || sub === "repo" || sub === "label" || sub === "release" || sub === "workflow") {
		const verb = rest[1];
		if (verb === "view" || verb === "list" || verb === "download") return allow(`gh ${sub} ${verb}`);
		if (sub === "label" || sub === "release" || sub === "workflow") return ask(`gh ${sub}`, `gh ${sub} (unlisted form)`);
		if (verb === undefined) return ask(`gh ${sub}`, `gh ${sub} (no verb)`);
		return ask(`gh ${sub} ${verb}`, `gh ${sub} ${verb} (unlisted form)`);
	}
	if (sub === "auth" || sub === "config" || sub === "extension" || sub === "completion") return ask(`gh ${sub}`, `gh ${sub} (unlisted form)`);
	return ask(`gh ${sub}`, `gh ${sub} (unlisted subcommand)`);
}

// --- pkill/pgrep self-match --------------------------------------------------------------

const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "nice", "xargs"]);

function selfMatchReason(pattern: string): string {
	return (
		`pkill/pgrep -f with pattern '${pattern}' matches this shell's own command line — it would kill or list the tool shell itself. ` +
		"Kill by PID instead: get PIDs from nvidia-smi --query-compute-apps=pid or pgrep <exact-process-name> output, " +
		"verify the PID is not your own shell, then kill <PID>."
	);
}

function classifyPkill(words: string[], rawSegment: string): Classification {
	const bin = words[0];
	const args = words.slice(1);
	const pattern = args.filter((a) => !a.startsWith("-")).pop();
	// flags may carry values (-x, --signal TERM …); the pattern is the last bare word.
	const hasF = args.some((a) => a === "-f" || a === "--full" || /^-[a-z]*f/.test(a));
	if (!hasF || pattern === undefined) return { tier: "allow", shape: `${bin} (no -f)` };
	if (rawSegment.includes(pattern)) return { tier: "selfmatch", shape: `${bin} -f`, reason: selfMatchReason(pattern) };
	return { tier: "allow", shape: `${bin} -f (no self-match)` };
}

// --- segment -----------------------------------------------------------------------------

const RELOCATING_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE)=/i;

export function classifySegment(segment: string): Classification {
	let words = shellWords(segment);
	// Relocating GIT_* assignments get the same at-least-ask tier as
	// --git-dir/--work-tree, wherever they sit (bare, or after `env`).
	let envTarget: string | undefined;
	let envFlag = false;
	const stripAssignments = (): void => {
		while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
			if (RELOCATING_ENV.test(words[0])) {
				envFlag = true;
				const v = words[0].slice(words[0].indexOf("=") + 1);
				if (/^GIT_DIR=/i.test(words[0])) envTarget = v;
			}
			words = words.slice(1);
		}
	};
	stripAssignments();
	// wrappers: strip until the real command; bash/sh -c "<script>" classifies the script itself
	while (words.length > 0 && WRAPPERS.has(words[0])) {
		const w = words[0];
		words = words.slice(1);
		if (w === "env") {
			stripAssignments();
			while (words.length > 0 && words[0].startsWith("-")) words = words.slice(1);
			stripAssignments();
		} else if (w === "xargs") {
			while (words.length > 0 && words[0].startsWith("-")) words = words.slice(1);
		} else {
			while (words.length > 0 && words[0].startsWith("-") && words[0] !== "--") words = words.slice(1);
		}
	}
	if (words.length === 0) return { tier: "allow", shape: "other" };
	if (words[0] === "bash" || words[0] === "sh" || words[0] === "zsh") {
		if (words[1] === "-c") return classifyCommand(words.slice(2).join(" "));
		return { tier: "allow", shape: "other" };
	}
	stripAssignments();
	if (words[0] === "git" && envFlag) {
		const c = classifyGit(words.slice(1));
		return { ...c, tier: c.tier === "allow" ? "ask" : c.tier, targetDir: envTarget ?? c.targetDir, reason: c.reason ?? "git with a relocating GIT_* environment assignment" };
	}
	if (words[0] === "git") return classifyGit(words.slice(1));
	if (words[0] === "gh") return classifyGh(words.slice(1));
	if (words[0] === "pkill" || words[0] === "pgrep") return classifyPkill(words, segment);
	return { tier: "allow", shape: "other" };
}

/** Classify a full bash command: leading `cd` fixes the claim target, segments combine most-restrictive-wins. */
export function classifyCommand(cmd: string): Classification {
	const segs = splitSegments(cmd);
	let target: string | undefined;
	const parts: Classification[] = [];
	for (const seg of segs) {
		const words = shellWords(seg);
		if (words[0] === "cd" && parts.length === 0 && words[1] !== undefined) {
			target = words[1];
			continue; // a leading cd only relocates the claim target
		}
		parts.push(classifySegment(seg));
	}
	if (parts.length === 0) return { tier: "allow", shape: "other", targetDir: target };
	let worst = parts[0];
	for (const p of parts) if (TIER_RANK[p.tier] > TIER_RANK[worst.tier]) worst = p;
	// `git add` is the one allow-tier shape that mutates the index and meets the
	// claim floor — a compound where any segment adds must surface that shape
	// even when another allow segment wins the tie.
	if (worst.tier === "allow" && parts.some((p) => p.shape === "git add")) worst = { ...worst, shape: "git add" };
	const pushPart = parts.find((p) => p.shape === "git push");
	return { ...worst, targetDir: worst.targetDir ?? target, ...(pushPart?.pushArgs ? { pushArgs: pushPart.pushArgs } : {}) };
}

function allow(shape: string, targetDir?: string): Classification {
	return { tier: "allow", shape, targetDir };
}
function ask(shape: string, reason?: string, targetDir?: string): Classification {
	return { tier: "ask", shape, reason, targetDir };
}
function destructive(shape: string, targetDir?: string, extra?: string): Classification {
	return { tier: "destructive", shape, targetDir, ...(extra ? { reason: extra } : {}) };
}
function refuse(shape: string, reason: string, targetDir?: string): Classification {
	return { tier: "refuse", shape, reason, targetDir };
}
