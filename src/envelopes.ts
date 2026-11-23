/**
 * Review-surface envelopes — the universal shapes post emits and draft
 * enforces (disclosure presence, template coverage). Verdict vocabularies
 * are fixed: reply `addressed` / `skipped`, summary `clean` / `minor` /
 * `blocking`; every other token stays prose.
 * Pure: no host imports.
 */

import { ASSISTANCE_HEADING_RE, assistanceSection, replyMarker, summaryFooter, type Identity } from "./identity.ts";
import * as fs from "node:fs";
import * as path from "node:path";

// --- review -------------------------------------------------------------------------

export type SummaryVerdict = "clean" | "minor" | "blocking";

/** Register-free severity glosses — merge directives are the free text's business, never fixed prose. */
export const SUMMARY_VERDICTS: Record<SummaryVerdict, string> = {
	clean: "no findings",
	minor: "no blocking findings; everything below is cleanup-grade",
	blocking: "blocking findings below",
};

export function verdictLine(verdict: SummaryVerdict): string {
	return `**Verdict: ${verdict} — ${SUMMARY_VERDICTS[verdict]}.**`;
}

export interface ReplyInput {
	verdict: "addressed" | "skipped";
	/** The finding, request, or comment replied to — rendered at the top as a > blockquote. */
	quote: string;
	/** The reply's own answer, below the verdict opener. */
	answers?: string;
	/** The commit that addressed it — required when verdict is `addressed`. */
	commit?: string;
	verification?: string;
	/** Why it was skipped — required when verdict is `skipped`. */
	reason?: string;
}

export function commentText(ask: string, fact?: string): string {
	return fact !== undefined && fact.trim() !== "" ? `${ask} — ${fact}` : ask;
}

export function replyText(r: ReplyInput, id: Identity): string {
	if (r.verdict === "addressed") {
		if (r.commit === undefined || r.commit === "") {
			throw new Error("an `addressed` reply names the commit that did it — pass `commit` (full or short sha)");
		}
	} else if (r.reason === undefined || r.reason === "") {
		throw new Error("a `skipped` reply names its reasoning — pass `reason`");
	}
	if (r.quote === undefined || r.quote.trim() === "") {
		throw new Error("a reply opens with what it answers — pass `quote` (the finding, request, or comment, rendered as a > blockquote)");
	}
	// The quoted original opens the reply (GitHub-native > that survives collapsed
	// threads); the verdict and the answers land below it.
	const lines = r.quote.trim().split("\n").map((l) => `> ${l}`.trimEnd());
	lines.push("", r.verdict === "addressed" ? `Addressed in \`${r.commit}\`:` : "Skipped, with reasoning:");
	if (r.answers !== undefined && r.answers.trim() !== "") lines.push(`- Answers: ${r.answers.trim()}`);
	if (r.verification !== undefined && r.verification.trim() !== "") lines.push(`- Verification: ${r.verification.trim()}`);
	if (r.verdict === "skipped" && r.reason !== undefined) lines.push(`- Reason: ${r.reason.trim()}`);
	const marker = replyMarker(id);
	// a text already ENDING in its own marker never gains a second — a marker
	// inside a quoted line is the quoted reply's own, and this reply keeps its
	const body = lines.join("\n");
	if (body.trimEnd().endsWith(marker)) return body;
	lines.push("", marker);
	return lines.join("\n");
}

export function summaryText(verdict: SummaryVerdict, text: string, id: Identity): string {
	if (text.trim() === "") throw new Error("summary text is empty — compose the review body first");
	const footer = summaryFooter(id);
	const body = `${verdictLine(verdict)}\n\n${text.replace(/\s+$/, "")}`;
	if (text.includes(footer)) return body;
	return `${body}\n\n${footer}`;
}

