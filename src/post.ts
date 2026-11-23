/**
 * The post tool's pure core — parameter validation, the composed review
 * texts, and the REST payload each kind submits. post is the single review
 * surface: it composes (verdict line, reply shape, disclosures) and
 * delivers. The review event is pinned to COMMENT: the tool never approves
 * or rejects a PR (no verdict state, no state verb — those stay
 * refuse-tier in the bash floor, user-only). Pure: no host imports.
 */

import { appendMarker, commentText, replyText, summaryText, templateHeadings, type SummaryVerdict } from "./envelopes.ts";
import { ASSISTANCE_HEADING_RE, disclosureLine, type Identity } from "./identity.ts";

export type PostKind = "review" | "comment" | "reply" | "pr";
export type PostVerdict = "addressed" | "skipped" | SummaryVerdict;
export type CommentSeverity = "blocking" | "minor";

export interface PostComment {
	/** The thread's anchor — a path in the PR diff, as the PR diff shows it; GitHub threads diffed files only, so a finding elsewhere anchors on the nearest diffed line and passes cites. */
	file: string;
	line: number;
	/** The finding's severity — the thread opens with it; never clean (clean means no threads). */
	severity: CommentSeverity;
	/** A short finding id the summary text refers to (C1, R3) — one token, unique across the review. */
	label?: string;
	/** The finding's own location when it is outside the diff (path:line, a file, two places) — rendered before the ask. */
	cites?: string;
	ask: string;
	fact?: string;
}

export interface PostParams {
	kind: PostKind;
	/** Target repo "owner/name" — required when the target is not the session's repo (fork→upstream). */
	repo?: string;
	/** PR number; kind pr: present = edit, absent = create. */
	number?: number;
	/** kind review (clean/minor/blocking) and kind reply (addressed/skipped): the verdict token. */
	verdict?: PostVerdict;
	/** kind review: the body below the verdict line (findings, coverage, accounting). */
	text?: string;
	/** kind review: the inline threads. */
	comments?: PostComment[];
	/** kind comment/pr: the posted body. */
	body?: string;
	/** kind reply: the review-comment id answered. */
	inReplyTo?: number;
	/** kind reply: the finding, request, or comment answered — rendered as a > blockquote. */
	quote?: string;
	/** kind reply: the reply's own answer. */
	answers?: string;
	/** kind reply (addressed): the commit that addressed it. */
	commit?: string;
	/** kind reply: the verification behind the answer. */
	verification?: string;
	/** kind reply (skipped): why it was skipped. */
	reason?: string;
	/** kind pr: the title. */
	title?: string;
	/** kind pr create: base branch. */
	base?: string;
	/** kind pr create: head — "branch", or "owner:branch" for fork PRs. */
	head?: string;
}

