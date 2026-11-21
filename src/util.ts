/**
 * Small shared helpers — no host imports (plain-node testable).
 */

import * as path from "node:path";

/** Branch name → file slug (pr_<branch-slug>.md). */
export function slugify(branch: string): string {
	return (
		branch
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "branch"
	);
}

/**
 * Expand a classifier-extracted path the way the shell would have run it:
 * a leading `~`/`~/` against home, `$VAR`/`${VAR}` against env. Unexpandable
 * names (unset vars, `${VAR:-def}`, same-line assignments) stay literal —
 * `UNEXPANDED_RE` marks that residue so consumers block loudly instead of
 * quietly gating the wrong tree.
 */
export function expandShellPath(raw: string, home: string, env: Record<string, string | undefined>): string {
	let out = raw;
	if (out === "~") out = home;
	else if (out.startsWith("~/")) out = path.join(home, out.slice(2));
	return out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced: string | undefined, plain: string | undefined) => {
		const v = env[(braced ?? plain) as string];
		return v !== undefined && v !== "" ? v : whole;
	});
}

/** Residue of an unexpanded shell path — a variable or tilde form stayed literal. */
export const UNEXPANDED_RE = /[$~]/;
