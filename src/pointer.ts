/**
 * The node under the pointer, down to the individual text node.
 *
 * `event.target` would only ever name the element, which is not enough when a
 * cell holds several pieces of text and only one of them was pointed at.
 *
 * Its own module because both paths need it and neither can own it: the click
 * handler lives in `index.ts`, which imports the hint, so the hint cannot
 * import back.
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
