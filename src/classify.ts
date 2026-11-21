/**
 * Pure command classification for the git/gh floors — both gate by blacklist:
 * agent-typed git/gh defaults to allow, and a compact set of high-risk rows
 * (refuse / ask / destructive, in docs/api.md) gates. Token/glob grade, not a
 * shell AST: a redirection, a script write, or an exotic plumbing writer is
 * not seen — those tunnels are named in the docs, not parsed away. No state,
 * no fs, no processes: the floors resolve owners, claim targets, and binds
 * at use time.
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
		if (quote === '"' && c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) {
			cur += s[i + 1]; // an escaped quote/backslash inside double quotes is literal — the string does not end
			i++;
		} else if (quote !== null) {
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

/** Shell receivers whose heredoc body is a script to classify, not data. */
const HEREDOC_SHELLS = /\b(bash|sh|zsh|dash|ksh)(?![A-Za-z0-9_])/;

/**
 * Split a command line on top-level `&&` `||` `;` `|` (quote-aware). A
 * heredoc body is stdin data — swallowed whole unless the receiver is a
 * shell, whose body is a script and keeps splitting.
 */
function splitSegments(cmd: string): string[] {
	const segs: string[] = [];
	let cur = "";
	let quote: '"' | "'" | null = null;
	const flush = () => {
		if (cur.trim() !== "") segs.push(cur.trim());
		cur = "";
	};
	let i = 0;
	while (i < cmd.length) {
		const c = cmd[i];
		if (quote === '"' && c === "\\" && (cmd[i + 1] === '"' || cmd[i + 1] === "\\")) {
			cur += cmd[i + 1]; // escaped quote/backslash inside double quotes — the string does not end
			i += 2;
			continue;
		}
		if (quote !== null) {
			cur += c;
			if (c === quote) quote = null;
			i++;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			cur += c;
			i++;
			continue;
		}
		if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
			let j = i + 2;
			if (cmd[j] === "-") j++;
			if (cmd[j] === "'" || cmd[j] === '"') j++;
			let w = "";
			while (j < cmd.length && /[A-Za-z0-9_]/.test(cmd[j])) w += cmd[j++];
			if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(w)) {
				const nl = cmd.indexOf("\n", j);
				const bodyStart = nl === -1 ? cmd.length : nl + 1;
				let p = bodyStart;
				let termStart = cmd.length;
				let termEnd = cmd.length;
				while (p < cmd.length) {
					const n2 = cmd.indexOf("\n", p);
					const lineEnd = n2 === -1 ? cmd.length : n2;
					if (cmd.slice(p, lineEnd).trim() === w) {
						termStart = p;
						termEnd = lineEnd;
						break;
					}
					if (n2 === -1) break;
					p = n2 + 1;
				}
				cur += cmd.slice(i, j);
				if (nl !== -1 && j < nl) segs.push(...splitSegments(cmd.slice(j, nl))); // header remainder after the tag is command text
				if (HEREDOC_SHELLS.test(`${cur} `)) {
					// the body is a shell script — it keeps splitting like any command text
					flush();
					i = bodyStart;
				} else {
					// the body is data — one opaque lump inside this segment
					cur += cmd.slice(bodyStart, termStart);
					i = termEnd;
				}
				continue;
			}
		}
		if (c === "&" && cmd[i + 1] === "&") {
			flush();
			i += 2;
		} else if (c === "|" && cmd[i + 1] === "|") {
			flush();
			i += 2;
		} else if (c === "|" || c === ";") {
			flush();
			i++;
		} else {
			cur += c;
			i++;
		}
	}
	flush();
	return segs;
}

// --- git ---------------------------------------------------------------------------------

/** Non-flag arguments of a segment. */
function bare(args: string[]): string[] {
	return args.filter((a) => !a.startsWith("-"));
}

/** A `+` refspec or an empty-source deletion refspec (`:branch`). */
function isForceRefspec(words: string[]): boolean {
	return words.some((w) => w === "+" || w.startsWith("+") || /^:[^^]/.test(w) || /:[^/]+\.\.\./.test(w));
}

