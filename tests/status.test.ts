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
	setStatusPart("a", "part one");
	setStatusPart("b", "part two");
	assert.equal(seen.at(-1), "[part one · part two]");
	setStatusPart("b", undefined);
	assert.equal(seen.at(-1), "[part one]");
	setStatusPart("a", undefined);
	assert.equal(seen.at(-1), undefined);
	bindStatusSink(null);
});

process.exit(failures === 0 ? 0 : 1);