/** A standalone comment/reply body carries its own disclosure — appended when missing, never doubled. */
export function appendMarkerIfMissing(body: string, id: Identity): string {
	if (body.trim() === "") throw new Error("the posted body is empty — compose the text first");
	const trimmed = body.replace(/\s+$/, "");
	const marker = replyMarker(id);
	return trimmed.endsWith(marker) ? trimmed : `${trimmed}\n\n${marker}`;
}

// --- draft --------------------------------------------------------------------------

export interface DraftCheck {
	/** The final body (disclosure appended when it was absent). */
	body: string;
	/** Template headings the body was missing (non-empty only with `templateError`). */
	templateMissing: string[];
	/** `assistance` was passed while the body already carries the section — the caller refuses. */
	assistanceConflict: boolean;
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
	// `assistance` plus a body already carrying the section is a direct
	// contradiction — detected here, refused by the caller.
	const assistanceConflict = assistance !== undefined && assistance.trim() !== "" && ASSISTANCE_HEADING_RE.test(out);
	// A repo template may carry its own AI/assistance section — when it does,
	// the body MUST fill it (that section is the disclosure) and nothing is
	// appended on top; when it does not, the tool appends its own section.
	const templateOwnsDisclosure = template !== undefined && ASSISTANCE_HEADING_RE.test(template);
	if (template !== undefined && template.trim() !== "") {
		const bodyLines = new Set(out.split("\n").map((l) => l.trim()));
		const missing = templateHeadings(template).filter((h) => !bodyLines.has(h));
		if (missing.length > 0) {
			return { body: out, templateMissing: missing, assistanceConflict };
		}
	}
	if (templateOwnsDisclosure) {
		if (!ASSISTANCE_HEADING_RE.test(out)) {
			const heading = (template ?? "").split("\n").find((l) => ASSISTANCE_HEADING_RE.test(l))?.trim() ?? "the template's AI-assistance section";
			throw new Error(`the PR template pins its own disclosure (${heading}) — fill that section in the body; nothing is appended on top of a template that carries one`);
		}
		return { body: out, templateMissing: [], assistanceConflict };
	}
	if (!ASSISTANCE_HEADING_RE.test(out)) {
		if (assistance === undefined || assistance.trim() === "") {
			throw new Error(
				"the PR body carries no AI-assistance section — pass `assistance` (what the agent did, what the human reviewed and stands behind) and the tool appends the section, or end the body with your own '## AI assistance' section",
			);
		}
		out = `${out}\n\n${assistanceSection(id, assistance)}`;
	}
	return { body: out, templateMissing: [], assistanceConflict };
}

// --- PR template discovery (draft) -------------------------------------------------------

/** Single-file PR template candidates, in preference order, either case. */
export const TEMPLATE_CANDIDATES = [
	".github/PULL_REQUEST_TEMPLATE.md",
	".github/pull_request_template.md",
	"PULL_REQUEST_TEMPLATE.md",
	"pull_request_template.md",
	"docs/PULL_REQUEST_TEMPLATE.md",
];
const TEMPLATE_DIRS = [".github/PULL_REQUEST_TEMPLATE", ".github/pull_request_template", "PULL_REQUEST_TEMPLATE"];

/** The repo's PR template: a candidate file, else a template directory's `default.md` or first `.md`. undefined when the repo pins none. */
export function readTemplate(root: string): { path: string; text: string } | undefined {
	for (const rel of TEMPLATE_CANDIDATES) {
		const p = path.join(root, rel);
		if (fs.existsSync(p)) return { path: rel, text: fs.readFileSync(p, "utf8") };
	}
	for (const dir of TEMPLATE_DIRS) {
		const d = path.join(root, dir);
		if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
		const files = fs.readdirSync(d).filter((f) => f.endsWith(".md")).sort();
		const pick = files.includes("default.md") ? "default.md" : files[0];
		if (pick !== undefined) return { path: `${dir}/${pick}`, text: fs.readFileSync(path.join(d, pick), "utf8") };
	}
	return undefined;
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
