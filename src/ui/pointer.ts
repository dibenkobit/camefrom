/**
 * What both paths need in order to read a pointer event: the node it landed on,
 * and whether that node is one of ours.
 *
 * Its own module because both paths need it and neither can own it: the click
 * handler lives in `devtools.ts`, which imports the hint and the panel, so
 * neither of those can import back.
 */

import { ELEMENT_NODE } from "../shared/dom";

/** What marks a host of ours. The value says which one, for whoever inspects it. */
const MARK = "data-camefrom";

/**
 * The node under the pointer, down to the individual text node.
 *
 * `event.target` would only ever name the element, which is not enough when a
 * cell holds several pieces of text and only one of them was pointed at.
 */
export function nodeAt(event: MouseEvent): Node | null {
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

/** Say that a shadow host is the tool's own, so `ours` can recognise it. */
export function own(host: Element, what: string): void {
	host.setAttribute(MARK, what);
}

/**
 * Whether the event landed on the tool's own UI.
 *
 * Our own text is never an answer: the panel holds the response body it was
 * traced out of, so tracing that body back is the tool reading its own output
 * to itself — and an alt-click on the panel would be taken from the button it
 * was aimed at, which is how `copy` and `✕` stop working.
 *
 * The composed path, not the target: a press inside a shadow root is retargeted
 * to the host on its way out, while `caretPositionFromPoint` reaches inside it
 * and names the text node itself. Only the path covers both.
 */
export function ours(event: Event): boolean {
	return event
		.composedPath()
		.some(
			(node) =>
				(node as Node).nodeType === ELEMENT_NODE &&
				(node as Element).hasAttribute(MARK),
		);
}
