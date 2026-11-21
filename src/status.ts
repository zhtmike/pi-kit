/**
 * The one footer status line ("pi-kit"), shared by the extensions — parts
 * merge in registration order, last write wins per part. Same-module state:
 * one package, one jiti instance.
 */

let sink: ((line: string | undefined) => void) | null = null;
const parts = new Map<string, string>();

function flush(): void {
	if (sink === null) return;
	if (parts.size === 0) {
		sink(undefined);
		return;
	}
	sink([...parts.values()].join(" · "));
}

/** Bind the writer (a ctx.ui.setStatus wrapper captured at session_start). */
export function bindStatusSink(fn: ((line: string | undefined) => void) | null): void {
	sink = fn;
	flush();
}

/** Set or clear one part of the footer line (undefined clears). */
export function setStatusPart(key: string, text: string | undefined): void {
	if (text === undefined || text === "") parts.delete(key);
	else parts.set(key, text);
	flush();
}
