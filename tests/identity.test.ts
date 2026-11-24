import assert from "node:assert/strict";
import { commitDisclosure, commitMessage, disclosureLine, identityFrom, trailerLines } from "../src/identity.ts";

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

const id = identityFrom("pi", { id: "zai/glm-5.3", baseUrl: "https://api.z.ai/v1" });
const noModel = identityFrom("pi", undefined);

t("trailers: model line plus the fixed pi.dev co-author — never the provider domain, never a bare name", () => {
	assert.deepEqual(trailerLines(id), ["AI-assistance: pi (zai/glm-5.3)", "Co-authored-by: pi <noreply@pi.dev>"]);
});

t("trailers: the fixed domain never degrades — no model, no baseUrl still yields noreply@pi.dev", () => {
	assert.deepEqual(trailerLines(noModel), ["Co-authored-by: pi <noreply@pi.dev>"]);
});

t("commitMessage: identity trailers always ride, blank-separated after the body, caller trailers after them", () => {
	assert.equal(commitMessage({ subject: "s" }, id), `s\n\n${trailerLines(id).join("\n")}`);
	assert.equal(commitMessage({ subject: "s", body: "b" }, id), `s\n\nb\n\n${trailerLines(id).join("\n")}`);
	assert.match(commitMessage({ subject: "s", trailers: ["Signed-off-by: me <me@x>"] }, id), /Signed-off-by: me <me@x>$/);
});

t("commitMessage: whitespace-only bodies and caller trailers drop", () => {
	assert.equal(commitMessage({ subject: " s ", body: "  ", trailers: ["  ", "T: v"] }, id), `s\n\n${trailerLines(id).join("\n")}\nT: v`);
});

t("disclosureLine: the footer sentence, wrapped too, any purpose — the marker, the heading — 1-based; mentions pass", () => {
	for (const line of [
		"AI assistance (pi, glm-5.3) was used for this review.",
		"AI assistance (pi, zai/glm-5.4; research lanes zai/glm-5.3-flash) was used for this review.",
		"AI assistance (pi coding agent, GLM-5.4) was used for this change.",
		"AI-assistance (pi) was used to prepare this commit.",
		"_AI assistance (pi) was used for this review._",
		"*AI assistance (pi) was used for this review.*",
		"<sub>AI-assisted reply — pi (glm-5.3)</sub>",
		"## AI assistance",
		"### AI-assistance",
		"  AI assistance (pi) was used for this review  ",
		"- AI assistance (pi, glm-5.3) was used for this review.",
		"* _AI assistance (pi) was used for this review._",
	]) {
		assert.equal(disclosureLine(`Finding.\n${line}`), 2, line);
	}
	for (const line of [
		"- The AI-assistance trailer is missing on abc",
		"AI-assistance trailer missing on abc",
		"AI-assisted code in worker.py:4 re-derives the contract",
		"the author used AI assistance to write this",
		"AI assistance was slow on this PR",
		"AI-assisted reply without the sub wrapper",
		"## Coverage",
	]) {
		assert.equal(disclosureLine(`Finding.\n${line}`), undefined, line);
	}
	assert.equal(disclosureLine(""), undefined);
});

t("commitDisclosure: the message's own footer sentence, AI-assistance trailer, or the agent's co-author names itself; human trailers and findings pass", () => {
	// a hand-written footer sentence above the trailers the tool injects — the doubled-footnote shape
	const observed = {
		subject: "[doc, ci] chore: align new committer roster with CODEOWNERS",
		body: "The roster change added @WEIXILIN0307 to CODEOWNERS.\n\nAI assistance (pi coding agent, GLM-5.4) was used for this change.",
	};
	assert.equal(commitDisclosure(observed, "pi"), "body line 3: AI assistance (pi coding agent, GLM-5.4) was used for this change.");
	assert.equal(commitDisclosure({ subject: "AI-assistance: pi (glm-5.4)", body: "Why." }, "pi"), "subject: AI-assistance: pi (glm-5.4)");
	assert.equal(
		commitDisclosure({ subject: "fix: x", body: "Why.\nCo-authored-by: pi coding agent <noreply@pi.dev>", trailers: ["Signed-off-by: Mike Cheung <zhtmike@gmail.com>"] }, "pi"),
		"body line 2: Co-authored-by: pi coding agent <noreply@pi.dev>",
	);
	assert.equal(
		commitDisclosure({ subject: "fix: x", body: "Why.", trailers: ["Signed-off-by: Mike Cheung <zhtmike@gmail.com>", "AI-Assistance: pi (glm-5.4)"] }, "pi"),
		"trailer 2: AI-Assistance: pi (glm-5.4)",
	);
	assert.equal(commitDisclosure({ subject: "fix: x", body: "Why.", trailers: ["Co-authored-by: pi <noreply@pi.dev>"] }, "pi"), "trailer 1: Co-authored-by: pi <noreply@pi.dev>");
	for (const ok of [
		{ subject: "fix: the null check", body: "The producer writes nested records.\n\nAI-assisted code in worker.py:4 re-derives the contract.\nThe AI-assistance trailer is missing on abc." },
		{ subject: "fix: x", body: "Why.", trailers: ["Signed-off-by: Mike Cheung <zhtmike@gmail.com>", "Co-authored-by: Jane Roe <jane@example.org>", "Co-authored-by: Pierre Dupont <p@example.org>"] },
		{ subject: "fix: x" },
	]) {
		assert.equal(commitDisclosure(ok, "pi"), undefined, JSON.stringify(ok));
	}
});

process.exit(failures === 0 ? 0 : 1);
