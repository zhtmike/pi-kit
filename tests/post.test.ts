import assert from "node:assert/strict";
import { appendMarker } from "../src/envelopes.ts";
import { identityFrom } from "../src/identity.ts";
import {
	anchorsOutsideDiff,
	checkPrBody,
	githubErrorMessage,
	parseDiffedFiles,
	postRequest,
	rightSideLines,
	settleAnchors,
	validatePost,
	type DiffedFile,
	type PostComment,
	type PostParams,
} from "../src/post.ts";

let failures = 0;
const t = (name: string, fn: () => void) => {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL - ${name}: ${(e as Error).message}`);
	}
};

const id = identityFrom("pi", { id: "glm-5.3" });
const repo = { owner: "verl-project", name: "verl-omni" };

// --- validation ---------------------------------------------------------------------------

t("each kind's happy path validates clean", () => {
	const ok: PostParams[] = [
		{ kind: "review", number: 882, verdict: "minor", text: "Prior round accounting stands.", comments: [{ file: "src/a.py", line: 53, severity: "minor", ask: "Delete the dead branch" }] },
		{ kind: "review", number: 882, verdict: "clean", text: "Coverage: full sweep, nothing flagged." },
		{ kind: "comment", number: 882, body: "A standalone comment" },
		{ kind: "reply", number: 882, inReplyTo: 12345, verdict: "addressed", quote: "the null check", answers: "moved to the caller", commit: "abc1234" },
		{ kind: "reply", number: 882, inReplyTo: 12345, verdict: "skipped", quote: "naming nit", answers: "kept as-is", reason: "either shape is defensible" },
		{ kind: "pr", title: "The fix", body: "## What\n\n…\n\n## AI assistance\n\n…" },
		{ kind: "pr", number: 882, title: "New title only" },
		{ kind: "pr", number: 882, body: "## What\n\n…\n\n## AI assistance\n\n…" },
	];
	for (const p of ok) assert.deepEqual(validatePost(p), []);
});

t("missing requireds name the param and the kind", () => {
	assert.deepEqual(validatePost({ kind: "review", comments: [] }), [
		"kind 'review' requires number (the PR)",
		"kind 'review' requires verdict — one of: clean, minor, blocking",
		"kind 'review' requires text (the body below the verdict line — findings, coverage, accounting)",
	]);
	const c = validatePost({ kind: "comment", number: 1 });
	assert.equal(c.length, 1);
	assert.equal(c[0].startsWith("kind 'comment' requires body"), true);
	assert.deepEqual(validatePost({ kind: "reply", number: 1 }), [
		"kind 'reply' requires inReplyTo (the review-comment id — gh api GET …/pulls/<n>/comments lists them)",
		"kind 'reply' requires verdict — one of: addressed, skipped",
	]);
	assert.equal(validatePost({ kind: "pr", body: "## AI assistance\nx" })[0].startsWith("kind 'pr' create requires title"), true);
	assert.equal(validatePost({ kind: "pr", number: 5 }).length, 1); // edit needs title or body
});

t("verdict tokens are kind-scoped; cross-kind params refuse naming the param", () => {
	assert.equal(
		validatePost({ kind: "review", number: 1, verdict: "addressed", text: "x" })[0],
		"verdict 'addressed' does not serve kind 'review' — pick clean, minor, or blocking (addressed/skipped serve kind 'reply')",
	);
	assert.equal(
		validatePost({ kind: "reply", number: 1, inReplyTo: 9, verdict: "minor", quote: "q", answers: "a" })[0],
		"verdict 'minor' does not serve kind 'reply' — pick addressed or skipped (clean/minor/blocking serve kind 'review')",
	);
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", verdict: "clean" })[0], "kind 'comment' takes no verdict — it is free prose");
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", comments: [{ file: "a", line: 1, severity: "minor", ask: "y" }] })[0], "text/comments serve kind 'review' only");
	assert.equal(validatePost({ kind: "review", number: 1, verdict: "clean", text: "x", body: "b" })[0], "kind 'review' takes text, not body — text is the review body");
	assert.equal(validatePost({ kind: "reply", number: 1, inReplyTo: 9, verdict: "skipped", quote: "q", answers: "a", body: "b" })[0], "kind 'reply' composes its body from quote/answers — pass those, not body");
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", title: "t" })[0], "title/base/head serve kind 'pr' only");
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", commit: "abc" })[0], "quote/answers/commit/verification/reason serve kind 'reply' only");
});

t("comment items validate: file+ask present, line >= 1, severity blocking|minor; repo must be owner/name", () => {
	const errs = validatePost({
		kind: "review",
		number: 1,
		verdict: "minor",
		text: "s",
		comments: [
			{ file: "a", line: 0, severity: "minor", ask: "x" },
			{ file: " ", line: 2, severity: "minor", ask: "x" },
			{ file: "b", line: 2, severity: "minor", ask: "" },
			{ file: "c", line: 3, severity: "clean", ask: "x" } as any,
		],
		repo: "not-a-repo",
	});
	assert.equal(errs.some((e) => e.includes("requires line >= 1")), true);
	assert.equal(errs.some((e) => e.includes("requires file")), true);
	assert.equal(errs.some((e) => e.includes("requires ask")), true);
	assert.equal(errs.includes("severity 'clean' on 'c:3' does not serve a thread — pick blocking or minor (clean means no threads)"), true);
	assert.equal(errs.includes("repo 'not-a-repo' is not 'owner/name' — name the target as owner/name"), true);
});

// --- disclosures, threads, anchors -------------------------------------------------------------

/** The shape of a posted review whose hand-written footer doubled the tool's: 12 lines, the variant footer last. */
const observedText = [
	"Blocking: the rework splits functions but keeps a parallel mechanism.",
	"",
	"Round accounting at ae9ad4d:",
	"- SamitHuang's allowlist: fixed at a93e61f.",
	"- knlnguyen1901's re-check: kept.",
	"- My two inline comments: partially addressed; re-flagged below.",
	"",
	"Fix direction (C1–C7): config owns the field groups.",
	"",
	"Coverage: all 14 files at ae9ad4d; #714, #653 and #942 resolved.",
	"",
	"AI assistance (pi, zai/glm-5.4; research lanes zai/glm-5.3-flash) was used for this review.",
].join("\n");
const review = (text: string, extra: Partial<PostParams> = {}): PostParams => ({ kind: "review", number: 933, verdict: "blocking", text, ...extra });

t("a review text carrying its own disclosure refuses naming the line; a finding that mentions assistance passes", () => {
	assert.deepEqual(validatePost(review(observedText)), [
		"kind 'review' text carries its own AI-assistance disclosure at line 12 — the tool appends the footer; drop the line",
	]);
	for (const line of [
		"AI assistance (pi) was used for this review",
		"_AI assistance (pi, glm) was used for this review._",
		"<sub>AI-assisted reply — pi (glm-5.3)</sub>",
		"## AI assistance",
	]) {
		assert.equal(validatePost(review(`Finding one.\n\n${line}`)).length, 1, line);
	}
	assert.deepEqual(validatePost(review("- The AI-assistance trailer is missing on abc\nAI-assisted code in worker.py:4 re-derives the contract")), []);
});

t("a comment body carrying a disclosure refuses naming the marker", () => {
	assert.deepEqual(validatePost({ kind: "comment", number: 5, body: "Standalone\n\n<sub>AI-assisted reply — pi (glm-5.3)</sub>" }), [
		"kind 'comment' body carries its own AI-assistance disclosure at line 3 — the tool appends the marker; drop the line",
	]);
});

t("threads: severity required; label one token and unique; cites non-empty; verdict and threads agree", () => {
	const thread: PostComment = { file: "a.py", line: 3, severity: "minor", ask: "x" };
	const noSeverity = validatePost(review("t", { comments: [{ file: "a.py", line: 3, ask: "x" } as any] }));
	assert.deepEqual(noSeverity, ["comment on 'a.py:3' requires severity — blocking or minor"]);
	const labels = validatePost(
		review("t", {
			comments: [
					{ ...thread, label: "C1" },
					{ ...thread, line: 4, label: "C1" },
					{ ...thread, line: 5, label: "config contract" },
					{ ...thread, line: 6, label: "  " },
					{ ...thread, line: 7, cites: " " },
				],
		}),
	);
	assert.deepEqual(labels, [
		"label 'C1' names two threads ('a.py:3', 'a.py:4') — each thread gets its own",
		"label 'config contract' on 'a.py:5' is not one token — a label is a short id the summary text refers to (C1, R3…)",
		"comment on 'a.py:6' has an empty label — drop the param or pass one token (C1, R3…)",
		"comment on 'a.py:7' has an empty cites — drop the param or pass a location (path:line, a file)",
	]);
	assert.deepEqual(validatePost(review("t", { verdict: "clean", comments: [thread] })), ["verdict 'clean' means no findings — drop comments or pick minor or blocking"]);
	assert.deepEqual(validatePost(review("t", { verdict: "clean" })), []);
	assert.deepEqual(validatePost(review("t", { verdict: "minor", comments: [{ ...thread, severity: "blocking" }] })), [
		"comment on 'a.py:3' is blocking under verdict 'minor' — pick verdict blocking or severity minor",
	]);
	assert.deepEqual(validatePost(review("t", { verdict: "blocking", comments: [thread] })), []); // the blocking finding may live in the summary
	assert.deepEqual(validatePost({ kind: "comment", number: 1, body: "x", comments: [{ file: "a", line: 1, severity: "minor", ask: "y" }] })[0], "text/comments serve kind 'review' only");
});

t("anchorsOutsideDiff names the anchors whose path is not in the diffed set", () => {
	const threads: PostParams["comments"] = [
		{ file: "verl_omni/utils/reward_score/scorers/__init__.py", line: 29, severity: "minor", cites: "docs/api/reward.rst:104", ask: "Add the automodule block" },
		{ file: "docs/api/reward.rst", line: 104, severity: "blocking", ask: "Add the block here" },
	];
	const outside = anchorsOutsideDiff(threads!, new Set(["verl_omni/utils/reward_score/scorers/__init__.py", "README.md"]));
	assert.deepEqual(outside.map((c) => `${c.file}:${c.line}`), ["docs/api/reward.rst:104"]);
	assert.deepEqual(anchorsOutsideDiff([], new Set()), []);
});

// --- thread anchors against the PR diff ----------------------------------------------------

const PATCH = [
	"@@ -553,7 +553,9 @@ Deploy the Thinker",
	" ctx 553",
	" ctx 554",
	"-old 555",
	"+new 555",
	"+new 556",
	" ctx 557",
	" ctx 558",
	"@@ -600,3 +602,3 @@",
	" ctx 602",
	"+new 603",
	" ctx 604",
	"\\ No newline at end of file",
	"",
].join("\n");
const files = (): DiffedFile[] => [
	{ filename: "docs/config.md", patch: PATCH },
	{ filename: "removed.py", patch: "@@ -1,2 +0,0 @@\n-a\n-b" },
	{ filename: "trimmed.py", patch: "@@ -10,3 +9,0 @@\n-a\n-b\n-c" },
	{ filename: "renamed.md" },
];

t("parseDiffedFiles reads the --jq lines; a line that is not JSON or lacks a filename names itself", () => {
	const stdout = '{"filename":"a.py","patch":"@@ -1 +1 @@\\n+x"}\n{"filename":"b.png"}\n\n';
	assert.deepEqual(parseDiffedFiles(stdout), [
		{ filename: "a.py", patch: "@@ -1 +1 @@\n+x" },
		{ filename: "b.png" },
	]);
	assert.deepEqual(parseDiffedFiles(""), []);
	assert.throws(() => parseDiffedFiles('{"filename":"a.py"}\nnot json'), /files page line 2 is not JSON: not json/);
	assert.throws(() => parseDiffedFiles('{"patch":"x"}'), /files page line 1 carries no filename/);
});

t("rightSideLines: context and added lines, never removed; hunks chain; a deleted file has none", () => {
	assert.deepEqual(rightSideLines(PATCH), [553, 554, 555, 556, 557, 558, 602, 603, 604]);
	assert.deepEqual(rightSideLines("@@ -0,0 +1,2 @@\n+x\n+y"), [1, 2]);
	assert.deepEqual(rightSideLines("@@ -1,2 +0,0 @@\n-a\n-b"), []);
});

t("settleAnchors: a line outside the hunks moves to the nearest diffed line, citing the requested one; diffed lines and unrendered files pass; removals-only files refuse", () => {
	const settled = settleAnchors(
		[
			{ file: "docs/config.md", line: 3, severity: "minor", ask: "stale header" },
			{ file: "docs/config.md", line: 560, severity: "minor", label: "C2", cites: "README.md:7", ask: "cite kept" },
			{ file: "docs/config.md", line: 557, severity: "blocking", ask: "in the hunk" },
			{ file: "renamed.md", line: 900, severity: "minor", ask: "unverifiable" },
		],
		files(),
	);
	assert.deepEqual(settled.unanchorable, []);
	assert.deepEqual(settled.comments, [
		{ file: "docs/config.md", line: 553, severity: "minor", cites: "docs/config.md:3", ask: "stale header" },
		{ file: "docs/config.md", line: 558, severity: "minor", label: "C2", cites: "README.md:7", ask: "cite kept" },
		{ file: "docs/config.md", line: 557, severity: "blocking", ask: "in the hunk" },
		{ file: "renamed.md", line: 900, severity: "minor", ask: "unverifiable" },
	]);
	assert.deepEqual(settled.moved, [
		{ index: 0, from: 3, to: 553 },
		{ index: 1, from: 560, to: 558 },
	]);
	const noLine = settleAnchors(
		[
			{ file: "removed.py", line: 1, severity: "minor", ask: "deleted file" },
			{ file: "trimmed.py", line: 9, severity: "minor", ask: "live file, removals only" },
		],
		files(),
	);
	assert.deepEqual(noLine.unanchorable.map((c) => `${c.file}:${c.line}`), ["removed.py:1", "trimmed.py:9"]);
	assert.deepEqual(noLine.comments, []);
});

t("githubErrorMessage: a 4xx body compresses to message + field: code; anything else is undefined", () => {
	assert.equal(
		githubErrorMessage('{\n  "message": "Validation Failed",\n  "errors": [\n    {\n      "resource": "PullRequestReview",\n      "field": "comments[data][line]",\n      "code": "invalid"\n    }\n  ]\n}'),
		"Validation Failed — comments[data][line]: invalid",
	);
	assert.equal(githubErrorMessage('{\n  "message": "Not Found",\n  "status": "404"\n}'), "Not Found");
	assert.equal(githubErrorMessage('{"message":"Validation Failed","errors":[{"message":"line must be part of the diff"}]}'), "Validation Failed — line must be part of the diff");
	assert.equal(githubErrorMessage('{"id":1,"html_url":"https://x"}'), undefined);
	assert.equal(githubErrorMessage(""), undefined);
	assert.equal(githubErrorMessage("gh: Not Found (HTTP 404)"), undefined);
});

// --- payloads ------------------------------------------------------------------------------

t("review payload pins event COMMENT, composes the verdict line, thread bodies with severity/label/cite, the footer", () => {
	const req = postRequest(
		{
			kind: "review",
			number: 882,
			verdict: "minor",
			text: "Prior round accounting stands.",
			comments: [
				{ file: "src/a.py", line: 53, severity: "minor", ask: "Delete the dead branch", fact: "the producer always writes nested records" },
				{ file: "src/b.py", line: 8, severity: "minor", ask: "Rename the helper" },
			],
		},
		repo,
		id,
	);
	assert.equal(req.method, "POST");
	assert.equal(req.path, "repos/verl-project/verl-omni/pulls/882/reviews");
	assert.equal((req.payload as any).event, "COMMENT");
	assert.match((req.payload as any).body, /^\*\*Verdict: minor — no blocking findings; everything below is cleanup-grade\.\*\*$/m);
	assert.match((req.payload as any).body, /AI assistance \(pi, glm-5\.3\) was used for this review\.$/);
	assert.deepEqual((req.payload as any).comments, [
		{ path: "src/a.py", line: 53, body: "[minor] Delete the dead branch — the producer always writes nested records" },
		{ path: "src/b.py", line: 8, body: "[minor] Rename the helper" },
	]);
	// a finding outside the diff: the anchor is the diffed export line, the cite rides the body
	const cited = postRequest(
		review("t", {
			comments: [
				{ file: "verl_omni/utils/reward_score/scorers/__init__.py", line: 29, severity: "blocking", label: "C4", cites: "docs/api/reward.rst:104", ask: "Derive the contract from config", fact: "the rules prescribe it" },
			],
		}),
		repo,
		id,
	);
	assert.equal((cited.payload as any).comments[0].body, "**C4** [blocking] docs/api/reward.rst:104 — Derive the contract from config — the rules prescribe it");
});

t("reply payload composes the replyText shape — quote blockquote, verdict opener, marker", () => {
	const req = postRequest({ kind: "reply", number: 882, inReplyTo: 99, verdict: "addressed", quote: "the null check on parseRecord", answers: "the check moved to the caller", commit: "abc1234", verification: "npm test green" }, repo, id);
	assert.equal(req.method, "POST");
	assert.equal(req.path, "repos/verl-project/verl-omni/pulls/882/comments/99/replies");
	assert.match((req.payload as any).body, /^> the null check on parseRecord$/m);
	assert.match((req.payload as any).body, /Addressed in `abc1234`:/);
	assert.match((req.payload as any).body, /<sub>AI-assisted reply — pi \(glm-5\.3\)<\/sub>$/);
	assert.throws(() => postRequest({ kind: "reply", number: 1, inReplyTo: 9, verdict: "skipped", quote: "q", answers: "a" } as PostParams, repo, id), /reason/);
});

t("comment payload appends the marker; a body already carrying one refused at validation; empty refuses", () => {
	const c = postRequest({ kind: "comment", number: 5, body: "Standalone" }, repo, id);
	assert.equal(c.path, "repos/verl-project/verl-omni/issues/5/comments");
	assert.match((c.payload as any).body, /<sub>AI-assisted reply — pi \(glm-5\.3\)<\/sub>$/);
	assert.equal(validatePost({ kind: "comment", number: 5, body: `Standalone\n\n<sub>AI-assisted reply — pi (glm-5.3)</sub>` }).length, 1);
	assert.throws(() => appendMarker("  ", id), /empty/);
});

t("pr payloads: create posts title/head/base/body; edit patches only the given fields", () => {
	const create = postRequest({ kind: "pr", title: "The fix", body: "## AI assistance\nx", head: "zhtmike:fix", base: "main" }, repo, id);
	assert.equal(create.method, "POST");
	assert.equal(create.path, "repos/verl-project/verl-omni/pulls");
	assert.deepEqual(Object.keys(create.payload).sort(), ["base", "body", "head", "title"]);
	const edit = postRequest({ kind: "pr", number: 882, title: "New title" }, repo, id);
	assert.equal(edit.method, "PATCH");
	assert.equal(edit.path, "repos/verl-project/verl-omni/pulls/882");
	assert.deepEqual(edit.payload, { title: "New title" });
});

t("fractional number/inReplyTo and empty pr fields refuse at validation", () => {
	const errs = validatePost({ kind: "comment", number: 1.5, body: "x" });
	assert.equal(errs.includes("number '1.5' is not an integer — a PR number is"), true);
	assert.equal(validatePost({ kind: "reply", number: 1, inReplyTo: 2.5, verdict: "skipped", quote: "q", answers: "a", reason: "r" })[0], "inReplyTo '2.5' is not an integer — a comment id is");
	assert.equal(validatePost({ kind: "pr", number: 5, title: " " })[0], "kind 'pr' refuses an empty title — pass the title or drop the param");
	assert.equal(validatePost({ kind: "pr", number: 5, body: " " })[0], "kind 'pr' refuses an empty body — pass the body or drop the param");
});

// --- the PR-body envelope --------------------------------------------------------------------

t("checkPrBody: template headings and the assistance section, both enforced", () => {
	const template = "## What\n## Why\n";
	const missingBoth = checkPrBody("no structure here", template);
	assert.deepEqual(missingBoth.templateMissing, ["## What", "## Why"]);
	assert.equal(missingBoth.assistanceMissing, true);
	const clean = checkPrBody("## What\nfixes it\n\n## Why\nthe hook hops\n\n## AI assistance\n\nsomeone reviewed.", template);
	assert.deepEqual(clean.templateMissing, []);
	assert.equal(clean.assistanceMissing, false);
	assert.deepEqual(checkPrBody("anything — no template pins headings", undefined).templateMissing, []);
});

process.exit(failures === 0 ? 0 : 1);
