/**
 * Agent/model identity and the texts derived from it — trailers, markers,
 * disclosures. Identity comes from the session's active model id plus the
 * configured agent name; an unverifiable segment is dropped, never guessed.
 * Pure: no host imports.
 */

export interface Identity {
	agent: string;
	model?: string;
}

export function identityFrom(cfgAgentName: string, model: { id: string; baseUrl?: string } | undefined): Identity {
	return {
		agent: cfgAgentName,
		model: model?.id !== undefined && model.id !== "" ? model.id : undefined,
	};
}

/** The universal commit trailers; the AI-assistance line drops when the model is unverifiable. */
export function trailerLines(id: Identity): string[] {
	const out: string[] = [];
	if (id.model !== undefined) out.push(`AI-assistance: ${id.agent} (${id.model})`);
	// The co-author domain is the harness project's own (pi.dev) — the old
	// baseUrl-derived domain attributed the disclosure to the model provider.
	out.push(`Co-authored-by: ${id.agent} <noreply@pi.dev>`);
	return out;
}

/** Reply marker — conversation-gate's small-print line, <sub>-wrapped so it renders small on the remote; model parenthetical drops when unverifiable. */
export function replyMarker(id: Identity): string {
	const line = id.model !== undefined ? `AI-assisted reply — ${id.agent} (${id.model})` : `AI-assisted reply — ${id.agent}`;
	return `<sub>${line}</sub>`;
}

/** Review-summary footer; model drops when unverifiable. */
export function summaryFooter(id: Identity): string {
	return id.model !== undefined ? `AI assistance (${id.agent}, ${id.model}) was used for this review.` : `AI assistance (${id.agent}) was used for this review.`;
}

/** The PR-body assistance section the tool appends when the body carries none. */
export function assistanceSection(id: Identity, assistance: string): string {
	const line = id.model !== undefined ? `_${id.agent} (${id.model}) assisted with this work._` : `_${id.agent} assisted with this work._`;
	return `## AI assistance\n\n${assistance.trim()}\n\n${line}`;
}

export const ASSISTANCE_HEADING_SHAPE = String.raw`#{1,3}\s*AI[- ]assistance\b`;

export const ASSISTANCE_HEADING_RE = new RegExp(String.raw`(^|\n)${ASSISTANCE_HEADING_SHAPE}`, "i");

/** A line that IS a disclosure, anchored at line start (an optional list bullet or emphasis wrap before it): the review footer in any wording, the reply marker, or an assistance heading — a finding that merely mentions assistance is none. */
export const DISCLOSURE_LINE_RE = new RegExp(
	String.raw`^(?:[-*]\s*)?(?:[_*]*AI assistance\b.*\bwas used for this review|<sub>AI-assisted reply\b|${ASSISTANCE_HEADING_SHAPE})`,
	"i",
);

/** The 1-based line of the first disclosure line in a caller's text; undefined when none — the tool's disclosure is the only one, so a text carrying its own refuses. */
export function disclosureLine(text: string): number | undefined {
	const i = text.split("\n").findIndex((l) => DISCLOSURE_LINE_RE.test(l.trim()));
	return i === -1 ? undefined : i + 1;
}

/** A commit's full message: subject, blank-separated body, then the trailer block as its own paragraph (identity trailers first, caller trailers after — never dropped). */
export function commitMessage(params: { subject: string; body?: string; trailers?: string[] }, id: Identity): string {
	const parts = [params.subject.trim()];
	const body = params.body?.trim();
	const trailers = [...trailerLines(id), ...(params.trailers ?? []).map((t) => t.trim()).filter((t) => t !== "")];
	if (body !== undefined && body !== "") parts.push("", body);
	if (trailers.length > 0) parts.push("", trailers.join("\n"));
	return parts.join("\n");
}
