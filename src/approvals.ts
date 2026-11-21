/**
 * Session-approval recognition — pure. A qualifying TUI-typed message
 * grants the ask-tier actions it names. Two forms:
 *  (a) a directive — an imperative or permissive-modal gated verb ("push",
 *      "can you commit", "feel free to open a PR"); hedges ("maybe", "should
 *      we", "later" on either side) do not count;
 *  (b) an approval signal (approved / OK'd / confirmed / green-light /
 *      "go ahead" / "ship it" / LGTM) anywhere in the message, in which case
 *      gated verbs named anywhere in the same message count.
 * Guards: a verb or signal governed by not/n't/never/"do not"/"hold off"
 * inside its own clause does not count (negation never crosses a clause
 * boundary); a verb after the/a/an/previous/last/this/that is a noun, not a
 * directive; past-tense narration ("we pushed the hotfix") is not a verb
 * form at all — reports are not directives. The signal list is the operative
 * contract; an unmatched spelling is a visible miss, never a silent grant.
 */

export type ApprovalAction = "commit" | "push" | "pr_create" | "pr_edit";

export interface ApprovalParse {
	/** Actions this message grants (empty = none). */
	grants: ApprovalAction[];
	/** The message carried an approval signal or a gated verb but granted nothing — surface the miss. */
	miss: boolean;
	/** Which signals fired (for the miss footer). */
	signals: string[];
}

const SIGNALS = ["approved", "approve", "ok'd", "ok’d", "confirmed", "green-light", "greenlight", "go ahead", "ship it", "lgtm"];

const NEGATORS = new Set(["not", "never", "no", "dont", "don't", "doesn't", "didn't", "won't", "wouldn't", "cant", "can't", "cannot", "stop", "without", "hold"]);
const NOUN_MARKERS = new Set(["the", "a", "an", "previous", "last", "this", "that", "those", "these", "your", "my", "our"]);
const HEDGES = new Set(["maybe", "perhaps", "later", "eventually", "someday", "yet"]);
/** A modal before the verb, governed by we/I — a suggestion question, not a directive ("should we push"). */
const MODAL_HEDGE = /\b(should|shall)\s+(we|i)\b|\b(we|i)\s+(should|shall)\b/i;

const WORD_VERBS: Array<{ action: ApprovalAction; re: RegExp }> = [
	{ action: "commit", re: /^(commit|commits|committing)[^\w]*$/i },
	{ action: "push", re: /^(push|pushes|pushing)[^\w]*$/i },
];

const PHRASE_VERBS: Array<{ action: ApprovalAction; re: RegExp }> = [
	{ action: "pr_create", re: /\b(?:open|create|push)\s+(?:a\s+|an\s+|the\s+)?pr\b|\bpr\s+create\b|\bopen\s+the\s+pr\b/gi },
	{ action: "pr_edit", re: /\b(?:update|edit)\s+the\s+pr\b|\bpr\s+edit\b|\bupdate\s+the\s+pr['’]s?\s+(?:body|title|description)\b/gi },
];

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Clauses: comma/period/semicolon/dash-delimited — negation never crosses one. */
function splitClauses(text: string): string[] {
	return text.split(/[,.;!?—–]+/).map((c) => c.trim()).filter((c) => c !== "");
}

const wordsOf = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");
const norm = (w: string): string => w.toLowerCase().replace(/[^\w']/g, "");

/** A negator (single word, or the phrase "hold off") governs `upto` words of the clause. */
function clauseNegatedBefore(clauseWords: string[], upto: number): boolean {
	const head = clauseWords.slice(0, upto);
	if (head.some((w) => NEGATORS.has(norm(w)))) return true;
	return /(^|\s)hold\s+off(\s|$)/i.test(head.join(" "));
}

interface VerbHit {
	action: ApprovalAction;
	/** Same-clause context guards. */
	nounBefore: boolean;
	negated: boolean;
	hedged: boolean;
}

function verbHits(text: string): VerbHit[] {
	const hits: VerbHit[] = [];
	const words = wordsOf(text);
	for (const clause of splitClauses(text)) {
		const cw = wordsOf(clause);
		for (let k = 0; k < cw.length; k++) {
			const hit = WORD_VERBS.find(({ re }) => re.test(cw[k]));
			if (hit === undefined) continue;
			const before = cw.slice(Math.max(0, k - 3), k);
			const after = cw.slice(k + 1, k + 3);
			hits.push({
				action: hit.action,
				nounBefore: before.length > 0 && NOUN_MARKERS.has(norm(before[before.length - 1])),
				negated: clauseNegatedBefore(cw, k) || before.slice(-2).some((w) => NEGATORS.has(norm(w))),
				hedged: before.slice(-2).some((w) => HEDGES.has(norm(w))) || after.slice(0, 2).some((w) => HEDGES.has(norm(w))) || MODAL_HEDGE.test(text),
			});
		}
		for (const { action, re } of PHRASE_VERBS) {
			for (const m of clause.matchAll(re)) {
				const idx = wordsOf(clause.slice(0, m.index ?? 0)).length;
				hits.push({
					action,
					nounBefore: false,
					negated: clauseNegatedBefore(cw, idx),
					hedged: MODAL_HEDGE.test(text),
				});
			}
		}
	}
	return hits;
}

/** Signals that fired un-negated (word-boundary match; a negator earlier in the clause rejects). */
function firedSignals(text: string): string[] {
	const out: string[] = [];
	for (const sig of SIGNALS) {
		for (const clause of splitClauses(text)) {
			const re = new RegExp(`(^|[^\\w'’])${escapeRe(sig)}([^\\w'’]|$)`, "i");
			const m = re.exec(clause);
			if (m === null) continue;
			const before = wordsOf(clause.slice(0, m.index + (m[1]?.length ?? 0)));
			if (before.some((w) => NEGATORS.has(norm(w))) || /(^|\s)hold\s+off(\s|$)/i.test(before.join(" "))) continue;
			if (!out.includes(sig)) out.push(sig);
		}
	}
	return out;
}

export function parseApproval(text: string): ApprovalParse {
	const signals = firedSignals(text);
	const hits = verbHits(text);
	const grants = new Set<ApprovalAction>();
	// (a) directive form: imperative verb, un-negated, non-noun, un-hedged.
	for (const h of hits) if (!h.negated && !h.nounBefore && !h.hedged) grants.add(h.action);
	// (b) approval signal: verbs named anywhere count (clause negation and noun
	// guards still apply; a hedge does not survive an explicit signal).
	if (signals.length > 0) for (const h of hits) if (!h.negated && !h.nounBefore) grants.add(h.action);
	const miss = grants.size === 0 && (signals.length > 0 || hits.length > 0 || /\b(commit|push)/i.test(text));
	return { grants: [...grants], miss, signals };
}

/** Fold one recorded entry onto a grant set (replay folds file order; a clear terminates what precedes). */
export type ApprovalEntry = { granted?: ApprovalAction[]; cleared?: boolean };
export function foldEntry(set: Set<ApprovalAction>, e: ApprovalEntry): Set<ApprovalAction> {
	if (e.cleared) return new Set();
	for (const a of e.granted ?? []) set.add(a);
	return set;
}
