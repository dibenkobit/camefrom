import { intercept } from "./intercept";
import { report } from "./report";
import { resolve } from "./resolve";
import type { Provenance } from "./types";

export type { Hop, Provenance, RequestMeta } from "./types";

let installed = false;

/**
 * The node under the pointer, down to the individual text node.
 *
 * `event.target` would only ever name the element, which is not enough when a
 * cell holds several pieces of text and only one of them was pointed at.
 */
function nodeAt(event: MouseEvent): Node | null {
	const position = document.caretPositionFromPoint?.(
		event.clientX,
		event.clientY,
	);
	if (position) return position.offsetNode;

	// Safari has never implemented the standard one.
	const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
	if (range) return range.startContainer;

	return event.target as Node | null;
}

function listen(): void {
	if (typeof document === "undefined") return;

	document.addEventListener(
		"click",
		(event) => {
			if (!event.altKey) return;
			const found = resolve(nodeAt(event));
			if (!found) return;

			// Only once we have something to say: an alt-click that traces
			// nothing should behave like an ordinary click.
			event.preventDefault();
			event.stopPropagation();
			report(found);
		},
		// Captured, so an app that swallows clicks cannot swallow this one.
		true,
	);
}

/**
 * Start recording and watch for alt-clicks.
 *
 * Called automatically on import. Exported so it can run explicitly before
 * other libraries patch `fetch` / `XMLHttpRequest`.
 */
export function install(): void {
	if (installed) return;
	installed = true;
	intercept();
	listen();
}

/**
 * Answer "where did this come from?" for a node in the page.
 *
 * Returns `null` when the node carries no text — callers should treat that as
 * "nothing to say", never as an error. A node whose text was never read out of
 * a response comes back with `broken: true` instead.
 */
export function camefrom(target: Node | null): Provenance | null {
	return resolve(target);
}

declare global {
	interface Window {
		camefrom: typeof camefrom;
	}
}

install();

if (typeof window !== "undefined") {
	// So `camefrom($0)` works in the console without importing anything.
	window.camefrom = camefrom;
}
