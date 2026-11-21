/**
 * Git shells the floors and tools need — thin async wrappers over `pi.exec`
 * (passed in, so this module stays host-free), plus the push-remote/owner
 * resolution. All lookups are local (no network): owner resolution is a URL
 * parse of `git remote get-url --push`.
 */

import * as path from "node:path";
import { parseRemoteUrl, isGithubHost, type RemoteIdent } from "./envelopes.ts";

export type ExecResult = { stdout: string; stderr: string; code: number };
export type ExecFn = (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }) => Promise<ExecResult>;

export async function run(exec: ExecFn, args: string[], opts?: { cwd?: string; timeout?: number }): Promise<ExecResult> {
	const r = await exec("git", args, { timeout: 10_000, ...opts });
	return r;
}

/**
 * Work-tree root of `dir`, or null outside a git work tree. A `--git-dir`-shaped
 * target (its basename is `.git`) resolves from the parent directory — running
 * inside the gitdir itself answers "must be run in a work tree".
 */
export async function gitRootOf(exec: ExecFn, dir: string): Promise<string | null> {
	const r = await run(exec, ["rev-parse", "--show-toplevel"], { cwd: dir });
	if (r.code === 0) return r.stdout.trim();
	const base = path.basename(dir);
	if (base === ".git" || dir.endsWith("/.git")) {
		const parent = path.dirname(dir);
		if (parent !== dir) {
			const r2 = await run(exec, ["rev-parse", "--show-toplevel"], { cwd: parent });
			if (r2.code === 0) return r2.stdout.trim();
		}
	}
	return null;
}

/** Whether `git check-ignore` reports `<root>/.pi` ignored (a pattern match — works on paths that do not exist yet). */
export async function piDirIgnored(exec: ExecFn, root: string): Promise<boolean> {
	const r = await run(exec, ["check-ignore", "-q", ".pi/"], { cwd: root });
	if (r.code === 0) return true;
	if (r.code === 1) return false;
	throw new Error(`git check-ignore failed (exit ${r.code}): ${r.stderr.trim()}`);
}

export async function isTracked(exec: ExecFn, root: string, rel: string): Promise<boolean> {
	const r = await run(exec, ["ls-files", "--error-unmatch", rel], { cwd: root });
	return r.code === 0;
}

export async function writeTree(exec: ExecFn, root: string): Promise<string> {
	const r = await run(exec, ["write-tree"], { cwd: root });
	if (r.code !== 0) throw new Error(`git write-tree failed: ${r.stderr.trim()}`);
	return r.stdout.trim();
}

// --- push target/owner resolution ---------------------------------------------------------

export type PushTarget =
	| { status: "ok"; remote: string; url: string; ident: RemoteIdent; github: boolean }
	| { status: "unparseable"; url: string; note: string }
	| { status: "error"; note: string };

function looksLikeUrl(s: string): boolean {
	return s.includes("://") || /^[^/@\s]+@[^/\s]+:/.test(s) || s.endsWith(".git");
}
function isRefspec(s: string): boolean {
	return s.includes(":") || s.startsWith("+") || s.startsWith("refs/") || s === "HEAD";
}

/**
 * Resolve what a `git push` would touch. The remote is the first non-flag
 * argument (unless it is a URL, parsed itself, or a refspec); a bare push
 * resolves branch.<name>.pushRemote → remote.pushDefault → branch.<name>.remote
 * → origin. Unparseable URLs (SSH alias, non-GitHub host) report as such —
 * the floor refuses them.
 */
