import assert from "node:assert/strict";
import { commitMessage, disclosureLine, identityFrom, trailerLines } from "../src/identity.ts";

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

t("disclosureLine: the footer in any wording (wrapped too), the marker, the heading — 1-based; mentions pass", () => {
	for (const line of [
		"AI assistance (pi, glm-5.3) was used for this review.",
		"AI assistance (pi, zai/glm-5.4; research lanes zai/glm-5.3-flash) was used for this review.",
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

process.exit(failures === 0 ? 0 : 1);
