import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { commentText, replyText, summaryText, SUMMARY_VERDICTS, checkDraft, templateHeadings, parseRemoteUrl, isGithubHost, readTemplate } from "../src/envelopes.ts";
import { identityFrom, trailerLines, replyMarker, summaryFooter } from "../src/identity.ts";

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
t("comment: [severity], then ask — fact; label bold before, cite between", () => {
	assert.equal(commentText({ severity: "minor", ask: "Drop the fallback" }), "[minor] Drop the fallback");
	assert.equal(commentText({ severity: "blocking", ask: "Drop the fallback", fact: "src/b.ts:10 does the same check" }), "[blocking] Drop the fallback — src/b.ts:10 does the same check");
	assert.equal(commentText({ severity: "minor", ask: "Drop it", fact: "  " }), "[minor] Drop it");
	assert.equal(commentText({ severity: "minor", label: "C1", ask: "Drop the fallback" }), "**C1** [minor] Drop the fallback");
	assert.equal(commentText({ severity: "minor", cites: "docs/x.rst:104", ask: "Add the block" }), "[minor] docs/x.rst:104 — Add the block");
	assert.equal(commentText({ severity: "blocking", label: " C4 ", cites: "docs/x.rst:104", ask: "Add the block", fact: "every other scorer is listed" }), "**C4** [blocking] docs/x.rst:104 — Add the block — every other scorer is listed");
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
t("summary opens with the standardized verdict line, closes with the tool's footer", () => {
	const text = summaryText("minor", "Prior round accounting stands.", id);
	assert.match(text, /^\*\*Verdict: minor — no blocking findings; everything below is cleanup-grade\.\*\*\n\nPrior round accounting stands\./);
	assert.match(text, /AI assistance \(pi, glm-5\.3\) was used for this review\.$/);
	assert.throws(() => summaryText("clean", "  ", id), /empty/);
	assert.deepEqual(Object.keys(SUMMARY_VERDICTS).sort(), ["blocking", "clean", "minor"]);
	// register-free: no fixed gloss carries merge directives
	assert.equal(Object.values(SUMMARY_VERDICTS).some((g) => /merge|ready/i.test(g)), false);
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
t("draft: assistance param with a body that already carries the section is a conflict", () => {
	const own = checkDraft("# T\n\n## AI assistance\n\nhuman reviewed.", "agent did it", undefined, id);
	assert.equal(own.assistanceConflict, true); // detected pure-side; the caller refuses
	assert.equal(checkDraft("# T\n\nno section yet", "agent did it", undefined, id).assistanceConflict, false);
	// a no-section body with no param still throws (pinned above) — never reaches the flag
});

t("template headings parse and skip the AI-assistance heading", () => {
	assert.deepEqual(templateHeadings("## A\nprose\n### B\n## AI assistance\n"), ["## A", "### B"]);
});

// --- identity/URLs ------------------------------------------------------------------------
t("trailers: fixed pi.dev co-author with or without a baseUrl — never degrades to a bare name", () => {
	assert.deepEqual(trailerLines(id), ["AI-assistance: pi (glm-5.3)", "Co-authored-by: pi <noreply@pi.dev>"]);
	assert.deepEqual(trailerLines(bareId), ["AI-assistance: pi (glm-5.3)", "Co-authored-by: pi <noreply@pi.dev>"]);
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