export interface PostRequest {
	method: "POST" | "PATCH";
	path: string;
	payload: Record<string, unknown>;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Kind-scope validation errors — requireds, cross-kind params, value forms; each names the param and the kind. The tool owns every disclosure: a review text or comment body carrying its own refuses. Reply's field requireds (commit/reason) fire at compose time in replyText, before the dialog. */
export function validatePost(p: PostParams): string[] {
	const errs: string[] = [];
	const need = (cond: boolean, msg: string): void => {
		if (!cond) errs.push(msg);
	};
	if (p.repo !== undefined) need(REPO_RE.test(p.repo), `repo '${p.repo}' is not 'owner/name' — name the target as owner/name`);
	if (p.kind === "review") {
		need(p.number !== undefined, "kind 'review' requires number (the PR)");
		need(p.verdict !== undefined, "kind 'review' requires verdict — one of: clean, minor, blocking");
		need(p.verdict === undefined || ["clean", "minor", "blocking"].includes(p.verdict), `verdict '${p.verdict}' does not serve kind 'review' — pick clean, minor, or blocking (addressed/skipped serve kind 'reply')`);
		need(p.text !== undefined && p.text.trim() !== "", "kind 'review' requires text (the body below the verdict line — findings, coverage, accounting)");
		if (p.text !== undefined) {
			const line = disclosureLine(p.text);
			if (line !== undefined) errs.push(`kind 'review' text carries its own AI-assistance disclosure at line ${line} — the tool appends the footer; drop the line`);
		}
		need(p.body === undefined, "kind 'review' takes text, not body — text is the review body");
		const comments = p.comments ?? [];
		const firstWithLabel = new Map<string, string>();
		for (const c of comments) {
			const where = `${c.file}:${c.line}`;
			need(c.file !== undefined && c.file.trim() !== "", "every comment requires file (the thread's anchor path)");
			need(Number.isInteger(c.line) && c.line >= 1, `comment on '${where}' requires line >= 1, got '${c.line}'`);
			need(c.ask !== undefined && c.ask.trim() !== "", `comment on '${where}' requires ask`);
			need(c.severity !== undefined, `comment on '${where}' requires severity — blocking or minor`);
			need(c.severity === undefined || ["blocking", "minor"].includes(c.severity), `severity '${c.severity}' on '${where}' does not serve a thread — pick blocking or minor (clean means no threads)`);
			if (c.label !== undefined) {
				const label = c.label.trim();
				need(label !== "", `comment on '${where}' has an empty label — drop the param or pass one token (C1, R3…)`);
				need(!/\s/.test(label), `label '${label}' on '${where}' is not one token — a label is a short id the summary text refers to (C1, R3…)`);
				const first = firstWithLabel.get(label);
				if (first === undefined) firstWithLabel.set(label, where);
				else errs.push(`label '${label}' names two threads ('${first}', '${where}') — each thread gets its own`);
			}
			if (c.cites !== undefined) need(c.cites.trim() !== "", `comment on '${where}' has an empty cites — drop the param or pass a location (path:line, a file)`);
		}
		if (p.verdict === "clean") need(comments.length === 0, "verdict 'clean' means no findings — drop comments or pick minor or blocking");
		if (p.verdict === "minor") {
			for (const c of comments) need(c.severity !== "blocking", `comment on '${c.file}:${c.line}' is blocking under verdict 'minor' — pick verdict blocking or severity minor`);
		}
	} else {
		need(p.text === undefined && p.comments === undefined, "text/comments serve kind 'review' only");
	}
	if (p.kind === "comment") {
		need(p.number !== undefined, "kind 'comment' requires number (the PR or issue)");
		need(p.body !== undefined && p.body.trim() !== "", "kind 'comment' requires body");
		if (p.body !== undefined) {
			const line = disclosureLine(p.body);
			if (line !== undefined) errs.push(`kind 'comment' body carries its own AI-assistance disclosure at line ${line} — the tool appends the marker; drop the line`);
		}
		need(p.verdict === undefined, "kind 'comment' takes no verdict — it is free prose");
	}
	if (p.kind === "reply") {
		need(p.number !== undefined, "kind 'reply' requires number (the PR)");
		need(p.inReplyTo !== undefined, "kind 'reply' requires inReplyTo (the review-comment id — gh api GET …/pulls/<n>/comments lists them)");
		need(p.verdict !== undefined, "kind 'reply' requires verdict — one of: addressed, skipped");
		need(p.verdict === undefined || ["addressed", "skipped"].includes(p.verdict), `verdict '${p.verdict}' does not serve kind 'reply' — pick addressed or skipped (clean/minor/blocking serve kind 'review')`);
		need(p.body === undefined, "kind 'reply' composes its body from quote/answers — pass those, not body");
	}
	need(p.inReplyTo === undefined || p.kind === "reply", "inReplyTo serves kind 'reply' only");
	const replyParams = [p.quote, p.answers, p.commit, p.verification, p.reason];
	if (p.kind !== "reply" && replyParams.some((v) => v !== undefined)) {
		errs.push("quote/answers/commit/verification/reason serve kind 'reply' only");
	}
	need(p.number === undefined || Number.isInteger(p.number), `number '${p.number}' is not an integer — a PR number is`);
	need(p.inReplyTo === undefined || Number.isInteger(p.inReplyTo), `inReplyTo '${p.inReplyTo}' is not an integer — a comment id is`);
	if (p.kind === "pr") {
		need(p.verdict === undefined, "kind 'pr' takes no verdict");
		need(p.title === undefined || p.title.trim() !== "", "kind 'pr' refuses an empty title — pass the title or drop the param");
		need(p.body === undefined || p.body.trim() !== "", "kind 'pr' refuses an empty body — pass the body or drop the param");
		if (p.number === undefined) {
			need(p.title !== undefined && p.title.trim() !== "", "kind 'pr' create requires title");
			need(p.body !== undefined && p.body.trim() !== "", "kind 'pr' create requires body (draft composes and checks it)");
		} else {
			need((p.title !== undefined && p.title.trim() !== "") || (p.body !== undefined && p.body.trim() !== ""), "kind 'pr' edit requires title or body (or both)");
		}
	} else {
		need(p.title === undefined && p.base === undefined && p.head === undefined, "title/base/head serve kind 'pr' only");
	}
	return errs;
}

export interface PrBodyCheck {
	/** Template headings the body lacks (non-empty only when a template pins them). */
	templateMissing: string[];
	/** The body carries no AI-assistance section — draft is the composer that guarantees it. */
	assistanceMissing: boolean;
}

/** The PR-body envelope at the posting boundary — the same coverage rule draft enforces at compose time. */
export function checkPrBody(body: string, template: string | undefined): PrBodyCheck {
	const bodyLines = new Set(body.split("\n").map((l) => l.trim()));
	return {
		templateMissing: template === undefined ? [] : templateHeadings(template).filter((h) => !bodyLines.has(h)),
		assistanceMissing: !ASSISTANCE_HEADING_RE.test(body),
	};
}

/** Comments whose anchor path is not among the PR's diffed files — GitHub threads diffed files only. */
export function anchorsOutsideDiff(comments: PostComment[], diffedPaths: Set<string>): PostComment[] {
	return comments.filter((c) => !diffedPaths.has(c.file));
}

/** The exact REST call each kind makes; texts compose here — verdict line, reply shape, disclosures. */
export function postRequest(p: PostParams, repo: { owner: string; name: string }, id: Identity): PostRequest {
	const base = `repos/${repo.owner}/${repo.name}`;
	switch (p.kind) {
		case "review":
			return {
				method: "POST",
				path: `${base}/pulls/${p.number}/reviews`,
				payload: {
					event: "COMMENT",
					body: summaryText(p.verdict as SummaryVerdict, p.text!, id),
					// the API anchors the thread; `file:line:` stays presentation, not payload — cites is the one location that rides the body
					comments: (p.comments ?? []).map((c) => ({ path: c.file, line: c.line, body: commentText(c) })),
				},
			};
		case "comment":
			return { method: "POST", path: `${base}/issues/${p.number}/comments`, payload: { body: appendMarker(p.body!, id) } };
		case "reply":
			return {
				method: "POST",
				path: `${base}/pulls/${p.number}/comments/${p.inReplyTo}/replies`,
				payload: {
					body: replyText(
						{ verdict: p.verdict as "addressed" | "skipped", quote: p.quote ?? "", answers: p.answers, commit: p.commit, verification: p.verification, reason: p.reason },
						id,
					),
				},
			};
		case "pr": {
			if (p.number !== undefined) {
				const payload: Record<string, unknown> = {};
				if (p.title !== undefined) payload.title = p.title;
				if (p.body !== undefined) payload.body = p.body;
				return { method: "PATCH", path: `${base}/pulls/${p.number}`, payload };
			}
			return { method: "POST", path: `${base}/pulls`, payload: { title: p.title!, head: p.head!, base: p.base!, body: p.body! } };
		}
	}
}
