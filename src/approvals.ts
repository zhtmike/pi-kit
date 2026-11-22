/**
 * The gate-action vocabulary — one table for every gated surface: approve's
 * params, the session-approval record, the footer display, and standingAllows
 * keys (everything except `destructive`, which is session-grantable only).
 * Recognition is the session agent's judgment, not a hard-coded grammar: when
 * the user's TUI message grants gated actions, the agent calls `approve`,
 * which records the grant with the quoted source (the audit trail) — the
 * floors consult the recorded set, dialogs' "for this session" uses the same
 * record, and replay folds file order with a clear terminating what precedes.
 */

export type ApprovalAction = "commit" | "push" | "pr" | "comment" | "tag" | "release" | "destructive";
/** Every coverable action — approve's vocabulary; the ask-tier actions plus the coarse destructive grant. */
export const ALL_ACTIONS: readonly ApprovalAction[] = ["commit", "push", "pr", "comment", "tag", "release", "destructive"];

export function isApprovalAction(v: string): v is ApprovalAction {
	return (ALL_ACTIONS as readonly string[]).includes(v);
}

/**
 * The session-approval actions a classified command shape can map to. `commit`
 * and `destructive` are absent: bash `git commit` is refuse-tier (the `commit`
 * tool is the route, gated on the `commit` action directly), and destructive
 * shapes take the coarse `destructive` grant, never a per-shape one.
 */
export type ShapeAction = Exclude<ApprovalAction, "commit" | "destructive">;

/**
 * The session-approval action a classified command shape maps to, when it is
 * coverable.
 */
export function actionOfShape(shape: string): ShapeAction | undefined {
	const map: Record<string, ShapeAction> = {
		"git push": "push",
		"gh pr create": "pr",
		"gh pr edit": "pr",
		"gh comment": "comment",
		"git tag": "tag",
		"gh release": "release",
	};
	return map[shape];
}

/** Fold one recorded entry onto a grant set (replay folds file order; a clear terminates what precedes). */
export type ApprovalEntry = { granted?: ApprovalAction[]; cleared?: boolean; source?: string };
export function foldEntry(set: Set<ApprovalAction>, e: ApprovalEntry): Set<ApprovalAction> {
	if (e.cleared) return new Set();
	for (const a of e.granted ?? []) set.add(a);
	return set;
}

/**
 * The coarse all-gates override: a session `destructive` grant covers every shape
 * past ask — destructive and refuse rows alike, non-owner pushes included. Standing
 * allows never reach it (config-time pre-approval tops out at ask).
 */
export function refuseCovered(grants: Set<ApprovalAction>): boolean {
	return grants.has("destructive");
}
