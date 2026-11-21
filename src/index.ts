/**
 * pi-kit — personal hard-boundary tools for the pi coding agent (README.md).
 * One glue entry over pure src/ modules: the checkout claim (one live session
 * per git work tree), the git/gh approval floor (tier table in classify.ts),
 * and the review-surface scaffolds (envelopes.ts). The claim floor registers
 * FIRST — its block short-circuits before any ask dialog. Human-facing text
 * lives in format.ts; schema descriptions stay lean (purpose, skeleton,
 * non-inferable semantics, warnings) — mechanics ride runtime refusals and
 * the `[next: …]` result hints.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { defineTool, getMarkdownTheme, isToolCallEventType, type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { loadConfig, standingCovers, type PiKitConfig } from "./config.ts";
import { classifyCommand } from "./classify.ts";
import { ALL_ACTIONS, actionOfShape, foldEntry, isApprovalAction, type ApprovalAction } from "./approvals.ts";
import { commitMessage, identityFrom } from "./identity.ts";
import { findBind, recordBinds, sha256File, spendBind } from "./binds.ts";
import { ensureClaimAt, selfOf } from "./claimrun.ts";
import {
	defaultBase,
	gitRootOf,
	headBranch,
	isTracked,
	logRange,
	piDirIgnored,
	pushRemoteUrl,
	repoIdentity,
	resolvePushTarget,
	writeTree,
	type ExecFn,
} from "./githelp.ts";
import { checkDraft, commentText, isGithubHost, parseRemoteUrl, readTemplate, replyText, summaryText } from "./envelopes.ts";
import { setStatusPart, bindStatusSink } from "./status.ts";
import { readStamp, stampPath, unlinkIfOurs } from "./stamp.ts";
import { expandShellPath, slugify, UNEXPANDED_RE } from "./util.ts";
import * as F from "./format.ts";

const APPROVAL_ENTRY = "pi-kit-approvals";

/**
 * `Type.Unsafe` keeps the literal-union typing that `defineTool`'s TypeBox inference reads;
 * the emitted `{ type: "string", enum: [...] }` matches pi-ai's `StringEnum`.
 */
function stringEnum<T extends readonly string[]>(values: T, options?: { description?: string }) {
	return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...(options?.description ? { description: options.description } : {}) });
}

function ok(text: string, details: any = {}): AgentToolResult {
	return { content: [{ type: "text", text }], details };
}

/**
 * The init fence: block everything gated naming the error, then
 * abort — ctx.shutdown() in TUI/RPC (deferred until idle; the handler is the
 * fence meanwhile), process.exit(1) in print/JSON (the runner's default
 * shutdown handler is empty; buffered stdout may be lost — accepted).
 */
function fenceOff(pi: ExtensionAPI, msg: string): void {
	pi.on("tool_call", async () => ({
		block: true,
		reason: `pi-kit is not running — invalid config: ${msg}. Fix the file and restart; every gated operation blocks until then.`,
	}));
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.shutdown();
		else process.exit(1);
	});
}