/** Valueless git global flags — shift bare; every other unknown global asks (its value or its subcommand must not masquerade). */
const GIT_BOOL_GLOBALS = new Set(["-p", "--paginate", "--no-pager", "-P", "--bare", "--no-replace-objects", "--literal-pathspecs", "--no-literal-pathspecs", "--no-optional-locks", "--no-renames"]);

function classifyGit(words: string[]): Classification {
	const rest = [...words];
	let targetDir: string | undefined;
	let gitDir: string | undefined;
	// Global flags before the subcommand: -C/--git-dir record the claim target; an
	// unknown global asks — value-taking and valueless are indistinguishable at token grade.
	while (rest.length > 0 && rest[0].startsWith("-") && rest[0] !== "--") {
		const w = rest[0];
		if (GIT_BOOL_GLOBALS.has(w)) rest.shift();
		else if (w === "-C") {
			targetDir = rest[1];
			rest.splice(0, 2);
		} else if (w.startsWith("-C") && w.length > 2) {
			targetDir = w.slice(2);
			rest.shift();
		} else if (w === "--git-dir") {
			gitDir = rest[1];
			rest.splice(0, 2);
		} else if (w.startsWith("--git-dir=")) {
			gitDir = w.slice("--git-dir=".length);
			rest.shift();
		} else if (/^--[a-zA-Z-]+=/.test(w)) rest.shift(); // self-contained --flag=value
		else if (w === "-c" || w.startsWith("-c")) rest.splice(0, w === "-c" ? 2 : 1);
		else return ask("git", `unknown git global flag '${w}' — run the command with plain flags, or from inside the tree`, gitDir ?? targetDir);
	}
	if (rest[0] === "--") rest.shift();
	const target = gitDir ?? targetDir;
	const sub = rest[0];
	if (sub === undefined || !/^[a-z][a-z0-9-]*$/.test(sub)) return ask("git", "unknown git form — not a plausible subcommand", target);
	const args = rest.slice(1);
	const pos = bare(args);

	if (sub === "commit") {
		if (args.includes("--amend") || args.includes("--no-verify") || args.includes("-n")) {
			return destructive(`git ${sub}`, target);
		}
		return refuse(`git ${sub}`, "git commit is refused in bash — use the git_commit tool (hooks on, identity trailers, review bind). --amend/--no-verify are destructive-tier and need the dialog.", target);
	}
	if (sub === "push") {
		const flags = args.filter((a) => a.startsWith("-"));
		const force = flags.some((f) => f === "-f" || f === "--force" || f === "--force-with-lease" || f === "--force-if-includes" || f.startsWith("--force")) || args.includes("--delete") || args.includes("-d") || isForceRefspec(args);
		if (force) {
			return destructive("git push", target, "force/delete push forms are destructive-tier — approve-once dialog only, never covered by any approval.");
		}
		return { tier: "ask", shape: "git push", targetDir: target, pushArgs: args };
	}
	if (sub === "tag") {
		const listish = pos.length === 0 || args.some((a) => a === "-l" || a === "--list" || /^-n\d*$/.test(a));
		if (listish) return allow("git tag", target);
		return ask("git tag", "git tag <name> creates/moves/deletes a release marker — approve it deliberately", target);
	}
	if (sub === "reset") {
		if (args.includes("--hard")) return destructive("git reset", target);
		return allow("git reset", target);
	}
	if (sub === "checkout") {
		// `--`/`.`/`./`/`:/` path forms and the force/create-or-reset spellings discard work — destructive.
		// A bare word (`checkout main`, `checkout src/a.ts`) is token-grade ambiguous and rides allow (documented residue).
		if (args.includes("--") || [".", "./", ":/"].includes(pos[0] ?? "") || args.some((a) => a === "-f" || a === "--force" || a === "-B")) return destructive("git checkout", target);
		return allow("git checkout", target);
	}
	if (sub === "restore") {
		const staged = args.includes("--staged") || args.includes("-S");
		const worktree = args.includes("--worktree") || args.includes("-W") || /^-[a-zA-Z]*W[a-zA-Z]*$/.test(args.find((a) => /^-[a-zA-Z]*W/.test(a)) ?? "");
		if (staged && !worktree) return allow("git restore", target);
		return destructive("git restore", target);
	}
	if (sub === "stash") {
		if (pos[0] === "drop" || pos[0] === "clear") return destructive("git stash", target);
		return allow("git stash", target);
	}
	if (sub === "branch") {
		if (args.includes("-D")) return destructive("git branch", target);
		return allow("git branch", target);
	}
	if (sub === "reflog") {
		if (pos.includes("expire") || pos.includes("delete")) return destructive("git reflog", target);
		return allow("git reflog", target);
	}
	if (sub === "rebase" || sub === "clean") return destructive(`git ${sub}`, target);
	return allow(`git ${sub}`, target);
}

