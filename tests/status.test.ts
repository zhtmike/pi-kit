import assert from "node:assert/strict";
import { bindStatusSink, setStatusPart } from "../src/status.ts";

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

t("parts merge into one bracketed segment, no package prefix; clears when empty", () => {
	const seen: (string | undefined)[] = [];
	bindStatusSink((line) => seen.push(line));
	setStatusPart("claim", "checkout: abc");
	setStatusPart("gate", "approved: commit, push");
	assert.equal(seen.at(-1), "[checkout: abc · approved: commit, push]");
	setStatusPart("gate", undefined);
	assert.equal(seen.at(-1), "[checkout: abc]");
	setStatusPart("claim", undefined);
	assert.equal(seen.at(-1), undefined);
	bindStatusSink(null);
});

process.exit(failures === 0 ? 0 : 1);
