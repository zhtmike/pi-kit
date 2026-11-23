import assert from "node:assert/strict";
import { appendMarkerIfMissing } from "../src/envelopes.ts";
import { identityFrom } from "../src/identity.ts";
import { checkPrBody, postRequest, validatePost, type PostParams } from "../src/post.ts";

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
		{ kind: "review", number: 882, verdict: "minor", text: "Prior round accounting stands.", comments: [{ file: "src/a.py", line: 53, ask: "Delete the dead branch" }] },
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
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", comments: [{ file: "a", line: 1, ask: "y" }] })[0], "text/comments serve kind 'review' only");
	assert.equal(validatePost({ kind: "review", number: 1, verdict: "clean", text: "x", body: "b" })[0], "kind 'review' takes text, not body — text is the review body");
	assert.equal(validatePost({ kind: "reply", number: 1, inReplyTo: 9, verdict: "skipped", quote: "q", answers: "a", body: "b" })[0], "kind 'reply' composes its body from quote/answers — pass those, not body");
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", title: "t" })[0], "title/base/head serve kind 'pr' only");
	assert.equal(validatePost({ kind: "comment", number: 1, body: "x", commit: "abc" })[0], "quote/answers/commit/verification/reason serve kind 'reply' only");
});

t("comment items validate: file+ask present, line >= 1; repo must be owner/name", () => {
	const errs = validatePost({
		kind: "review",
		number: 1,
		verdict: "clean",
		text: "s",
		comments: [
			{ file: "a", line: 0, ask: "x" },
			{ file: " ", line: 2, ask: "x" },
			{ file: "b", line: 2, ask: "" },
		],
		repo: "not-a-repo",
	});
	assert.equal(errs.some((e) => e.includes("requires line >= 1")), true);
	assert.equal(errs.some((e) => e.includes("requires file")), true);
	assert.equal(errs.some((e) => e.includes("requires ask")), true);
	assert.equal(errs.includes("repo 'not-a-repo' is not 'owner/name' — name the target as owner/name"), true);
});

// --- payloads ------------------------------------------------------------------------------

t("review payload pins event COMMENT, composes the verdict line, anchorless thread bodies, the footer", () => {
	const req = postRequest(
		{
			kind: "review",
			number: 882,
			verdict: "minor",
			text: "Prior round accounting stands.",
			comments: [
				{ file: "src/a.py", line: 53, ask: "Delete the dead branch", fact: "the producer always writes nested records" },
				{ file: "src/b.py", line: 8, ask: "Rename the helper" },
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
		{ path: "src/a.py", line: 53, body: "Delete the dead branch — the producer always writes nested records" },
		{ path: "src/b.py", line: 8, body: "Rename the helper" },
	]);
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

t("comment payload appends the marker once; a body already marked is untouched", () => {
	const c = postRequest({ kind: "comment", number: 5, body: "Standalone" }, repo, id);
	assert.equal(c.path, "repos/verl-project/verl-omni/issues/5/comments");
	assert.match((c.payload as any).body, /<sub>AI-assisted reply — pi \(glm-5\.3\)<\/sub>$/);
	const marked = postRequest({ kind: "comment", number: 5, body: `Standalone\n\n<sub>AI-assisted reply — pi (glm-5.3)</sub>` }, repo, id);
	assert.equal((marked.payload as any).body.match(/AI-assisted reply/g)?.length, 1);
	assert.throws(() => appendMarkerIfMissing("  ", id), /empty/);
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
