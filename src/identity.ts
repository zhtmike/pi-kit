/**
 * Agent/model identity and the texts derived from it — trailers, markers,
 * disclosures. Identity comes from the session's active model (id, provider,
 * baseUrl) plus the configured agent name; an unverifiable segment is dropped,
 * never guessed. Pure: no host imports.
 */

export interface Identity {
	agent: string;
	model?: string;
	/** Provider domain derived from the model's baseUrl (noreply host for Co-authored-by); absent when unverifiable. */
	domain?: string;
}

/** Derive the provider domain from a baseUrl hostname: strip api./www. prefixes; must contain a dot. */
export function domainOfBaseUrl(baseUrl: string | undefined): string | undefined {
	if (baseUrl === undefined || baseUrl === "") return undefined;
	try {
		const u = new URL(baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`);
		let host = u.hostname.toLowerCase();
		host = host.replace(/^(api|www)\./, "");
		return host.includes(".") ? host : undefined;
	} catch {
		return undefined;
	}
}

export function identityFrom(cfgAgentName: string, model: { id: string; baseUrl?: string } | undefined): Identity {
	return {
		agent: cfgAgentName,
		model: model?.id !== undefined && model.id !== "" ? model.id : undefined,
		domain: domainOfBaseUrl(model?.baseUrl),
	};
}

/** The universal commit trailers; unverifiable segments drop to the bare allowed remainder. */
export function trailerLines(id: Identity): string[] {
	const out: string[] = [];
	if (id.model !== undefined) out.push(`AI-assistance: ${id.agent} (${id.model})`);
	out.push(id.domain !== undefined ? `Co-authored-by: ${id.agent} <noreply@${id.domain}>` : `Co-authored-by: ${id.agent}`);
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

export const ASSISTANCE_HEADING_RE = /(^|\n)#{1,3}\s*AI[- ]assistance\b/i;

/** A commit's full message: subject, blank-separated body, then the trailer block as its own paragraph (identity trailers first, caller trailers after — never dropped). */
export function commitMessage(params: { subject: string; body?: string; trailers?: string[] }, id: Identity): string {
	const parts = [params.subject.trim()];
	const body = params.body?.trim();
	const trailers = [...trailerLines(id), ...(params.trailers ?? []).map((t) => t.trim()).filter((t) => t !== "")];
	if (body !== undefined && body !== "") parts.push("", body);
	if (trailers.length > 0) parts.push("", trailers.join("\n"));
	return parts.join("\n");
}