export default function (pi: ExtensionAPI) {
	let cfg: PiKitConfig;
	try {
		cfg = loadConfig();
	} catch (e) {
		return fenceOff(pi, (e as Error).message);
	}
	let currentSid = ""; // for best-effort quit hygiene outside event contexts

	const exec: ExecFn = (cmd, args, opts = {}) => pi.exec(cmd, args, opts);
	/** Expand a claim target as the shell would; null marks unexpanded residue (block loudly). */
	const resolveTarget = (raw: string): string | null => {
		const ex = expandShellPath(raw, homedir(), process.env);
		return UNEXPANDED_RE.test(ex) ? null : path.resolve(ex);
	};
	let root: string | null = null; // this process's tree, resolved lazily

	const treeOf = async (dir: string): Promise<string | null> => {
		if (root !== null && path.resolve(dir) === process.cwd()) return root;
		const r = await gitRootOf(exec, dir);
		if (r !== null && path.resolve(dir) === process.cwd()) root = r;
		return r;
	};

	// --- session approvals ------------------------------------------------------------

	let grants = new Set<ApprovalAction>();
	const allowedVia = new Map<string, string>(); // toolCallId → approval source (result annotation)

	/** Lanes carry the dispatch child marker; nothing else gets recorded-from. */
	const childMarker = (): boolean => process.env.PI_MINIMAL_DISPATCH_CHILD === "1";

	/** Record a grant entry; the failure message returns for the caller to fail loud at the point of failure. */
	function recordEntry(data: { granted?: ApprovalAction[]; cleared?: boolean; source?: string }): string | undefined {
		try {
			pi.appendEntry(APPROVAL_ENTRY, data);
			return undefined;
		} catch (e) {
			return (e as Error).message;
		}
	}

	function approvalFooter(): void {
		setStatusPart("gate", grants.size > 0 ? F.gateApprovedLabel([...grants]) : undefined);
	}

	// Recognition is the session agent's judgment — the `approve` tool records
	// what it judged granted (TUI-channel only); no phrase matcher runs on input.

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
		if (root === null) treeOf(process.cwd()).catch(() => {});
		approvalFooter();
	});

	pi.on("session_shutdown", (event) => {
		// Only quit unlinks — reload/new/resume/fork keep the tree the returning process occupies.
		if (event.reason !== "quit") return;
		recordEntry({ cleared: true });
		unlinkIfOursNow();
	});
	process.on("exit", () => {
		try {
			unlinkIfOursNow();
		} catch {
			/* best-effort */
		}
	});

	function unlinkIfOursNow(): void {
		unlinkIfOurs(root ?? process.cwd(), currentSid);
	}

	// --- the claim floor (registered FIRST — its block short-circuits before any ask dialog) ---

	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
			// Resolve through symlinks — the whole target, final component included:
			// an edit under a symlinked install lands in the source repo's tree.
			const raw = path.resolve(event.input.path);
			let target = raw;
			let dir = path.dirname(raw);
			try {
				target = fs.realpathSync(raw);
				dir = path.dirname(target);
			} catch {
				try {
					dir = fs.realpathSync(dir);
					target = path.join(dir, path.basename(raw)); // new file: rejoin under the resolved dir
				} catch {
					return; // unreadable path — not ours to gate
				}
			}
			const treeRoot = await treeOf(dir);
			if (treeRoot === null) return; // non-git trees are ungated
			const rel = path.relative(treeRoot, target);
			const relPath = rel.split(path.sep).join("/");
			if (relPath === ".pi/OWNER.json") return { block: true, reason: F.ownerStampReason() };
			if (relPath === ".pi/REVIEW_BINDS.json") return { block: true, reason: F.bindsFileReason() };
			if (relPath === ".pi" || relPath.startsWith(".pi/")) return; // every other .pi/** path passes
			if (!(await isTracked(exec, treeRoot, relPath))) return; // untracked writes are not seen
			const sid = ctx.sessionManager.getSessionId() ?? "";
			const r = await ensureClaimAt(exec, dir, sid);
			return r.ok ? undefined : { block: true, reason: r.reason };
		}

		if (isToolCallEventType("bash", event)) {
			const c = classifyCommand(event.input.command);
			// Gated rows (ask/destructive) create-or-block the claim before any dialog;
			// allow-tier and refuse shapes pass to the git/gh floor (or run ungated).
			if (c.tier === "ask" || c.tier === "destructive") {
				const dir = c.targetDir === undefined ? ctx.cwd ?? process.cwd() : resolveTarget(c.targetDir);
				if (dir === null) return { block: true, reason: F.unexpandedTargetReason(c.targetDir!) };
				const sid = ctx.sessionManager.getSessionId() ?? "";
				// A classified git command's claim target is strict: unresolved blocks.
				const r = await ensureClaimAt(exec, dir, sid, { strict: true });
				return r.ok ? undefined : { block: true, reason: `claim check failed first — ${r.reason}` };
			}
			return;
		}
	});

	// --- the git/gh floor -------------------------------------------------------------------

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const c = classifyCommand(event.input.command);
		if (c.tier === "allow") return;
		if (c.tier === "selfmatch" || c.tier === "refuse") return { block: true, reason: c.reason };

		const dir = c.targetDir === undefined ? ctx.cwd ?? process.cwd() : resolveTarget(c.targetDir);
		if (dir === null) return { block: true, reason: F.unexpandedTargetReason(c.targetDir!) };

		if (c.tier === "ask") {
			// gh posts bind first: --body-file must point at a bound file.
			if (c.bodyFile !== undefined) {
				if (UNEXPANDED_RE.test(expandShellPath(c.bodyFile, homedir(), process.env))) {
					return { block: true, reason: `--body-file '${c.bodyFile}' did not fully expand (unset variable or unsupported form) — name the file absolutely` };
				}
				if (!(await checkPostBind(dir, c.bodyFile))) return { block: true, reason: F.postBindRefusal(c.bodyFile) };
			}
			// push resolves an owner; non-owner and unparseable targets refuse without a dialog.
			if (c.shape === "git push") {
				const t = await resolvePushTarget(exec, dir, c.pushArgs ?? []);
				if (t.status === "error" || t.status === "unparseable") return { block: true, reason: `git push refused — ${t.note}` };
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
			const action = actionOfShape(c.shape);
			if (action !== undefined && standingCovers(cfg, repoIdent, action)) {
				allowedVia.set(event.toolCallId, `standing allow (${action})`);
				return;
			}
			if (action !== undefined && grants.has(action)) {
				allowedVia.set(event.toolCallId, "session approval");
				return;
			}
			if (ctx.hasUI) {
				const options = action !== undefined ? [...F.DIALOG_CHOICES_SESSION] : [...F.DIALOG_CHOICES_ONCE_REFUSE];
				const choice = await ctx.ui.select([F.askDialogTitle(), F.previewCommand(event.input.command), ...(c.reason ?? "").split("\n")].filter((l) => l !== "").join("\n"), options);
				if (choice === undefined || choice === "Refuse") return { block: true, reason: F.dialogRefusedReason(event.input.command) };
				let via = "dialog (approve once)";
				if (action !== undefined && choice === "Approve for this session") {
					const fail = recordEntry({ granted: [action], source: "dialog" });
					if (fail === undefined) {
						grants.add(action);
						approvalFooter();
						via = "dialog (approved for this session)";
					} else {
						// The click covers this op only — the session record did not persist.
						via = `dialog (approve once — ${F.approvalRecordFailedReason(fail)})`;
					}
				}
				allowedVia.set(event.toolCallId, via);
				return;
			}
			const suggestion = action !== undefined ? ` Standing allow for this shape: { "repo": ${repoIdent ?? "*"}, "shapes": ["${action}"] } in pi-kit.json standingAllows.` : "";
			return { block: true, reason: F.uncoveredReason(event.input.command, suggestion) };
		}

		// destructive — a session destructive grant (the coarse YOLO switch) covers every destructive shape
		if (grants.has("destructive")) {
			allowedVia.set(event.toolCallId, "session approval (destructive)");
			return;
		}
		if (ctx.hasUI) {
			const choice = await ctx.ui.select(F.destructiveDialogBody(event.input.command), [...F.DIALOG_CHOICES_DESTRUCTIVE]);
			if (choice !== "Approve once" && choice !== "Approve until the session ends") {
				return { block: true, reason: F.dialogRefusedReason(event.input.command) };
			}
			let via = "dialog (approve once)";
			if (choice === "Approve until the session ends") {
				const fail = recordEntry({ granted: ["destructive"], source: "dialog" });
				if (fail === undefined) {
					grants.add("destructive");
					approvalFooter();
					via = "dialog (approved destructive until the session ends)";
				} else {
					// The click covers this op only — the session record did not persist.
					via = `dialog (approve once — ${F.approvalRecordFailedReason(fail)})`;
				}
			}
			allowedVia.set(event.toolCallId, via);
			return;
		}
		return { block: true, reason: F.destructiveUncoveredReason(c.shape, c.reason) };
	});

	async function checkPostBind(dir: string, file: string): Promise<boolean> {
		const rootDir = await gitRootOf(exec, dir);
		if (rootDir === null) return false;
		try {
			const hash = sha256File(path.resolve(dir, expandShellPath(file, homedir(), process.env)));
			return findBind(rootDir, "post", hash, "") !== undefined;
		} catch {
			return false;
		}
	}

	pi.on("tool_result", async (event) => {
		const source = allowedVia.get(event.toolCallId);
		if (source === undefined) return;
		allowedVia.delete(event.toolCallId);
		return { content: [...event.content, { type: "text" as const, text: F.allowedViaNote(source) }] };
	});

	// --- checkout --------------------------------------------------------------------------

	const checkoutTool = defineTool({
		name: "checkout",
		label: "Checkout claim",
		description:
			"One live session per git work tree — concurrent sessions share the checkout. " +
			"Actions: status (stamp + owner liveness); claim (take the checkout; replaces only a dead owner); " +
			"worktree (the blocked-session escape: returns an existing-or-new detached worktree at <root>/.pi/worktrees/<sid>); " +
			"clean (delete exactly this session's .pi/work/s/<sid>/ scratch). " +
			"Tracked-file edits under a live foreign claim block until you claim the tree or move to a worktree; there is no release action.",
		parameters: Type.Object({
			action: stringEnum(["status", "claim", "worktree", "clean"] as const, { description: "What to do with the checkout claim" }),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const sid = ctx.sessionManager.getSessionId() ?? "";
			const startDir = ctx.cwd ?? process.cwd();
			const treeRoot = await gitRootOf(exec, startDir);
			if (treeRoot === null) throw new Error(`${F.notInGitTreeReason(startDir)} — the claim applies only to git trees`);
			if (params.action === "clean") {
				if (sid === "") throw new Error("clean refuses an empty session id — it deletes exactly .pi/work/s/<own sid>/, and nothing else is reachable");
				if (!/^[A-Za-z0-9._-]+$/.test(sid)) throw new Error(`clean refuses session id '${sid}' — it must be a plain slug; the boundary is .pi/work/s/<own sid>/`);
				const dir = path.join(treeRoot, ".pi", "work", "s", sid);
				fs.rmSync(dir, { recursive: true, force: true });
				return ok(F.checkoutCleanBody(dir));
			}
			if (params.action === "worktree") {
				if (sid === "") throw new Error("worktree refuses an empty session id — nothing to key the worktree path on; the block stands");
				if (!(await piDirIgnored(exec, treeRoot))) {
					throw new Error(F.piNotIgnoredReason(treeRoot, "worktrees live under .pi/worktrees"));
				}
				// Unborn HEAD: name the precondition, not the git fatal.
				const head = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: treeRoot });
				if (head.code !== 0) throw new Error(F.unbornHeadReason("a detached worktree needs HEAD to exist", "worktree"));
				const wt = path.join(treeRoot, ".pi", "worktrees", sid);
				if (fs.existsSync(wt)) return ok(F.checkoutWorktreeExists(wt));
				const r = await pi.exec("git", ["worktree", "add", "--detach", wt, "HEAD"], { cwd: treeRoot, timeout: 30_000 });
				if (r.code !== 0) throw new Error(`git worktree add failed at ${treeRoot}: ${r.stderr.trim()} — the main checkout is unchanged; resolve the git state or work elsewhere.`);
				return ok(F.checkoutWorktreeCreated(wt));
			}
			if (params.action === "status") {
				const self = selfOf(sid);
				const stamp = readStamp(treeRoot);
				if (stamp === null) return ok(`no claim stamp at ${stampPath(treeRoot)} — the tree is free (the next gated op creates it); this session is ${sid}`);
				if (stamp === "malformed") return ok(`claim stamp at ${stampPath(treeRoot)} is malformed/incomplete — retained, not replaced; this session is ${sid}`);
				const rel = stamp.host !== self.host ? "foreign host (retained — its liveness cannot be probed from here)" : stamp.sid === sid ? "ours (this session holds it)" : stamp.sid === "" ? "sidless" : "another session's";
				return ok(F.checkoutStatusBody(stamp, rel, sid, { pid: self.pid, host: self.host }));
			}
			// claim
			const r = await ensureClaimAt(exec, startDir, sid);
			if (!r.ok) throw new Error(r.reason);
			return ok(F.checkoutClaimBody(r.row ?? -1, sid, treeRoot));
		},
	});
	pi.registerTool(checkoutTool);

	// --- approve ---------------------------------------------------------------------------

	const approveTool = defineTool({
		name: "approve",
		label: "Record a session approval",
		description:
			"Record that the user approved the named gated actions for this session — call it when their TUI message grants them (your judgment: a directive or an approval of the session/gate/verbs; hedges, negations, and questions are not approvals). " +
			"Actions: commit, push, pr, comment, tag, release, destructive (the coarse grant covering every destructive shape). " +
			"`source` quotes the user's words — the audit trail. Grants last until quit; refuse-tier shapes are never coverable; destructive is never standing-allowable.",
		parameters: Type.Object({
			actions: Type.Array(stringEnum(ALL_ACTIONS as unknown as readonly string[], { description: "The actions the user approved" })),
			source: Type.String({ description: "Short quote of the user's approving words (recorded in the session entry)" }),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui" || childMarker()) throw new Error(F.approveNotTuiReason());
			if (params.actions.length === 0) throw new Error(`actions is empty — name at least one of: ${ALL_ACTIONS.join(", ")}`);
			const actions: ApprovalAction[] = [];
			for (const a of params.actions) {
				if (!isApprovalAction(a)) throw new Error(`'${a}' is not a coverable action — valid: ${ALL_ACTIONS.join(", ")}`);
				actions.push(a);
			}
			if (params.source.trim() === "") throw new Error("source quotes the user's approving words — an unquoted grant has no audit trail");
			const source = params.source.trim().replace(/^"([\s\S]*)"$/, "$1").slice(0, 120);
			const fail = recordEntry({ granted: actions, source });
			if (fail !== undefined) throw new Error(`${F.approvalRecordFailedReason(fail)} — nothing was recorded or covered; every gated op keeps asking`);
			for (const a of actions) grants.add(a);
			approvalFooter();
			return ok(F.approveBody(actions, source));
		},
	});
	pi.registerTool(approveTool);

	// --- bind ------------------------------------------------------------------------------

	const bindTool = defineTool({
		name: "bind",
		label: "Bind a fresh review",
		description:
			"Record that a fresh review ran — the record commit (kind tree) and gh posts (kind post) spend. " +
			"The caller's session id rides the row; the spender's own sid never counts. Refuses at thinking off/minimal/low — a low-thinking binder reviews nothing.",
		parameters: Type.Object({
			kind: stringEnum(["tree", "post"] as const, { description: "tree: the staged index (git write-tree); post: a to-be-posted text file" }),
			path: Type.Optional(Type.String({ description: "kind post only: the file whose sha256 is bound (the --body-file of the coming gh post)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const level = ctx.thinkingLevel ?? "";
			if (level === "off" || level === "minimal" || level === "low") {
				throw new Error(`bind refuses at thinking '${level}' — a low-thinking binder reviews nothing. Re-dispatch the reviewer lane at high or maximum thinking.`);
			}
			const sid = ctx.sessionManager.getSessionId() ?? "";
			if (sid === "") throw new Error("bind refuses an empty session id — the record must name the reviewing session");
			const treeRoot = await gitRootOf(exec, ctx.cwd ?? process.cwd());
			if (treeRoot === null) throw new Error(F.notInGitTreeReason(ctx.cwd ?? process.cwd()));
			if (!(await piDirIgnored(exec, treeRoot))) {
				throw new Error(F.piNotIgnoredReason(treeRoot, "bind records are never created where 'git status' would show them"));
			}
			let hash: string;
			if (params.kind === "tree") {
				hash = await writeTree(exec, treeRoot);
			} else {
				if (params.path === undefined) throw new Error("kind 'post' requires 'path' — the file the coming gh post reads via --body-file");
				const p = path.resolve(params.path);
				if (!fs.existsSync(p)) throw new Error(`no such file: ${p} — write the post text (review returns it), then bind it`);
				hash = sha256File(p);
			}
			const self = selfOf(sid);
			if (!recordBinds(treeRoot, self, [{ kind: params.kind, hash, sid, at: new Date().toISOString() }])) {
				throw new Error(`could not take the binds lock in ${treeRoot} — a live process holds it; retry shortly.`);
			}
			return ok(F.bindBody(params.kind, hash, sid));
		},
	});
	pi.registerTool(bindTool);

	// --- commit ----------------------------------------------------------------------------

	const commitTool = defineTool({
		name: "commit",
		label: "Commit (gated)",
		description:
			"Commit the staged diff — hooks on, identity trailers injected, the review bind spent, the approval recorded. " +
			"Needs a review bind for the staged tree (a pre-approved commit — standing allow or session grant — waives a missing bind), " +
			"then an approval: standing allow, session approval, or dialog. Stage with git add first.",
		parameters: Type.Object({
			subject: Type.String({ description: "One-line subject (repo convention when one exists)" }),
			body: Type.Optional(Type.String({ description: "Body: root-cause narrative with numbers, not a diff restatement" })),
			trailers: Type.Optional(Type.Array(Type.String(), { description: "Extra trailer lines (a trailer the edited files' own rules require rides along, never dropped)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const sid = ctx.sessionManager.getSessionId() ?? "";
			const startDir = ctx.cwd ?? process.cwd();
			const treeRoot = await gitRootOf(exec, startDir);
			if (treeRoot === null) throw new Error(F.notInGitTreeReason(startDir));
			// The claim floor: a commit writes history in this tree — ensure the claim.
			const claim = await ensureClaimAt(exec, startDir, sid);
			if (!claim.ok) throw new Error(claim.reason);

			// Staged diff + bind.
			const stat = await exec("git", ["diff", "--cached", "--stat"], { cwd: treeRoot });
			if (stat.code !== 0) throw new Error(`git diff --cached failed: ${stat.stderr.trim()}`);
			if (stat.stdout.trim() === "") throw new Error(F.nothingStagedReason());
			const treeHash = await writeTree(exec, treeRoot);
			const identity = identityFrom(cfg.agentName, ctx.model as any);
			const repoIdent = await repoIdentity(exec, treeRoot);
			const commitPreApproved = standingCovers(cfg, repoIdent, "commit") ? "standing allow" : grants.has("commit") ? "session approval" : undefined;
			let bindSource: string;
			const bind = findBind(treeRoot, "tree", treeHash, sid);
			if (bind !== undefined) {
				bindSource = `bind row (session ${bind.sid.slice(0, 8)})`;
			} else if (commitPreApproved !== undefined) {
				// A pre-approval speaks for the commit — the bind is waived (the row still spends when present)
				bindSource = `waived (${commitPreApproved})`;
			} else {
				throw new Error(F.bindUnboundReason());
			}

			// Approval: standing → session → dialog.
			let approvalSource: string;
			if (standingCovers(cfg, repoIdent, "commit")) {
				approvalSource = "standing allow (pi-kit.json)";
			} else if (grants.has("commit")) {
				approvalSource = "session approval";
			} else if (ctx.hasUI) {
				const message = commitMessage(params, identity);
				const choice = await ctx.ui.select([F.commitDialogTitle(), stat.stdout.trim(), "", message].join("\n"), [...F.DIALOG_CHOICES_SESSION]);
				if (choice === undefined || choice === "Refuse") throw new Error("commit refused in dialog");
				approvalSource = "dialog";
				if (choice === "Approve for this session") {
					const fail = recordEntry({ granted: ["commit"], source: "dialog" });
					if (fail === undefined) {
						grants.add("commit");
						approvalFooter();
					} else {
						approvalSource = `dialog — ${F.approvalRecordFailedReason(fail)}; the grant did not persist`;
					}
				}
			} else {
				throw new Error(F.commitUnapprovedHeadlessReason());
			}

			// Commit with hooks on (no --no-verify anywhere).
			const message = commitMessage(params, identity);
			const commitRun = await exec("git", ["commit", "-m", message], { cwd: treeRoot, timeout: 120_000 });
			const hookOutput = `${commitRun.stdout}${commitRun.stderr}`.trim();
			if (commitRun.code !== 0) {
				throw new Error(`git commit exited ${commitRun.code} (hooks on) — the bind row stays unspent:\n${hookOutput}`);
			}

			// Landing verification: the log-verified commit; a hook that mutated the
			// index mid-commit lands a diverged tree — state it, keep the row.
			const shaRun = await exec("git", ["rev-parse", "HEAD"], { cwd: treeRoot });
			if (shaRun.code !== 0) throw new Error(`post-commit verification failed — git rev-parse HEAD: ${shaRun.stderr.trim()}`);
			const treeRun = await exec("git", ["rev-parse", "HEAD^{tree}"], { cwd: treeRoot });
			const landingTree = treeRun.stdout.trim();
			if (landingTree !== "" && landingTree !== treeHash) {
				return {
					content: [{ type: "text", text: F.commitDivergedBody(treeHash, landingTree) }],
					isError: true,
					details: { bindSource, approvalSource, hookOutput, diverged: true },
				};
			}
			const sha = shaRun.stdout.trim();
			const logRun = await exec("git", ["log", "-1", "--format=%H %s"], { cwd: treeRoot });
			if (!logRun.stdout.trim().startsWith(sha)) {
				throw new Error(`log verification failed — HEAD ${sha} does not match git log output:\n${logRun.stdout.trim()}`);
			}
			if (bind !== undefined) {
				const self = selfOf(sid);
				if (!spendBind(treeRoot, self, "tree", treeHash)) {
					throw new Error(`commit landed (${sha}) but the binds lock was held — the row stays unspent and ages out harmlessly (rows are hash-keyed); no re-bind needed.`);
				}
			}
			return ok(F.commitBody(sha, approvalSource, bindSource, bind !== undefined, hookOutput, stat.stdout.trim(), message), { sha, bindSource, approvalSource });
		},
	});
	pi.registerTool(commitTool);

	// --- draft -----------------------------------------------------------------------------

	const draftTool = defineTool({
		name: "draft",
		label: "Draft the PR body",
		description:
			"Write/overwrite pr_<branch-slug>.md in the project root — the paste-ready PR body. " +
			"Compose the body filling the repo's PR template when one exists (any heading level; coverage checked line-exact); an AI-assistance section is appended from `assistance` when neither the body nor the template carries one. " +
			"Returns the body, a locally-derived compare URL, and the landed base..head commits (for body-sync). No posting, no network.",
		parameters: Type.Object({
			body: Type.String({ description: "The PR body you composed (what/why, root cause, tests+results, disclosures)" }),
			assistance: Type.Optional(Type.String({ description: "AI-assistance section content when the body carries none: what the agent did, what the human reviewed and stands behind" })),
			base: Type.Optional(Type.String({ description: "Base branch (default: the remote HEAD branch, else 'main')" })),
			head: Type.Optional(Type.String({ description: "Head branch (default: the current branch)" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const treeRoot = await gitRootOf(exec, ctx.cwd ?? process.cwd());
			if (treeRoot === null) throw new Error(F.notInGitTreeReason(ctx.cwd ?? process.cwd()));
			// Precondition first: an unborn branch has no head and no base..head range —
			// name it, never leak the git fatal.
			const headOk = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: treeRoot });
			if (headOk.code !== 0) {
				throw new Error(F.unbornHeadReason("draft derives the head branch and the landed base..head commits from history", "draft"));
			}
			const head = params.head ?? (await headBranch(exec, treeRoot));
			const base = params.base ?? (await defaultBase(exec, treeRoot));
			const template = readTemplate(treeRoot);
			const identity = identityFrom(cfg.agentName, ctx.model as any);
			const check = checkDraft(params.body, params.assistance, template?.text, identity);
			if (check.templateMissing.length > 0) throw new Error(F.templateMissingReason(template!.path, check.templateMissing));
			// The draft lands first — the deliverable survives a missing compare URL.
			const file = path.join(treeRoot, `pr_${slugify(head)}.md`);
			fs.writeFileSync(file, `${check.body}\n`);
			// Compare URL — local string work from the push remote.
			let url: string;
			try {
				url = await pushRemoteUrl(exec, treeRoot);
			} catch (e) {
				throw new Error(`${(e as Error).message} ${F.draftKeptNote(file)}`);
			}
			const ident = parseRemoteUrl(url);
			if (ident === undefined || !isGithubHost(ident.host)) {
				throw new Error(F.unparseableRemoteReason(url, base, head, file));
			}
			const compare = `https://${ident.host}/${ident.owner}/${ident.name}/compare/${base}...${head}`;
			const commits = await logRange(exec, treeRoot, base, head);
			return ok(F.draftBody(file, compare, base, head, commits, check.body), { body: check.body, path: file, compare, base, head });
		},
	});
	pi.registerTool(draftTool);

	// --- review ----------------------------------------------------------------------------

	const reviewTool = defineTool({
		name: "review",
		label: "Review text",
		description:
			"Return paste-ready review texts in the tool result — one summary call plus one comment call per thread, plus one reply call per answered thread; no posting, no dialog. " +
			"kind comment: one imperative ask with a file:line anchor, at most one fact. " +
			"kind reply: the answered finding opens as a > blockquote, then 'Addressed in <commit>:' or 'Skipped, with reasoning:', answers below. " +
			"kind summary: the review body in blocks (verdict / findings / coverage), closed with the AI-assistance footer. " +
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
	pi.registerTool(reviewTool);
}
