/**
 * Review-surface envelopes — the universal shapes review_text emits and
 * pr_draft enforces (disclosure presence, template coverage). Verdict
 * vocabulary is fixed: `addressed` / `skipped`; every other token stays prose.
 * Pure: no host imports.
 */

import { ASSISTANCE_HEADING_RE, assistanceSection, replyMarker, summaryFooter, type Identity } from "./identity.ts";

// --- review_text -------------------------------------------------------------------------

export interface CommentInput {
	file: string;
	line: number;
	ask: string;
	fact?: string;
}

export interface ReplyInput {
	verdict: "addressed" | "skipped";
	/** The finding, request, or comment replied to, quoted or restated. */
	answers: string;
	/** The commit that addressed it — required when verdict is `addressed`. */
	commit?: string;
	verification?: string;
	/** Why it was skipped — required when verdict is `skipped`. */
	reason?: string;
}

export function commentText(c: CommentInput): string {
	if (c.line < 1) throw new Error(`comment line must be a positive line number, got ${c.line}`);
	const anchor = `${c.file}:${c.line}`;
	return c.fact !== undefined && c.fact !== "" ? `${anchor}: ${c.ask} — ${c.fact}` : `${anchor}: ${c.ask}`;
}

export function replyText(r: ReplyInput, id: Identity): string {
	if (r.verdict === "addressed") {
		if (r.commit === undefined || r.commit === "") {
			throw new Error("an `addressed` reply names the commit that did it — pass `commit` (full or short sha)");
		}
	} else if (r.reason === undefined || r.reason === "") {
		throw new Error("a `skipped` reply names its reasoning — pass `reason`");
	}
	const opener = r.verdict === "addressed" ? `Addressed in \`${r.commit}\`:` : "Skipped, with reasoning:";
	const lines = [opener];
	// The answered finding rides as a markdown blockquote — GitHub-native quoting
	// that survives collapsed threads and notifications.
	if (r.answers.trim() !== "") lines.push(...r.answers.trim().split("\n").map((l) => `> ${l}`.trimEnd()));
	if (r.verification !== undefined && r.verification.trim() !== "") lines.push(`- Verification: ${r.verification.trim()}`);
	if (r.verdict === "skipped" && r.reason !== undefined) lines.push(`- Reason: ${r.reason.trim()}`);
	const marker = replyMarker(id);
	// a marked quote never gains a second marker
	if (lines.some((l) => l.includes(marker))) return lines.join("\n");
	lines.push("", marker);
	return lines.join("\n");
}

export function summaryText(text: string, id: Identity): string {
	if (text.trim() === "") throw new Error("summary text is empty — compose the review body first");
	const footer = summaryFooter(id);
	if (text.includes(footer)) return text;
	return `${text.replace(/\s+$/, "")}\n\n${footer}`;
}

// --- pr_draft ---------------------------------------------------------------------------

export interface DraftCheck {
	/** The final body (disclosure appended when it was absent). */
	body: string;
	/** Template headings the body was missing (non-empty only with `templateError`). */
	templateMissing: string[];
}

/** Markdown headings a PR template pins (## Section / # Section lines). */
export function templateHeadings(template: string): string[] {
	return template
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => /^#{1,3}\s+\S/.test(l) && !/^#{1,3}\s*AI[- ]assistance\b/i.test(l));
}

export function checkDraft(body: string, assistance: string | undefined, template: string | undefined, id: Identity): DraftCheck {
	let out = body.replace(/\s+$/, "");
	if (template !== undefined && template.trim() !== "") {
		const bodyLines = new Set(out.split("\n").map((l) => l.trim()));
		const missing = templateHeadings(template).filter((h) => !bodyLines.has(h));
		if (missing.length > 0) {
			return { body: out, templateMissing: missing };
		}
	}
	if (!ASSISTANCE_HEADING_RE.test(out)) {
		if (assistance === undefined || assistance.trim() === "") {
			throw new Error(
				"the PR body carries no AI-assistance section — pass `assistance` (what the agent did, what the human reviewed and stands behind) and the tool appends the section, or end the body with your own '## AI assistance' section",
			);
		}
		out = `${out}\n\n${assistanceSection(id, assistance)}`;
	}
	return { body: out, templateMissing: [] };
}

// --- remote URLs ------------------------------------------------------------------------

export interface RemoteIdent {
	host: string;
	owner: string;
	name: string;
}

/** Local parse of a git remote URL; unresolvable (SSH alias, non-GitHub host) → undefined. */
export function parseRemoteUrl(url: string): RemoteIdent | undefined {
	const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
	if (https) return { host: https[1].toLowerCase(), owner: https[2], name: https[3] };
	const scp = url.match(/^git@([^:]+):([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
	if (scp) return { host: scp[1].toLowerCase(), owner: scp[2], name: scp[3] };
	const ssh = url.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
	if (ssh) return { host: ssh[1].toLowerCase(), owner: ssh[2], name: ssh[3] };
	return undefined;
}

/** Only GitHub hosts carry the compare URL and owner semantics pi-kit checks. */
export function isGithubHost(host: string): boolean {
	return host === "github.com" || host.endsWith(".github.com");
}
