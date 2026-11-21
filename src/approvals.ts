/**
 * Session-approval recognition — pure. A qualifying TUI-typed message
 * grants the ask-tier actions it names. Two forms:
 *  (a) a directive — an imperative or permissive-modal gated verb ("push",
 *      "can you commit", "feel free to open a PR"); hedges ("maybe", "should
 *      we", "later") do not count;
 *  (b) an approval signal (approved / OK'd / confirmed / green-light /
 *      "go ahead" / "ship it" / LGTM) anywhere in the message, in which case
 *      gated verbs named anywhere in the same message count.
 * Guards: a verb governed by not/n't/never/"do not" does not count; a verb
 * after the/a/an/previous/last/this/that is a noun, not a directive. The
 * signal list is the operative contract; an unmatched spelling is a visible
 * miss, never a silent grant.
 */

export type ApprovalAction = "commit" | "push" | "pr_create" | "pr_edit";
export const APPROVAL_ACTIONS: ApprovalAction[] = ["commit", "push", "pr_create", "pr_edit"];

export interface ApprovalParse {
	/** Actions this message grants (empty = none). */
	grants: ApprovalAction[];
	/** The message carried an approval signal or a gated verb but granted nothing — surface the miss. */
	miss: boolean;
	/** Which signals fired (for the miss footer). */
	signals: string[];
}

const SIGNALS = ["approved", "approve", "ok'd", "ok’d", "confirmed", "green-light", "greenlight", "go ahead", "ship it", "lgtm"];

const NEGATORS = new Set(["not", "never", "no", "dont", "don't", "doesn't", "didn't", "won't", "wouldn't", "cant", "can't", "stop", "without"]);
const NOUN_MARKERS = new Set(["the", "a", "an", "previous", "last", "this", "that", "those", "these", "your", "my", "our"]);
const HEDGES = new Set(["maybe", "perhaps", "later", "eventually", "someday", "yet"]);
/** A modal before the verb, governed by we/I — a suggestion question, not a directive ("should we push"). */
const MODAL_HEDGE = /\b(should|shall)\s+(we|i)\b|\b(we|i)\s+(should|shall)\b/i;

const WORD_VERBS: Array<{ action: ApprovalAction; re: RegExp }> = [
	{ action: "commit", re: /^(commit|commits|committing|committed)[^\w]*$/i },
	{ action: "push", re: /^(push|pushes|pushing|pushed)[^\w]*$/i },
];

const PHRASE_VERBS: Array<{ action: ApprovalAction; re: RegExp }> = [
	{ action: "pr_create", re: /\b(?:open|create|push)\s+(?:a\s+|an\s+|the\s+)?pr\b|\bpr\s+create\b|\bopen\s+the\s+pr\b/gi },
	{ action: "pr_edit", re: /\b(?:update|edit)\s+the\s+pr\b|\bpr\s+edit\b|\bupdate\s+the\s+pr['’]s?\s+(?:body|title|description)\b/gi },
];

interface VerbHit {
	action: ApprovalAction;
	before: string[];
}

/** All verb occurrences with the up-to-3 preceding words. */
function verbHits(text: string): VerbHit[] {
	const words = text.split(/\s+/);
	const hits: VerbHit[] = [];
	for (let i = 0; i < words.length; i++) {
		for (const { action, re } of WORD_VERBS) {
			if (re.test(words[i])) {
				hits.push({ action, before: words.slice(Math.max(0, i - 3), i) });
				break;
			}
		}
	}
	for (const { action, re } of PHRASE_VERBS) {
		for (const m of text.matchAll(re)) {
			const idx = text.slice(0, m.index ?? 0).trim().split(/\s+/).length;
			hits.push({ action, before: words.slice(Math.max(0, idx - 3), idx) });
		}
	}
	return hits;
}

const NEGATION_ADVERBS = new Set(["ever", "just", "simply", "always", "merely", "even"]);

function negated(before: string[]): boolean {
	// negation governs the verb it precedes, with one adverb allowed to intervene
	// ("don't ever push") — but never across a clause boundary ("Do not push, just
	// commit" keeps `commit` grantable: the comma-delimited word before `just` is
	// not a negator).
	const words = before.slice(-2).map((w) => w.toLowerCase().replace(/[^\w']/g, ""));
	if (words.length === 0) return false;
	if (NEGATORS.has(words[words.length - 1])) return true;
	return words.length === 2 && NEGATION_ADVERBS.has(words[1]) && NEGATORS.has(words[0]);
}
function isNoun(before: string[]): boolean {
	return before.length > 0 && NOUN_MARKERS.has(before[before.length - 1].toLowerCase().replace(/[^\w]/g, ""));
}
function hedged(before: string[], text: string): boolean {
	const window = before.slice(-2).map((w) => w.toLowerCase().replace(/[^\w]/g, ""));
	if (window.some((w) => HEDGES.has(w))) return true;
	return MODAL_HEDGE.test(text);
}

export function parseApproval(text: string): ApprovalParse {
	const lower = text.toLowerCase();
	const signals = SIGNALS.filter((s) => lower.includes(s));
	const hits = verbHits(text);
	const grants = new Set<ApprovalAction>();
	// (a) directive form: imperative verb, un-negated, non-noun, un-hedged.
	for (const h of hits) if (!negated(h.before) && !isNoun(h.before) && !hedged(h.before, text)) grants.add(h.action);
	// (b) approval signal: verbs named anywhere count (guards still apply; a hedge
	// does not survive an explicit signal).
	if (signals.length > 0) for (const h of hits) if (!negated(h.before) && !isNoun(h.before)) grants.add(h.action);
	const miss = grants.size === 0 && (signals.length > 0 || hits.length > 0);
	return { grants: [...grants], miss, signals };
}

/** Fold one recorded entry onto a grant set (replay folds file order; a clear terminates what precedes). */
export type ApprovalEntry = { granted?: ApprovalAction[]; cleared?: boolean };
export function foldEntry(set: Set<ApprovalAction>, e: ApprovalEntry): Set<ApprovalAction> {
	if (e.cleared) return new Set();
	for (const a of e.granted ?? []) set.add(a);
	return set;
}
