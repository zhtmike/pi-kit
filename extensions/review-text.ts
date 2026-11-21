/**
 * pi-kit review-text — review-surface scaffolds: disclosure and shape only.
 * `pr_draft` owns the PR body file (template coverage, AI-assistance section,
 * compare URL); `review_text` returns paste-ready comment/reply/summary texts
 * with the marker appended. No posting, no remote calls — the no-gh-write
 * environment is a first-class mode: the tool result is the deliverable.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { defineTool, getMarkdownTheme, isToolCallEventType, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { loadConfig, type PiKitConfig } from "../src/config.ts";
import { identityFrom } from "../src/identity.ts";
import { checkDraft, commentText, parseRemoteUrl, isGithubHost, replyText, summaryText } from "../src/envelopes.ts";
import { gitRootOf, type ExecFn } from "../src/githelp.ts";
import { slugify } from "../src/util.ts";
import { fenceOff, ok, stringEnum } from "./shared.ts";

const TEMPLATE_CANDIDATES = [
	".github/PULL_REQUEST_TEMPLATE.md",
	".github/pull_request_template.md",
	"PULL_REQUEST_TEMPLATE.md",
	"pull_request_template.md",
	"docs/PULL_REQUEST_TEMPLATE.md",
];
const TEMPLATE_DIRS = [".github/PULL_REQUEST_TEMPLATE", ".github/pull_request_template", "PULL_REQUEST_TEMPLATE"];

export default function (pi: ExtensionAPI) {
	let cfg: PiKitConfig;
	try {
		cfg = loadConfig();
	} catch (e) {
		return fenceOff(pi, (e as Error).message);
	}

	const exec: ExecFn = (cmd, args, opts = {}) => pi.exec(cmd, args, opts);

	// --- pr_draft ----------------------------------------------------------------------------

	const prDraftTool = defineTool({
		name: "pr_draft",
		label: "Draft the PR body",
		description:
			"Write/overwrite pr_<branch-slug>.md in the project root — the paste-ready PR body. " +
			"Compose the body filling the repo's PR template when one exists (single file or template directory, any heading level); the tool checks heading coverage line-exact, appends the AI-assistance section from `assistance` when neither the body nor the template carries one, and returns the body plus a locally-derived compare URL and the landed base..head commits (for body-sync). " +
			"No posting, no network.",
		parameters: Type.Object({
			body: Type.String({ description: "The PR body you composed (what/why, root cause, tests+results, disclosures)" }),
			assistance: Type.Optional(Type.String({ description: "AI-assistance section content when the body carries none: what the agent did, what the human reviewed and stands behind" })),
			base: Type.Optional(Type.String({ description: "Base branch (default: the remote HEAD branch, else 'main')" })),
			head: Type.Optional(Type.String({ description: "Head branch (default: the current branch)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const root = await gitRootOf(exec, ctx.cwd ?? process.cwd());
			if (root === null) throw new Error("not inside a git work tree");
			// Precondition first: an unborn branch has no head and no base..head range —
			// name it, never leak the git fatal.
			const headOk = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: root });
			if (headOk.code !== 0) {
				throw new Error("the branch has no commits yet — pr_draft derives the head branch and the landed base..head commits from history. Land the first commit (git_commit), then re-call pr_draft.");
			}
			const head = params.head ?? (await git(exec, root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
			const base = params.base ?? (await defaultBase(exec, root));
			const template = readTemplate(root);
			const identity = identityFrom(cfg.agentName, ctx.model as any);
			const check = checkDraft(params.body, params.assistance, template?.text, identity);
			if (check.templateMissing.length > 0) {
				throw new Error(
					`the repo's PR template (${template!.path}) pins headings the body lacks: ${check.templateMissing.join(" | ")}. Fill the template — it is the envelope; re-run with the completed body.`,
				);
			}
			// The draft lands first — the deliverable survives a missing compare URL.
			const file = path.join(root, `pr_${slugify(head)}.md`);
			fs.writeFileSync(file, `${check.body}\n`);
			// Compare URL — local string work from the push remote.
			let url: string;
			try {
				url = await remoteUrl(exec, root);
			} catch (e) {
				throw new Error(`${(e as Error).message} (the draft file is written at ${file} — open the PR by hand from it)`);
			}
			const ident = parseRemoteUrl(url);
			let compare: string;
			if (ident === undefined || !isGithubHost(ident.host)) {
				throw new Error(
					`push remote '${url}' is not a parseable GitHub remote — no compare URL can be derived. Manual path: open ${url}/compare/${base}...${head} in a browser (the draft file is written at ${file}; only the URL is missing).`,
				);
			}
			compare = `https://${ident.host}/${ident.owner}/${ident.name}/compare/${base}...${head}`;
			const commitsRun = await exec("git", ["log", "--format=%h %s", `${base}..${head}`], { cwd: root });
			if (commitsRun.code !== 0) {
				throw new Error(`git log ${base}..${head} failed: ${commitsRun.stderr.trim()} — check the branch names (base '${base}' must exist locally; fetch it first if only the remote knows it).`);
			}
			const commits = commitsRun.stdout;
			return ok(
				[
					`draft written: ${file} (overwrite is the update path after new commits land)`,
					`compare: ${compare}`,
					`base ${base} → head ${head}`,
					commits.trim() === "" ? "(no commits in range)" : `landed commits:\n${commits.trim()}`,
					`body:\n\n${check.body}`,
				].join("\n\n"),
				{ body: check.body, path: file, compare, base, head },
			);
		},
	});
	pi.registerTool(prDraftTool);

	// --- review_text -------------------------------------------------------------------------

	const reviewTextTool = defineTool({
		name: "review_text",
		label: "Review text",
		description:
			"Return paste-ready review texts in the tool result — a review is one summary call plus one comment call per thread, and one reply call per answered thread; no posting, no dialog. " +
			"kind comment: one imperative ask with a file:line anchor, at most one fact. " +
			"kind reply: the answered finding opens as a > blockquote, then 'Addressed in <commit>:' or 'Skipped, with reasoning:', answers below; each reply carries its own small-print marker. " +
			"kind summary: the review body in blocks (verdict / findings / coverage; code the repo does not carry may ride as fenced blocks), closed with the AI-assistance footer. " +
			"The tool refuses text it cannot mark or attribute.",
		parameters: Type.Object({
			kind: stringEnum(["comment", "reply", "summary"] as const, { description: "Which review surface" }),
			file: Type.Optional(Type.String({ description: "kind comment: the file the anchor names" })),
			line: Type.Optional(Type.Number({ description: "kind comment: the line the anchor names", minimum: 1 })),
			ask: Type.Optional(Type.String({ description: "kind comment: one imperative ask" })),
			fact: Type.Optional(Type.String({ description: "kind comment: at most one fact (a sibling path rides here)" })),
			verdict: Type.Optional(stringEnum(["addressed", "skipped"] as const, { description: "kind reply: the verdict token" })),
			quote: Type.Optional(Type.String({ description: "kind reply (required): the finding, request, or comment replied to — rendered at the top as a > blockquote" })),
			answers: Type.Optional(Type.String({ description: "kind reply: the reply's own answer, below the verdict opener" })),
			commit: Type.Optional(Type.String({ description: "kind reply: the commit that addressed it (required for 'addressed')" })),
			verification: Type.Optional(Type.String({ description: "kind reply: the verification behind the answer" })),
			reason: Type.Optional(Type.String({ description: "kind reply: why it was skipped (required for 'skipped')" })),
			text: Type.Optional(Type.String({ description: "kind summary: the review body, block-composed (verdict / findings / coverage)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const identity = identityFrom(cfg.agentName, ctx.model as any);
			if (identity.agent === "") throw new Error("no agent identity — pass agentName in pi-kit.json; the tool refuses unattributed text");
			let text: string;
			if (params.kind === "comment") {
				if (params.file === undefined || params.line === undefined || params.ask === undefined) {
					throw new Error("kind 'comment' requires file, line, and ask");
				}
				text = commentText({ file: params.file, line: params.line, ask: params.ask, fact: params.fact });
			} else if (params.kind === "reply") {
				if (params.verdict === undefined || params.answers === undefined) {
					throw new Error("kind 'reply' requires verdict and answers");
				}
				text = replyText(
					{ verdict: params.verdict, quote: params.quote ?? "", answers: params.answers, commit: params.commit, verification: params.verification, reason: params.reason },
					identity,
				);
			} else {
				if (params.text === undefined) throw new Error("kind 'summary' requires text");
				text = summaryText(params.text, identity);
			}
			return ok(text, { kind: params.kind, text });
		},

		renderResult(result, options, theme) {
			const body = result.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
			if (!options.expanded) return new Text(theme.fg("toolOutput", body.split("\n")[0].slice(0, 200)), 0, 0);
			return new Markdown(body, 0, 0, getMarkdownTheme());
		},
	});
	pi.registerTool(reviewTextTool);

	async function git(exec: ExecFn, cwd: string, args: string[]): Promise<string> {
		const r = await exec("git", args, { cwd, timeout: 15_000 });
		if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
		return r.stdout;
	}

	async function remoteUrl(exec: ExecFn, root: string): Promise<string> {
		for (const remote of ["origin", "upstream"]) {
			const r = await exec("git", ["remote", "get-url", "--push", remote], { cwd: root });
			if (r.code === 0 && r.stdout.trim() !== "") return r.stdout.trim();
			const fb = await exec("git", ["remote", "get-url", remote], { cwd: root });
			if (fb.code === 0 && fb.stdout.trim() !== "") return fb.stdout.trim();
		}
		throw new Error("no 'origin'/'upstream' remote — the compare URL needs one; add a remote and re-run pr_draft");
	}

	function readTemplate(root: string): { path: string; text: string } | undefined {
		for (const rel of TEMPLATE_CANDIDATES) {
			const p = path.join(root, rel);
			if (fs.existsSync(p)) return { path: rel, text: fs.readFileSync(p, "utf8") };
		}
		for (const dir of TEMPLATE_DIRS) {
			const d = path.join(root, dir);
			if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
			const files = fs.readdirSync(d).filter((f) => f.endsWith(".md")).sort();
			const pick = files.includes("default.md") ? "default.md" : files[0];
			if (pick !== undefined) return { path: `${dir}/${pick}`, text: fs.readFileSync(path.join(d, pick), "utf8") };
		}
		return undefined;
	}
}

async function defaultBase(exec: ExecFn, root: string): Promise<string> {
	const r = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root });
	if (r.code === 0) {
		const ref = r.stdout.trim();
		const branch = ref.split("/").slice(1).join("/");
		if (branch !== "") return branch;
	}
	return "main";
}