export async function resolvePushTarget(exec: ExecFn, dir: string, pushArgs: string[]): Promise<PushTarget> {
	const args = pushArgs.filter((a) => !a.startsWith("-"));
	let remote: string | undefined;
	let url: string | undefined;
	for (const a of args) {
		if (looksLikeUrl(a)) {
			url = a;
			break;
		}
		if (!isRefspec(a)) {
			remote = a;
			break;
		}
	}
	if (url === undefined) {
		const name = remote ?? (await pushDefaultRemote(exec, dir));
		if (name === undefined) return { status: "error", note: "could not resolve a push remote (no branch config, no origin)" };
		const r = await run(exec, ["remote", "get-url", "--push", name], { cwd: dir });
		if (r.code !== 0) {
			const fb = await run(exec, ["remote", "get-url", name], { cwd: dir });
			if (fb.code !== 0) return { status: "error", note: `no remote '${name}': ${r.stderr.trim()}` };
			url = fb.stdout.trim();
		} else url = r.stdout.trim();
	}
	const ident = parseRemoteUrl(url);
	if (ident === undefined || !ident.host.includes(".")) {
		return { status: "unparseable", url, note: `push remote URL '${url}' is not a parseable GitHub remote (SSH alias or unknown host) — unparseable targets are refused; ask the user or fix the remote.` };
	}
	return { status: "ok", remote: remote ?? "origin", url, ident, github: isGithubHost(ident.host) };
}

async function configGet(exec: ExecFn, dir: string, key: string): Promise<string | undefined> {
	const r = await run(exec, ["config", "--get", key], { cwd: dir });
	return r.code === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : undefined;
}

async function pushDefaultRemote(exec: ExecFn, dir: string): Promise<string | undefined> {
	const branchR = await run(exec, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
	const branch = branchR.code === 0 ? branchR.stdout.trim() : undefined;
	if (branch === undefined || branch === "" || branch === "HEAD") return "origin";
	return (
		(await configGet(exec, dir, `branch.${branch}.pushRemote`)) ??
		(await configGet(exec, dir, "remote.pushDefault")) ??
		(await configGet(exec, dir, `branch.${branch}.remote`)) ??
		"origin"
	);
}

/** The repo identity standing allows match against ("owner/name"), or undefined when unresolvable. */
export async function repoIdentity(exec: ExecFn, dir: string): Promise<string | undefined> {
	const t = await resolvePushTarget(exec, dir, []);
	if (t.status === "ok" && t.github) return `${t.ident.owner}/${t.ident.name}`;
	return undefined;
}

// --- draft lookups ------------------------------------------------------------------------

/** The current branch's short name (draft's default head). */
export async function headBranch(exec: ExecFn, root: string): Promise<string> {
	const r = await run(exec, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
	if (r.code !== 0) throw new Error(`git rev-parse --abbrev-ref HEAD failed: ${r.stderr.trim()}`);
	return r.stdout.trim();
}

/** draft's default base: the remote HEAD branch, else `main`. */
export async function defaultBase(exec: ExecFn, root: string): Promise<string> {
	const r = await run(exec, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: root });
	if (r.code === 0) {
		const branch = r.stdout.trim().split("/").slice(1).join("/");
		if (branch !== "") return branch;
	}
	return "main";
}

/** The first push remote URL among origin/upstream (fetch fallback) — the compare URL's source. */
export async function pushRemoteUrl(exec: ExecFn, root: string): Promise<string> {
	for (const remote of ["origin", "upstream"]) {
		const r = await run(exec, ["remote", "get-url", "--push", remote], { cwd: root });
		if (r.code === 0 && r.stdout.trim() !== "") return r.stdout.trim();
		const fb = await run(exec, ["remote", "get-url", remote], { cwd: root });
		if (fb.code === 0 && fb.stdout.trim() !== "") return fb.stdout.trim();
	}
	throw new Error("no 'origin'/'upstream' remote — the compare URL needs one; add a remote and re-run draft");
}

/** `base..head` commits, one `%h %s` line each (draft's landed-commits payload for body-sync). */
export async function logRange(exec: ExecFn, root: string, base: string, head: string): Promise<string> {
	const r = await run(exec, ["log", "--format=%h %s", `${base}..${head}`], { cwd: root });
	if (r.code !== 0) {
		throw new Error(`git log ${base}..${head} failed: ${r.stderr.trim()} — check the branch names (base '${base}' must exist locally; fetch it first if only the remote knows it).`);
	}
	return r.stdout;
}
