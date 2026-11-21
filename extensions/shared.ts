/**
 * Helpers shared by the extension files (host-adjacent; not in the manifest —
 * pi loads only manifest-listed extension files).
 */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * `Type.Unsafe` keeps the literal-union typing that `defineTool`'s TypeBox
 * inference reads; the emitted `{ type: "string", enum: [...] }` matches
 * pi-ai's `StringEnum`.
 */
export function stringEnum<T extends readonly string[]>(values: T, options?: { description?: string }) {
	return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...(options?.description ? { description: options.description } : {}) });
}

export function ok(text: string, details: any = {}): AgentToolResult {
	return { content: [{ type: "text", text }], details };
}

/**
 * The init fence: block everything gated naming the error, then
 * abort — ctx.shutdown() in TUI/RPC (deferred until idle; the handler is the
 * fence meanwhile), process.exit(1) in print/JSON (the runner's default
 * shutdown handler is empty; buffered stdout may be lost — accepted).
 */
export function fenceOff(pi: ExtensionAPI, msg: string): void {
	pi.on("tool_call", async () => ({
		block: true,
		reason: `pi-kit is not running — invalid config: ${msg}. Fix the file and restart; every gated operation blocks until then.`,
	}));
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui" || ctx.mode === "rpc") ctx.shutdown();
		else process.exit(1);
	});
}
