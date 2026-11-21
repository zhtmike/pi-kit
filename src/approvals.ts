/**
 * Session approvals — the record/replay core. Recognition is the session
 * agent's judgment, not a hard-coded grammar: when the user's TUI message
 * grants gated actions, the agent calls the `approve` tool, which records
 * the grant with the quoted source (the audit trail) — the floors consult
 * the recorded set, dialogs' "for this session" uses the same record, and
 * replay folds file order with a clear terminating what precedes it.
 */

export type ApprovalAction = "commit" | "push" | "pr_create" | "pr_edit";
/** Every coverable action — the approve tool's vocabulary. */
export const ALL_ACTIONS: readonly ApprovalAction[] = ["commit", "push", "pr_create", "pr_edit"];

export function isApprovalAction(v: string): v is ApprovalAction {
	return (ALL_ACTIONS as readonly string[]).includes(v);
}

/** Fold one recorded entry onto a grant set (replay folds file order; a clear terminates what precedes). */
export type ApprovalEntry = { granted?: ApprovalAction[]; cleared?: boolean };
export function foldEntry(set: Set<ApprovalAction>, e: ApprovalEntry): Set<ApprovalAction> {
	if (e.cleared) return new Set();
	for (const a of e.granted ?? []) set.add(a);
	return set;
}
