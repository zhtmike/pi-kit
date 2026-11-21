/**
 * pi-kit checkout-claim — one live session per git work tree (listed FIRST in
 * the manifest: the claim block short-circuits before any ask dialog). The
 * floor gates tracked edit/write outside `.pi/**` (resolved through symlinks)
 * plus `.pi/OWNER.json`/`.pi/REVIEW_BINDS.json`, and create-or-blocks the
 * claim for ask-tier/destructive/`git add` bash shapes. The `checkout` tool
 * is the constructive path; no `release` action — the stamp is not a chore
 * the model performs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { defineTool, isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.ts";
import { classifyCommand } from "../src/classify.ts";
import { ensureClaimAt, selfOf } from "../src/claimrun.ts";
import { readStamp, stampPath, unlinkIfOurs } from "../src/stamp.ts";
import { gitRootOf, isTracked, piDirIgnored, type ExecFn } from "../src/githelp.ts";
import { setStatusPart } from "../src/status.ts";
import { fenceOff, ok, stringEnum } from "./shared.ts";

export default function (pi: ExtensionAPI) {
	let cfgErr: string | null = null;
	try {
		loadConfig();
	} catch (e) {
		cfgErr = (e as Error).message;
	}
	if (cfgErr !== null) return fenceOff(pi, cfgErr);
	let currentSid = ""; // for best-effort quit hygiene outside event contexts

	const exec: ExecFn = (cmd, args, opts = {}) => pi.exec(cmd, args, opts);
	let root: string | null = null; // this process's tree, resolved lazily

	const treeOf = async (dir: string): Promise<string | null> => {
		if (root !== null && path.resolve(dir) === process.cwd()) return root;
		const r = await gitRootOf(exec, dir);
		if (r !== null && path.resolve(dir) === process.cwd()) root = r;
		return r;
	};

	// --- the floor -------------------------------------------------------------------------

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
			if (relPath === ".pi/OWNER.json") {
				return { block: true, reason: "`.pi/OWNER.json` is the checkout-claim stamp — tool-written only. Use checkout action 'status' to inspect it; the rows replace dead owners automatically." };
			}
			if (relPath === ".pi/REVIEW_BINDS.json") {
				return { block: true, reason: "`.pi/REVIEW_BINDS.json` is review_bind's record — tool-written only. Use review_bind (kind tree/post) to record, git_commit to spend." };
			}
			if (relPath === ".pi" || relPath.startsWith(".pi/")) return; // every other .pi/** path passes
			if (!(await isTracked(exec, treeRoot, relPath))) return; // untracked writes are not seen
			const sid = ctx.sessionManager.getSessionId() ?? "";
			const r = await ensureClaimAt(exec, dir, sid);
			if (!r.ok) setStatusPart("claim", `checkout blocked: ${summarize(r.reason ?? "")}`);
			else setStatusPart("claim", `checkout ours (${sid.slice(0, 8)})`);
			return r.ok ? undefined : { block: true, reason: r.reason };
		}

		if (isToolCallEventType("bash", event)) {
			const c = classifyCommand(event.input.command);
			// Ask-tier/destructive shapes and `git add` (allow-tier but index-mutating)
			// create-or-block the claim; read-only allows, refuse shapes, and the
			// self-match guard pass to the git-api floor.
			if (c.tier === "ask" || c.tier === "destructive" || c.shape === "git add") {
				const dir = c.targetDir !== undefined ? path.resolve(c.targetDir) : ctx.cwd ?? process.cwd();
				const sid = ctx.sessionManager.getSessionId() ?? "";
				// A classified git command's claim target is strict: unresolved blocks.
				const r = await ensureClaimAt(exec, dir, sid, { strict: true });
				if (!r.ok) setStatusPart("claim", `checkout blocked: ${summarize(r.reason ?? "")}`);
				return r.ok ? undefined : { block: true, reason: `claim check failed first — ${r.reason}` };
			}
			return;
		}
	});

	// --- the tool --------------------------------------------------------------------------

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
			if (treeRoot === null) throw new Error(`not inside a git work tree (from ${startDir}) — the claim applies only to git trees`);
			if (params.action === "clean") {
				if (sid === "") throw new Error("clean refuses an empty session id — it deletes exactly .pi/work/s/<own sid>/, and nothing else is reachable");
				if (!/^[A-Za-z0-9._-]+$/.test(sid)) throw new Error(`clean refuses session id '${sid}' — it must be a plain slug; the boundary is .pi/work/s/<own sid>/`);
				const dir = path.join(treeRoot, ".pi", "work", "s", sid);
				fs.rmSync(dir, { recursive: true, force: true });
				return ok(`deleted ${dir} (this session's scratch; siblings untouched)`);
			}
			if (params.action === "worktree") {
				if (sid === "") throw new Error("worktree refuses an empty session id — nothing to key the worktree path on; the block stands");
				if (!(await piDirIgnored(exec, treeRoot))) {
					throw new Error(`.pi/ is not gitignored in ${treeRoot} — worktrees live under .pi/worktrees; add a '.pi/' line to .gitignore. pi-kit never edits ignore files.`);
				}
				// Unborn HEAD: name the precondition, not the git fatal.
				const head = await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: treeRoot });
				if (head.code !== 0) {
					throw new Error(`the branch has no commits yet — a detached worktree needs HEAD to exist. Land the first commit (git_commit), then re-call worktree.`);
				}
				const wt = path.join(treeRoot, ".pi", "worktrees", sid);
				if (fs.existsSync(wt)) return ok(`worktree exists: ${wt} (returned as-is)`);
				const r = await pi.exec("git", ["worktree", "add", "--detach", wt, "HEAD"], { cwd: treeRoot, timeout: 30_000 });
				if (r.code !== 0) throw new Error(`git worktree add failed at ${treeRoot}: ${r.stderr.trim()} — the main checkout is unchanged; resolve the git state or work elsewhere.`);
				return ok(`worktree created (detached at HEAD): ${wt}\nThe main checkout's claim is unchanged. A session working in that directory is a different git dir and takes its own stamp.`);
			}
			if (params.action === "status") {
				const self = selfOf(sid);
				const stamp = readStamp(treeRoot);
				if (stamp === null) return ok(`no claim stamp at ${stampPath(treeRoot)} — the tree is free (the next gated op creates it); this session is ${sid}`);
				if (stamp === "malformed") return ok(`claim stamp at ${stampPath(treeRoot)} is malformed/incomplete — retained, not replaced; this session is ${sid}`);
				const rel = stamp.host !== self.host ? "foreign host (retained — its liveness cannot be probed from here)" : stamp.sid === sid ? "ours (this session holds it)" : stamp.sid === "" ? "sidless" : "another session's";
				return ok(`claim stamp: ${JSON.stringify(stamp)}\nrelation: ${rel}; this session: ${sid}, this process: {pid ${self.pid}, host '${self.host}'}\nUse action 'claim' to apply the rows (replaces only a dead owner).`);
			}
			// claim
			const r = await ensureClaimAt(exec, startDir, sid);
			if (!r.ok) throw new Error(r.reason);
			return ok(`claim holds (row ${r.row}): session ${sid} at ${treeRoot}`);
		},
	});
	pi.registerTool(checkoutTool);

	// --- quit hygiene ----------------------------------------------------------------------

	pi.on("session_start", (_event, ctx) => {
		currentSid = ctx.sessionManager.getSessionId() ?? "";
		if (root === null) treeOf(process.cwd()).catch(() => {});
		setStatusPart("claim", `checkout: ${currentSid === "" ? "?" : currentSid.slice(0, 8)} (stamp on next gated op)`);
	});
	pi.on("session_shutdown", (event) => {
		// Only quit unlinks — reload/new/resume/fork keep the tree the returning process occupies.
		if (event.reason !== "quit") return;
		unlinkIfOurs(root ?? process.cwd(), currentSid);
		setStatusPart("claim", undefined);
	});
	process.on("exit", () => {
		try {
			unlinkIfOurs(root ?? process.cwd(), currentSid);
		} catch {
			/* best-effort */
		}
	});
}

function summarize(reason: string): string {
	return reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
}
