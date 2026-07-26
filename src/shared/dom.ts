/**
 * The two node types this package ever asks about, and the step every path
 * takes before it can ask anything else.
 *
 * Everything here starts from a node the pointer landed on, and the interesting
 * questions — which fiber is this, where is its box, what did it render — are
 * only ever answerable of an element. A text node has to be turned into its
 * parent first, and that one line was written out four times before it was
 * given a name.
 */

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

/** The node itself when it is an element, otherwise the element holding it. */
export function elementOf(node: Node): Element | null {
	return node.nodeType === ELEMENT_NODE
		? (node as Element)
		: node.parentElement;
}
