import assert from "node:assert/strict";
import { commitMessage, identityFrom, trailerLines } from "../src/identity.ts";

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

t("trailers: model line plus domain-derived co-author", () => {
	assert.deepEqual(trailerLines(id), ["AI-assistance: pi (zai/glm-5.3)", "Co-authored-by: pi <noreply@z.ai>"]);
});

t("commitMessage: identity trailers always ride, blank-separated after the body, caller trailers after them", () => {
	assert.equal(commitMessage({ subject: "s" }, id), `s\n\n${trailerLines(id).join("\n")}`);
	assert.equal(commitMessage({ subject: "s", body: "b" }, id), `s\n\nb\n\n${trailerLines(id).join("\n")}`);
	assert.match(commitMessage({ subject: "s", trailers: ["Signed-off-by: me <me@x>"] }, id), /Signed-off-by: me <me@x>$/);
});

t("commitMessage: whitespace-only bodies and caller trailers drop", () => {
	assert.equal(commitMessage({ subject: " s ", body: "  ", trailers: ["  ", "T: v"] }, id), `s\n\n${trailerLines(id).join("\n")}\nT: v`);
});

process.exit(failures === 0 ? 0 : 1);
