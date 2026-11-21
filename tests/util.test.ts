import assert from "node:assert/strict";
import { expandShellPath } from "../src/util.ts";

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

t("tilde forms expand against home", () => {
	assert.equal(expandShellPath("~", "/home/u", {}), "/home/u");
	assert.equal(expandShellPath("~/repo", "/home/u", {}), "/home/u/repo");
});
t("$VAR and ${VAR} expand against env", () => {
	assert.equal(expandShellPath("$D/src", "/home/u", { D: "/repos/pi" }), "/repos/pi/src");
	assert.equal(expandShellPath("${D}/src", "/home/u", { D: "/repos/pi" }), "/repos/pi/src");
	assert.equal(expandShellPath("~/$D", "/home/u", { D: "x" }), "/home/u/x");
});
t("unexpandable names stay literal (resolution fails loudly)", () => {
	assert.equal(expandShellPath("$MISSING/x", "/home/u", {}), "$MISSING/x");
	assert.equal(expandShellPath("${V:-def}/x", "/home/u", {}), "${V:-def}/x");
	assert.equal(expandShellPath("~other/x", "/home/u", {}), "~other/x");
});

process.exit(failures === 0 ? 0 : 1);
