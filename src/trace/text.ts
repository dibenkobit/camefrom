import { ELEMENT_NODE, TEXT_NODE } from "../shared/dom";

/**
 * The text on screen, and what it might have been before it was rendered.
 *
 * Both halves of the question start here: what a node is actually showing, and
 * which recorded value that string could have come out of. The page around the
 * click asks the same two things of every text near it, which is why neither
 * belongs to whoever asked first.
 */

/** The text a node shows itself, without sweeping up everything below it. */
export function textOf(node: Node): string {
	if (node.nodeType === TEXT_NODE) return (node as Text).data;
	if (node.nodeType !== ELEMENT_NODE) return "";

	let direct = "";
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === TEXT_NODE) direct += (child as Text).data;
	}
	return direct.trim() === "" ? (node.textContent ?? "") : direct;
}

/**
 * What the text on screen might have been before it was rendered. A cell
 * showing `42` was a number in the response, not the string it is now.
 */
export function* candidates(text: string): Generator<unknown> {
	const trimmed = text.trim();
	yield trimmed;
	if (trimmed !== text) yield text;
	if (trimmed !== "") {
		const asNumber = Number(trimmed);
		if (Number.isFinite(asNumber)) yield asNumber;
	}
}