// --- gh ----------------------------------------------------------------------------------

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
		// Value-taking global flags consume their argument; any other global is
		// unknown — ask (its value or subcommand must not masquerade past the gate).
		if (w === "-R" || w === "--repo" || w === "--hostname") {
			if (rest.length > 0 && !rest[0].startsWith("-")) rest.shift();
		} else return ask("gh", `unknown gh global flag '${w}' — run the command plainly`);
	}
	if (rest[0] === "--") rest.shift();
	const sub = rest[0];
	if (sub === undefined || !/^[a-z][a-z0-9-]*$/.test(sub)) return ask("gh", "unknown gh form — not a plausible subcommand");

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
		return allow("gh api");
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
			return allow("gh pr review");
		}
		if (verb === "comment") {
			const b = ghBodyArgs(args);
			if (b.inline) return refuse(`gh ${sub} comment`, ghPostRefusal(`gh ${sub} comment`));
			if (b.stdin) return refuse(`gh ${sub} comment`, ghPostRefusal(`gh ${sub} comment`));
			if (b.bodyFile) return { tier: "ask", shape: "gh comment", bodyFile: b.bodyFile };
			return { tier: "ask", shape: "gh comment", noBody: true };
		}
		if (verb === "create" || verb === "edit") {
			const b = ghBodyArgs(args);
			if (b.inline) return refuse(`gh ${sub} ${verb}`, ghPostRefusal(`gh ${sub} ${verb}`));
			if (b.stdin) return refuse(`gh ${sub} ${verb}`, ghPostRefusal(`gh ${sub} ${verb}`));
			if (b.bodyFile) return { tier: "ask", shape: sub === "pr" && verb === "create" ? "gh pr create" : sub === "pr" ? "gh pr edit" : "gh comment", bodyFile: b.bodyFile };
			return { tier: "ask", shape: sub === "pr" && verb === "create" ? "gh pr create" : sub === "pr" ? "gh pr edit" : "gh comment", noBody: true };
		}
		return allow(`gh ${sub} ${verb}`);
	}

	if (sub === "release") {
		const verb = rest[1];
		if (verb === "create" || verb === "upload") {
			return ask("gh release", "gh release create/upload publishes a release — the git tag twin; approve deliberately");
		}
		if (verb !== undefined && GH_STATE_WORDS.has(verb)) return refuse(`gh release ${verb}`, `gh release ${verb} changes state — refuse-tier for agents; ask the user to do it.`);
		return allow("gh release");
	}
	if (sub === "search" || sub === "run" || sub === "repo" || sub === "label" || sub === "workflow" || sub === "auth" || sub === "config" || sub === "extension" || sub === "completion") {
		const verb = rest[1];
		if (verb !== undefined && GH_STATE_WORDS.has(verb)) return refuse(`gh ${sub} ${verb}`, `gh ${sub} ${verb} changes state — refuse-tier for agents; ask the user to do it.`);
		return allow(`gh ${sub}`);
	}
	return allow(`gh ${sub}`);
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

const GIT_DIR_ENV = /^GIT_DIR=/i;

export function classifySegment(segment: string): Classification {
	let words = shellWords(segment);
	// GIT_DIR relocates the claim target wherever the assignment sits (bare or
	// after `env`); no env assignment changes a tier.
	let envTarget: string | undefined;
	const stripAssignments = (): void => {
		while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
			const v = words[0].slice(words[0].indexOf("=") + 1);
			if (GIT_DIR_ENV.test(words[0])) envTarget = v;
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
	if (words[0] === "git") {
		const c = classifyGit(words.slice(1));
		return envTarget === undefined ? c : { ...c, targetDir: envTarget ?? c.targetDir };
	}
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
