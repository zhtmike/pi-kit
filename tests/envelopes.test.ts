import assert from "node:assert/strict";
import { commentText, replyText, summaryText, checkDraft, templateHeadings, parseRemoteUrl, isGithubHost } from "../src/envelopes.ts";
import { identityFrom, trailerLines, replyMarker, summaryFooter, domainOfBaseUrl } from "../src/identity.ts";

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

const id = identityFrom("pi", { id: "glm-5.3", baseUrl: "https://api.z.ai/v1" });
const bareId = identityFrom("pi", { id: "glm-5.3" });
const noModel = identityFrom("pi", undefined);

// --- comment ------------------------------------------------------------------------------
t("comment: file:line anchor + one ask + at most one fact", () => {
	assert.equal(commentText({ file: "src/a.ts", line: 42, ask: "Drop the fallback" }), "src/a.ts:42: Drop the fallback");
	assert.equal(commentText({ file: "src/a.ts", line: 42, ask: "Drop the fallback", fact: "src/b.ts:10 does the same check" }), "src/a.ts:42: Drop the fallback — src/b.ts:10 does the same check");
});
t("comment: a non-positive line refuses", () => {
	assert.throws(() => commentText({ file: "a", line: 0, ask: "x" }), /positive line/);
});

// --- reply --------------------------------------------------------------------------------
t("reply addressed opens 'Addressed in <commit>:' and carries the marker", () => {
	const text = replyText({ verdict: "addressed", answers: "the null check", commit: "abc1234", verification: "npm test green" }, id);
	assert.match(text, /^Addressed in `abc1234`:$/m);
	assert.match(text, /^> the null check$/m);
	assert.match(text, /- Verification: npm test green/);
	assert.match(text, /AI-assisted reply — pi \(glm-5\.3\)$/m);
});
t("reply skipped opens 'Skipped, with reasoning:' and requires a reason", () => {
	const text = replyText({ verdict: "skipped", answers: "naming nit", reason: "either shape is defensible" }, id);
	assert.match(text, /^Skipped, with reasoning:$/m);
	assert.match(text, /- Reason: either shape is defensible/);
	assert.throws(() => replyText({ verdict: "skipped", answers: "x" }, id), /reason/);
});
t("reply addressed without a commit refuses", () => {
	assert.throws(() => replyText({ verdict: "addressed", answers: "x" }, id), /commit/);
});
t("reply: a marked text never gains a second marker", () => {
	const once = replyText({ verdict: "addressed", answers: "x", commit: "abc" }, id);
	const twice = replyText({ verdict: "addressed", answers: once, commit: "abc" }, id);
	assert.equal(twice.split("AI-assisted reply").length - 1, 1);
});
t("marker drops the model parenthetical when unverifiable", () => {
	assert.equal(replyMarker(bareId), "AI-assisted reply — pi (glm-5.3)");
	assert.equal(replyMarker(noModel), "AI-assisted reply — pi");
	assert.equal(summaryFooter(noModel), "AI assistance (pi) was used for this review.");
});

// --- summary ------------------------------------------------------------------------------
t("summary closes with the AI-assistance footer; no double footer", () => {
	const text = summaryText("Two findings, both blocking.", id);
	assert.match(text, /AI assistance \(pi, glm-5\.3\) was used for this review\.$/);
	assert.equal(summaryText(text, id), text);
});

// --- pr_draft -----------------------------------------------------------------------------
t("pr_draft: body without disclosure and no assistance param refuses", () => {
	assert.throws(() => checkDraft("# My change\n\nFixes x.", undefined, undefined, id), /assistance/);
});
t("pr_draft: assistance param appends the section; body with its own section is kept", () => {
	const out = checkDraft("# My change\n\nFixes x.", "agent implemented; human reviewed the design", undefined, id);
	assert.match(out.body, /## AI assistance/);
	assert.match(out.body, /agent implemented; human reviewed the design/);
	const own = checkDraft("# My change\n\n## AI assistance\n\nHuman-reviewed.", undefined, undefined, id);
	assert.equal(own.body.match(/## AI assistance/g)?.length, 1);
});
t("pr_draft: template headings must appear in the body; missing ones are named", () => {
	const template = "## What\n\n## Why\n\n## Tests\n";
	const out = checkDraft("# Title\n\nBody without sections.", undefined, template, id);
	assert.deepEqual(out.templateMissing, ["## What", "## Why", "## Tests"]);
	const filled = checkDraft("## What\nx\n\n## Why\ny\n\n## Tests\nz", "agent did it; human reviewed", template, id);
	assert.deepEqual(filled.templateMissing, []);
});
t("template heading match is line-exact, not substring", () => {
	const template = "## What\n";
	const out = checkDraft("## Whatever changed\n\nx", "agent; human", template, id);
	assert.deepEqual(out.templateMissing, ["## What"]); // '## Whatever changed' must not satisfy '## What'
});
t("template headings parse and skip the AI-assistance heading", () => {
	assert.deepEqual(templateHeadings("## A\nprose\n### B\n## AI assistance\n"), ["## A", "### B"]);
});

// --- identity/URLs ------------------------------------------------------------------------
t("trailers: full pair with domain; bare remainder without", () => {
	assert.deepEqual(trailerLines(id), ["AI-assistance: pi (glm-5.3)", "Co-authored-by: pi <noreply@z.ai>"]);
	assert.deepEqual(trailerLines(bareId), ["AI-assistance: pi (glm-5.3)", "Co-authored-by: pi"]);
});
t("domain derivation strips api./www. and requires a dot", () => {
	assert.equal(domainOfBaseUrl("https://api.z.ai/v1"), "z.ai");
	assert.equal(domainOfBaseUrl("https://api.anthropic.com"), "anthropic.com");
	assert.equal(domainOfBaseUrl("https://www.example.com/x"), "example.com");
	assert.equal(domainOfBaseUrl("not-a-url"), undefined); // no dot — unverifiable
	assert.equal(domainOfBaseUrl(undefined), undefined);
});
t("remote parse: https/scp/ssh forms; SSH alias and bare host are unparseable", () => {
	assert.deepEqual(parseRemoteUrl("https://github.com/zhtmike/skills.git"), { host: "github.com", owner: "zhtmike", name: "skills" });
	assert.deepEqual(parseRemoteUrl("git@github.com:zhtmike/skills"), { host: "github.com", owner: "zhtmike", name: "skills" });
	assert.deepEqual(parseRemoteUrl("ssh://git@github.com/zhtmike/skills.git"), { host: "github.com", owner: "zhtmike", name: "skills" });
	assert.equal(parseRemoteUrl("gh:zhtmike/skills"), undefined); // SSH alias — unparseable
	const gl = parseRemoteUrl("git@gitlab.internal:o/r"); // parses, but the owner check is GitHub-only
	assert.ok(gl);
	assert.equal(isGithubHost(gl.host), false);
	assert.equal(isGithubHost("github.com"), true);
	assert.equal(isGithubHost("gitlab.internal"), false);
});

process.exit(failures === 0 ? 0 : 1);
