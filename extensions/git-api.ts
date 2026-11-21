/**
 * pi-kit git-api — the git/gh approval boundary. Two tools: `git_commit`
 * (hooks on, identity trailers, review-bind spend, approval record) and
 * `review_bind` (the fresh-review record git_commit and gh posts spend).
 * The bash floor classifies git/gh/pkill shapes into the tier table
 * (docs/api.md): refuse shapes block naming the API tool; ask-tier shapes
 * need coverage (standing allow, session approval, or dialog); destructive
 * shapes dialog approve-once/refuse only. Session approvals record from the
 * TUI typing channel only (mode+source+no-child-markers) and survive
 * compaction via session entries.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { defineTool, isToolCallEventType, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, standingCovers, type AskShape, type PiKitConfig } from "../src/config.ts";
import { classifyCommand, type Classification } from "../src/classify.ts";
import { APPROVAL_ACTIONS, foldEntry, parseApproval, type ApprovalAction } from "../src/approvals.ts";
import { identityFrom, trailerLines } from "../src/identity.ts";
import { findBind, recordBinds, sha256File, spendBind } from "../src/binds.ts";
import { ensureClaimAt, selfOf } from "../src/claimrun.ts";
import { gitRootOf, piDirIgnored, repoIdentity, resolvePushTarget, writeTree, type ExecFn } from "../src/githelp.ts";
import { setStatusPart, bindStatusSink } from "../src/status.ts";
import { fenceOff, ok, stringEnum } from "./shared.ts";

const APPROVAL_ENTRY = "pi-kit-approvals";

export default function (pi: ExtensionAPI) {
	let cfg: PiKitConfig;
	try {
		cfg = loadConfig();
	} catch (e) {
		return fenceOff(pi, (e as Error).message);
	}

	const exec: ExecFn = (cmd, args, opts = {}) => pi.exec(cmd, args, opts);

	// --- session approvals  ------------------------------------------------------------

	let grants = new Set<ApprovalAction>();
	let misses: string[] = [];
	let recordFailure: string | undefined;
	let currentSid = ""; // for best-effort quit hygiene outside event contexts

	const childMarker = (): boolean =>
		process.env.PI_MINIMAL_DISPATCH_CHILD === "1" || Object.keys(process.env).some((k) => k.startsWith("NIGHTWATCH_"));

	const humanChannel = (mode: string, source: string | undefined): boolean =>
		mode === "tui" && source === "interactive" && !childMarker();

	function recordEntry(data: { granted?: ApprovalAction[]; cleared?: boolean }): boolean {
		try {
			pi.appendEntry(APPROVAL_ENTRY, data);
			recordFailure = undefined;
			return true;
		} catch (e) {
			recordFailure = `approval record failed: ${(e as Error).message} — the op is NOT covered (fail closed)`;
			return false;
		}
	}

	function approvalFooter(): void {
		const parts: string[] = [];
		if (grants.size > 0) parts.push(`approved: ${[...grants].join(", ")}`);
		if (misses.length > 0) parts.push(`parse miss: ${misses[misses.length - 1]}`);
		if (recordFailure !== undefined) parts.push(recordFailure);
		setStatusPart("gate", parts.length > 0 ? parts.join(" · ") : undefined);
	}

	pi.on("input", async (event, ctx) => {
		if (!humanChannel(ctx.mode, event.source)) return { action: "continue" };
		const p = parseApproval(event.text);
		if (p.grants.length > 0) {
			if (recordEntry({ granted: p.grants })) {
				for (const a of p.grants) grants.add(a);
			}
		} else if (p.miss) {
			misses.push(event.text.length > 60 ? `${event.text.slice(0, 57)}…` : event.text);
			if (misses.length > 5) misses = misses.slice(-5);
		}
		approvalFooter();
		return { action: "continue" };
	});

	pi.on("session_start", (event, ctx) => {
		currentSid = ctx.sessionManager.getSessionId() ?? "";
		bindStatusSink((line) => ctx.ui.setStatus("pi-kit", line));
		// In-memory state rebuilds from the file at every session_start; a fork
		// clears so a later reload does not replay the parent's set.
		grants = new Set();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && (entry as any).customType === APPROVAL_ENTRY) {
				grants = foldEntry(grants, ((entry as any).data ?? {}) as any);
			}
		}
		if (event.reason === "fork") {
			recordEntry({ cleared: true });
			grants = new Set();
		}
		approvalFooter();
	});

	pi.on("session_shutdown", (event) => {
		if (event.reason === "quit") recordEntry({ cleared: true });
	});

	// --- bash floor  -------------------------------------------------------------------

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const c = classifyCommand(event.input.command);
		if (c.tier === "allow") return;
		if (c.tier === "selfmatch" || c.tier === "refuse") return { block: true, reason: c.reason };

		const dir = c.targetDir !== undefined ? path.resolve(c.targetDir) : ctx.cwd ?? process.cwd();
		const sid = ctx.sessionManager.getSessionId() ?? "";

		if (c.tier === "ask") {
			// gh posts bind first: --body-file must point at a bound file.
			if (c.bodyFile !== undefined && !await checkPostBind(c.bodyFile)) {
				return { block: true, reason: bindRefusal(c.bodyFile) };
			}
			// push resolves an owner; non-owner and unparseable targets refuse without a dialog.
			if (c.shape === "git push") {
				const words = commandWords(event.input.command);
				const pushArgs = pushArgsOf(words);
				const t = await resolvePushTarget(exec, dir, pushArgs);
				if (t.status === "error") return { block: true, reason: `git push refused — ${t.note}` };
				if (t.status === "unparseable") return { block: true, reason: `git push refused — ${t.note}` };
				if (!t.github || !cfg.ownerLogins.map((l) => l.toLowerCase()).includes(t.ident.owner.toLowerCase())) {
					return {
						block: true,
						reason:
							`git push refused — remote ${t.remote} resolves to ${t.ident.owner}/${t.ident.name} on ${t.ident.host}, and the owner is not in ownerLogins [${cfg.ownerLogins.join(", ") || "empty"}]. ` +
							"Pushes go to owner-owned remotes only; ask the user to push, or extend ownerLogins in pi-kit.json.",
					};
				}
			}
			// Coverage: standing allow → session approval → dialog.
			const repoIdent = await repoIdentity(exec, dir);
			if (standingShape(c) !== undefined && standingCovers(cfg, repoIdent, standingShape(c)!)) {
				setStatusPart("gate", `standing allow: ${c.shape}`);
				return;
			}
			const action = approvalActionOf(c.shape);
			if (action !== undefined && grants.has(action)) {
				setStatusPart("gate", `session approval covers ${c.shape}`);
				return;
			}
			if (ctx.hasUI) {
				setStatusPart("wait", `waiting on person: ${c.shape}`);
				const options = action !== undefined ? ["Approve once", "Approve for this session", "Refuse"] : ["Approve once", "Refuse"];
				const choice = await ctx.ui.select([`pi-kit gate: ${c.tier}`, event.input.command, ...(c.reason ?? "").split("\n")].join("\n"), options);
				setStatusPart("wait", undefined);
				if (choice === undefined || choice === "Refuse") {
					return { block: true, reason: `refused in dialog: ${event.input.command}` };
				}
				if (action !== undefined && choice === "Approve for this session" && recordEntry({ granted: [action] })) {
					grants.add(action);
					approvalFooter();
				}
				setStatusPart("gate", `dialog-approved: ${c.shape}`);
				return;
			}
			const shapeKey = standingShape(c) ?? c.shape;
			return {
				block: true,
				reason:
					`not covered: ${event.input.command}. Ask-tier shapes need a standing allow, a session approval, or the interactive dialog — headless runs get none of the dialog. ` +
					`Standing allow for this shape: { "repo": ${repoIdent ?? "*"}, "shapes": ["${shapeKey}"] } in pi-kit.json standingAllows.`,
			};
		}

		// destructive
		if (ctx.hasUI) {
			setStatusPart("wait", `waiting on person: ${c.shape} (destructive)`);
			const choice = await ctx.ui.select(["pi-kit gate: destructive", event.input.command, "Destructive-tier: approve-once only — never covered by any approval."].join("\n"), ["Approve once", "Refuse"]);
			setStatusPart("wait", undefined);
			if (choice === "Approve once") {
				setStatusPart("gate", `dialog-approved: ${c.shape} (once)`);
				return;
			}
			return { block: true, reason: `refused in dialog: ${event.input.command}` };
		}
		return {
			block: true,
			reason: `destructive-tier (${c.shape}) with no UI — headless runs never run destructive shapes. ${c.reason ?? ""}`.trim(),
		};
	});

	async function checkPostBind(file: string): Promise<boolean> {
		const root = await gitRootOf(exec, process.cwd());
		if (root === null) return false;
		try {
			const hash = sha256File(path.resolve(file));
			return findBind(root, "post", hash, "") !== undefined;
		} catch {
			return false;
		}
	}

	function bindRefusal(file: string): string {
		return (
			`gh post refused — --body-file ${file} has no review_bind record. Compose the text with review_text, write it to a file, ` +
			"bind it (review_bind kind post, path <file>), then re-run with --body-file. Inline --body, heredocs, and pipes are refused outright."
		);
	}

	// --- review_bind -------------------------------------------------------------------------

	const reviewBindTool = defineTool({
		name: "review_bind",
		label: "Bind a fresh review",
		description:
			"Record that a fresh review ran — the record git_commit (kind tree) and gh posts (kind post) spend. " +
			"The bind exists to prove a fresh review ran: a reviewer lane dispatched by commit-gate with the review task in its brief and this tool in its tools. " +
			"A bare 'bind the current index' lane is a rubber stamp; the committer's own sid never counts. Refuses at thinking off/minimal/low — a low-thinking binder reviews nothing.",
		parameters: Type.Object({
			kind: stringEnum(["tree", "post"] as const, { description: "tree: the staged index (git write-tree); post: a to-be-posted text file" }),
			path: Type.Optional(Type.String({ description: "kind post only: the file whose sha256 is bound (the --body-file of the coming gh post)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const level = ctx.thinkingLevel ?? "";
			if (level === "off" || level === "minimal" || level === "low") {
				throw new Error(`review_bind refuses at thinking '${level}' — a low-thinking binder reviews nothing. Re-dispatch the reviewer lane at high or maximum thinking.`);
			}
			const sid = ctx.sessionManager.getSessionId() ?? "";
			if (sid === "") throw new Error("review_bind refuses an empty session id — the record must name the reviewing session");
			const root = await gitRootOf(exec, ctx.cwd ?? process.cwd());
			if (root === null) throw new Error("not inside a git work tree");
			if (!(await piDirIgnored(exec, root))) {
				throw new Error(`.pi/ is not gitignored in ${root} — bind records are never created where 'git status' would show them; add a '.pi/' line to .gitignore.`);
			}
			let hash: string;
			if (params.kind === "tree") {
				hash = await writeTree(exec, root);
			} else {
				if (params.path === undefined) throw new Error("kind 'post' requires 'path' — the file the coming gh post reads via --body-file");
				const p = path.resolve(params.path);
				if (!fs.existsSync(p)) throw new Error(`no such file: ${p} — write the post text (review_text returns it), then bind it`);
				hash = sha256File(p);
			}
			const self = selfOf(sid);
			if (!recordBinds(root, self, [{ kind: params.kind, hash, sid, at: new Date().toISOString() }])) {
				throw new Error(`could not take the binds lock in ${root} — a live process holds it; retry shortly.`);
			}
			return ok(`bound ${params.kind} ${hash.slice(0, 12)} (session ${sid.slice(0, 8)}) — git_commit/gh-post floors can spend it. Rows are hash-keyed; the committer's own sid never counts.`);
		},
	});
	pi.registerTool(reviewBindTool);

	// --- git_commit --------------------------------------------------------------------------

	const gitCommitTool = defineTool({
		name: "git_commit",
		label: "Commit (gated)",
		description:
			"Commit the staged diff — hooks on, identity trailers injected, the review bind spent, the approval recorded. " +
			"Does NOT run the fresh review: commit-gate still does, before this tool is called; its reviewer lane uses the fast read-only model at high thinking (judgment model at max only for design-grade artifacts, unsettleable reads, or blocking findings). " +
			"Needs a review_bind row for the staged tree (TUI fallback: your user confirms they reviewed it because dispatch was impossible), then an approval: standing allow, session approval, or dialog. Stage with git add first.",
		parameters: Type.Object({
			subject: Type.String({ description: "One-line subject (repo convention when one exists)" }),
			body: Type.Optional(Type.String({ description: "Body: root-cause narrative with numbers, not a diff restatement" })),
			trailers: Type.Optional(Type.Array(Type.String(), { description: "Extra trailer lines (a trailer the edited files' own rules require rides along, never dropped)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const sid = ctx.sessionManager.getSessionId() ?? "";
			const startDir = ctx.cwd ?? process.cwd();
			const root = await gitRootOf(exec, startDir);
			if (root === null) throw new Error("not inside a git work tree");
			// The claim floor: a commit writes history in this tree — ensure the claim like `git add`.
			const claim = await ensureClaimAt(exec, startDir, sid);
			if (!claim.ok) throw new Error(claim.reason);

			// Staged diff + bind.
			const stat = await exec("git", ["diff", "--cached", "--stat"], { cwd: root });
			if (stat.code !== 0) throw new Error(`git diff --cached failed: ${stat.stderr.trim()}`);
			if (stat.stdout.trim() === "") throw new Error("nothing staged — stage the diff with git add, then call git_commit (it commits the index, hooks on)");
			const treeHash = await writeTree(exec, root);
			const identity = identityFrom(cfg.agentName, ctx.model as any);
			let bindSource: string;
			const bind = findBind(root, "tree", treeHash, sid);
			if (bind !== undefined) {
				bindSource = `review_bind row (session ${bind.sid.slice(0, 8)})`;
			} else if (ctx.hasUI) {
				setStatusPart("wait", "waiting on person: fresh-review bind missing");
				const confirmed = await ctx.ui.confirm(
					"git_commit: no review bind for the staged tree",
					"A review_bind record for this exact staged tree is missing. Confirm only if you reviewed the diff yourself because dispatch was impossible.",
				);
				setStatusPart("wait", undefined);
				if (confirmed) bindSource = "user confirm (dispatch impossible)";
				else {
					throw new Error(
						"refused: the staged tree is unbound. Run commit-gate's fresh review: dispatch ONE read-only reviewer lane with the review task in its brief and review_bind in its tools — the lane binds the tree it reviewed; then re-call git_commit. (A session approval never pays this bind.)",
					);
				}
			} else {
				throw new Error(
					"refused: the staged tree is unbound and headless runs cannot confirm. Dispatch a reviewer lane (commit-gate's flow) with review_bind in its tools, then re-call git_commit.",
				);
			}

			// Approval: standing → session → dialog.
			let approvalSource: string;
			const repoIdent = await repoIdentity(exec, root);
			if (standingCovers(cfg, repoIdent, "git_commit")) {
				approvalSource = "standing allow (pi-kit.json)";
			} else if (grants.has("commit")) {
				approvalSource = "session approval";
			} else if (ctx.hasUI) {
				const message = commitMessage(params, identity);
				setStatusPart("wait", "waiting on person: commit approval");
				const choice = await ctx.ui.select(["git_commit: commit the staged diff?", stat.stdout.trim(), "", message].join("\n"), ["Approve once", "Approve for this session", "Refuse"]);
				setStatusPart("wait", undefined);
				if (choice === undefined || choice === "Refuse") throw new Error("commit refused in dialog");
				if (choice === "Approve for this session" && recordEntry({ granted: ["commit"] })) {
					grants.add("commit");
					approvalFooter();
				}
				approvalSource = "dialog";
			} else {
				throw new Error(
					"refused: no approval covers this commit (no standing allow for this repo, no session approval, no UI for a dialog). Ask the user, or add a standingAllows entry in pi-kit.json.",
				);
			}

			// Commit with hooks on (no --no-verify anywhere).
			const message = commitMessage(params, identity);
			const commitRun = await exec("git", ["commit", "-m", message], { cwd: root, timeout: 120_000 });
			const hookOutput = `${commitRun.stdout}${commitRun.stderr}`.trim();
			if (commitRun.code !== 0) {
				throw new Error(`git commit exited ${commitRun.code} (hooks on) — the bind row stays unspent:\n${hookOutput}`);
			}

			// Landing verification: the log-verified commit; a hook that mutated the
			// index mid-commit lands a diverged tree — state it, keep the row.
			const shaRun = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
			const treeRun = await exec("git", ["rev-parse", "HEAD^{tree}"], { cwd: root });
			const landingTree = treeRun.stdout.trim();
			if (landingTree !== "" && landingTree !== treeHash) {
				return {
					content: [
						{
							type: "text",
							text:
								`commit landed, bind diverged — a hook mutated the index mid-commit (bound ${treeHash.slice(0, 12)}, landed ${landingTree.slice(0, 12)}). ` +
								"Re-review the landed diff and re-bind; amend is destructive-tier and needs the dialog. The bind row is NOT spent; no log-verified commit is recorded.",
						},
					],
					isError: true,
					details: { bindSource, approvalSource, hookOutput, diverged: true },
				};
			}
			const sha = shaRun.stdout.trim();
			const logRun = await exec("git", ["log", "-1", "--format=%H %s"], { cwd: root });
			if (!logRun.stdout.trim().startsWith(sha)) {
				throw new Error(`log verification failed — HEAD ${sha} does not match git log output:\n${logRun.stdout.trim()}`);
			}
			if (bind !== undefined) {
				const self = selfOf(sid);
				if (!spendBind(root, self, "tree", treeHash)) throw new Error(`commit landed (${sha}) but the binds lock is held — the row stays unspent; retry git_commit's spend by re-running after the lock clears or re-bind and note the double-bind.`);
			}
			setStatusPart("gate", `committed ${sha.slice(0, 8)} (${approvalSource})`);
			return ok(
				[
					`commit ${sha} (verified in the log)`,
					`approval: ${approvalSource}`,
					`bind: ${bindSource} — row spent`,
					`hooks: ${hookOutput === "" ? "(no output)" : hookOutput}`,
					`diff stat:\n${stat.stdout.trim()}`,
					`message:\n${message}`,
				].join("\n\n"),
			);
		},
	});
	pi.registerTool(gitCommitTool);
}

// --- helpers ------------------------------------------------------------------------------

function commitMessage(params: { subject: string; body?: string; trailers?: string[] }, identity: ReturnType<typeof identityFrom>): string {
	const parts = [params.subject.trim()];
	const body = params.body?.trim();
	const trailers = [...trailerLines(identity), ...(params.trailers ?? []).map((t) => t.trim()).filter((t) => t !== "")];
	if (body !== undefined && body !== "" || trailers.length > 0) parts.push("");
	if (body !== undefined && body !== "") parts.push(body);
	if (trailers.length > 0) parts.push(trailers.join("\n"));
	return parts.join("\n");
}

function commandWords(command: string): string[] {
	return command.trim().split(/\s+/);
}

function pushArgsOf(words: string[]): string[] {
	const i = words.findIndex((w) => w === "push");
	if (i < 0) return [];
	return words.slice(i + 1).filter((w) => w !== "&&" && w !== "||" && w !== ";" && w !== "|");
}

/** The standingAllows shape key for a classified shape, when one exists. */
function standingShape(c: Classification): AskShape | undefined {
	const map: Record<string, AskShape> = {
		"git push": "git push",
		"gh pr create": "gh pr create",
		"gh pr edit": "gh pr edit",
		"gh comment": "gh comment",
		"gh api": "gh api",
	};
	return map[c.shape];
}

/** The session-approval action a shape maps to, when it is coverable. */
function approvalActionOf(shape: string): ApprovalAction | undefined {
	const map: Record<string, ApprovalAction> = { "git push": "push", "gh pr create": "pr_create", "gh pr edit": "pr_edit" };
	return map[shape];
}
