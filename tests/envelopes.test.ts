import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { commentText, replyText, summaryText, checkDraft, templateHeadings, parseRemoteUrl, isGithubHost , readTemplate } from "../src/envelopes.ts";
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
t("comment: anchorless shape is the bare ask (fact joins unchanged); file/line must pair", () => {
	assert.equal(commentText({ ask: "Rename the helper" }), "Rename the helper");
	assert.equal(commentText({ ask: "Rename the helper", fact: "src/b.ts:10 does the same check" }), "Rename the helper — src/b.ts:10 does the same check");
	assert.throws(() => commentText({ file: "a", ask: "x" }), /file and line together/);
	assert.throws(() => commentText({ line: 3, ask: "x" }), /file and line together/);
});

// --- reply --------------------------------------------------------------------------------
t("reply opens with the > quote, answers below the verdict opener, marker small", () => {
	const text = replyText({ verdict: "addressed", quote: "the null check on parseRecord", answers: "the check moved to the caller", commit: "abc1234", verification: "npm test green" }, id);
	assert.match(text, /^> the null check on parseRecord$\n\nAddressed in `abc1234`:/m);
	assert.match(text, /- Answers: the check moved to the caller/);
	assert.match(text, /- Verification: npm test green/);
	assert.match(text, /<sub>AI-assisted reply — pi \(glm-5\.3\)<\/sub>$/m);
});
t("reply skipped opens 'Skipped, with reasoning:' and requires a reason", () => {
	const text = replyText({ verdict: "skipped", quote: "naming nit", reason: "either shape is defensible" }, id);
	assert.match(text, /^Skipped, with reasoning:$/m);
	assert.match(text, /- Reason: either shape is defensible/);
	assert.throws(() => replyText({ verdict: "skipped", quote: "x" }, id), /reason/);
	assert.throws(() => replyText({ verdict: "addressed", commit: "abc" } as any, id), /quote/);
});
t("reply addressed without a commit refuses", () => {
	assert.throws(() => replyText({ verdict: "addressed", quote: "x" }, id), /commit/);
});
t("reply: each reply ends with its own marker — a quoted marker never suppresses it, an identical trailing one does", () => {
	const once = replyText({ verdict: "addressed", quote: "x", commit: "abc" }, id);
	const twice = replyText({ verdict: "addressed", quote: once, commit: "abc" }, id);
	assert.equal(twice.split("AI-assisted reply").length - 1, 2); // the quoted reply's + its own
	assert.ok(twice.trimEnd().endsWith(replyMarker(id)));
	const raw = `Addressed in \`abc\`:\n- Answers: y\n\n${replyMarker(id)}`;
	assert.equal(replyText({ verdict: "addressed", quote: "x", answers: raw, commit: "abc" }, id).split("AI-assisted reply").length - 1, 1); // mid-text marker, own appended
});
t("marker drops the model parenthetical when unverifiable; small-print wrap always", () => {
	assert.equal(replyMarker(bareId), "<sub>AI-assisted reply — pi (glm-5.3)</sub>");
	assert.equal(replyMarker(noModel), "<sub>AI-assisted reply — pi</sub>");
	assert.equal(summaryFooter(noModel), "AI assistance (pi) was used for this review.");
});

// --- summary ------------------------------------------------------------------------------
t("summary closes with the AI-assistance footer; no double footer", () => {
	const text = summaryText("Two findings, both blocking.", id);
	assert.match(text, /AI assistance \(pi, glm-5\.3\) was used for this review\.$/);
	assert.equal(summaryText(text, id), text);
});

// --- draft -------------------------------------------------------------------------------
t("draft: body without disclosure and no assistance param refuses", () => {
	assert.throws(() => checkDraft("# My change\n\nFixes x.", undefined, undefined, id), /assistance/);
});
t("draft: assistance param appends the section; body with its own section is kept", () => {
	const out = checkDraft("# My change\n\nFixes x.", "agent implemented; human reviewed the design", undefined, id);
	assert.match(out.body, /## AI assistance/);
	assert.match(out.body, /agent implemented; human reviewed the design/);
	const own = checkDraft("# My change\n\n## AI assistance\n\nHuman-reviewed.", undefined, undefined, id);
	assert.equal(own.body.match(/## AI assistance/g)?.length, 1);
});
t("draft: template headings must appear in the body; missing ones are named", () => {
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
t("a template with its own AI section: unfilled refuses naming it; filled passes with nothing appended", () => {
	const template = "## What\n\n## AI assistance\n";
	assert.throws(() => checkDraft("## What\nx", undefined, template, id), /template pins its own disclosure/);
	const filled = checkDraft("## What\nx\n\n## AI assistance\nhuman reviewed everything", undefined, template, id);
	assert.equal(filled.body, "## What\nx\n\n## AI assistance\nhuman reviewed everything"); // no append on top
	assert.deepEqual(filled.templateMissing, []);
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

// --- template discovery (draft) ---------------------------------------------------------

t("readTemplate: single-file candidates, then dir default.md, else first .md; none → undefined", () => {
	const withDir = (files: Record<string, string>, fn: (dir: string) => void) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pikit-tpl-"));
		for (const [rel, text] of Object.entries(files)) {
			const p = path.join(dir, rel);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, text);
		}
		try {
			fn(dir);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	};
	withDir({ ".github/PULL_REQUEST_TEMPLATE.md": "# T\n## A" }, (dir) => {
		assert.deepEqual(readTemplate(dir), { path: ".github/PULL_REQUEST_TEMPLATE.md", text: "# T\n## A" });
	});
	withDir({ ".github/PULL_REQUEST_TEMPLATE/b.md": "b", ".github/PULL_REQUEST_TEMPLATE/default.md": "d" }, (dir) => {
		assert.equal(readTemplate(dir)!.path, ".github/PULL_REQUEST_TEMPLATE/default.md");
	});
	withDir({ "PULL_REQUEST_TEMPLATE/z.md": "z", "PULL_REQUEST_TEMPLATE/a.md": "a" }, (dir) => {
		assert.equal(readTemplate(dir)!.path, "PULL_REQUEST_TEMPLATE/a.md"); // sorted first
	});
	withDir({ "README.md": "x" }, (dir) => {
		assert.equal(readTemplate(dir), undefined);
	});
});

process.exit(failures === 0 ? 0 : 1);
