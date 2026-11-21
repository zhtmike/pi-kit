/**
 * Small shared helpers — no host imports (plain-node testable).
 */

/** Branch name → file slug (pr_<branch-slug>.md). */
export function slugify(branch: string): string {
	return (
		branch
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "branch"
	);
}
