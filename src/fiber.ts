import { callSite, untracked } from "./stack";
import type { Frame, Position } from "./types";

/**
 * What React leaves lying around in a development build, and how to read it.
 *
 * All of it is internal and none of it is promised, which is why every field is
 * optional here and every absence has an answer. In exchange we get the render
 * tree and the exact line of every element in it without asking the project to
 * install a plugin — and a dev tool that needs a build step is a dev tool that
 * does not get used.
 */

const ELEMENT_NODE = 1;

/** How far up a tree we will walk. Deep enough for any real app. */
const MAX_FRAMES = 24;

/** Attributes written by source inspectors. Ours first, then TanStack's. */
const SOURCE_ATTRIBUTES = ["data-camefrom-source", "data-tsd-source"];

/** The little of a React fiber we need. */
export interface Fiber {
	return: Fiber | null;
	type?: unknown;
	elementType?: unknown;
	memoizedProps?: unknown;
	/** React 19: an `Error` captured where this element's JSX was written. */
	_debugStack?: unknown;
	/** React 16 to 18: what the Babel transform recorded, when it ran. */
	_debugSource?: {
		fileName?: string;
		lineNumber?: number;
		columnNumber?: number;
	};
	/** The fiber whose render created this element. Present in development. */
	_debugOwner?: Fiber | null;
}

export function elementOf(node: Node): Element | null {
	return node.nodeType === ELEMENT_NODE
		? (node as Element)
		: node.parentElement;
}

function fiberOf(element: Element): Fiber | undefined {
	for (const key of Object.keys(element)) {
		if (key.startsWith("__reactFiber$")) {
			return (element as unknown as Record<string, Fiber>)[key];
		}
	}
	return undefined;
}

/** The fiber for this node, or for the nearest ancestor React rendered. */
export function nearestFiber(node: Node): Fiber | undefined {
	let element = elementOf(node);
	while (element) {
		const fiber = fiberOf(element);
		if (fiber) return fiber;
		element = element.parentElement;
	}
	return undefined;
}

/** Unwraps `memo`, `forwardRef` and the like to whatever has a name. */
function nameOf(type: unknown, depth = 0): string | undefined {
	if (typeof type === "string") return type;
	if (depth > 4) return undefined;

	if (typeof type === "function") {
		const named = type as { displayName?: string; name?: string };
		return named.displayName ?? (named.name || undefined);
	}

	if (typeof type === "object" && type !== null) {
		const wrapper = type as {
			displayName?: string;
			render?: unknown;
			type?: unknown;
		};
		return (
			wrapper.displayName ??
			nameOf(wrapper.render, depth + 1) ??
			nameOf(wrapper.type, depth + 1)
		);
	}
	return undefined;
}

/** Where this element's JSX is written, if React recorded it either way. */
function positionOf(fiber: Fiber): Position | undefined {
	const source = fiber._debugSource;
	if (source?.fileName && source.lineNumber !== undefined) {
		return {
			file: source.fileName,
			line: source.lineNumber,
			column: source.columnNumber ?? 0,
		};
	}

	// Duck-typed rather than `instanceof Error`: an app with two realms — an
	// iframe, a portal into one — throws Errors that fail the check.
	const stack = stackOf(fiber);
	return typeof stack === "string" ? callSite(stack) : undefined;
}

function stackOf(fiber: Fiber): unknown {
	return (fiber._debugStack as { stack?: unknown } | undefined)?.stack;
}

/**
 * Why this element has no position, as far as can be told from here.
 *
 * Nothing is guessed: each answer comes from something observable — the shared
 * placeholder React substitutes once it stops recording, a stack with no frame
 * of the app's own in it, or no debug field at all. The last of those cannot be
 * explained any further from outside the engine, so the stack itself is carried
 * along to be read.
 */
function unexplained(fiber: Fiber): Pick<Frame, "missing" | "stack"> {
	const stack = stackOf(fiber);
	if (typeof stack !== "string") return { missing: "unrecorded" };
	if (untracked(stack)) return { missing: "untracked" };
	return { missing: "inlined", stack };
}

/** What an inspector wrote on the DOM, for when React recorded nothing. */
export function attributeOf(node: Node): Position | undefined {
	const element = elementOf(node);
	if (!element) return undefined;

	for (const attribute of SOURCE_ATTRIBUTES) {
		const raw = element.closest(`[${attribute}]`)?.getAttribute(attribute);
		if (!raw) continue;

		const match = /^(.+):(\d+):(\d+)$/.exec(raw);
		if (match?.[1]) {
			return {
				file: match[1],
				line: Number(match[2]),
				column: Number(match[3]),
			};
		}
		return { file: raw, line: 0, column: 0 };
	}
	return undefined;
}

/**
 * Every fiber that had a hand in this one, nearest first.
 *
 * The owner chain, not the parent chain: it names who *wrote* the element, and
 * so who owns the line of code you want opened. `<Page/>` passed as `children`
 * belongs to the file that wrote it, not to the `<Layout>` it landed in.
 */
function chainOf(fiber: Fiber): Fiber[] {
	// The field exists and is null at the root; missing means a build without
	// React's development fields, where the parent chain is all there is.
	const owners = "_debugOwner" in fiber;
	const chain: Fiber[] = [];

	let current: Fiber | undefined = fiber;
	while (current && chain.length < MAX_FRAMES) {
		chain.push(current);
		current = (owners ? current._debugOwner : current.return) ?? undefined;
	}
	return chain;
}

/**
 * The components that rendered a node, outermost first.
 *
 * The innermost frame is the host element itself, whose recorded position is
 * the JSX that produced the text — the most precise line there is.
 */
export function treeOf(fiber: Fiber | undefined): Frame[] {
	if (!fiber) return [];

	const frames: Frame[] = [];
	for (const current of chainOf(fiber)) {
		const name = nameOf(current.type ?? current.elementType);
		if (!name) continue;

		// Host elements above the one that was pointed at are layout, not
		// authorship, and they crowd out the components worth reading.
		if (frames.length > 0 && typeof current.type === "string") continue;

		const at = positionOf(current);
		frames.push({
			name,
			at,
			target: frames.length === 0,
			...(at ? {} : unexplained(current)),
		});
	}
	return frames.reverse();
}

/**
 * Whether a position names a file the project installed rather than wrote.
 *
 * The path as the browser loaded it, which is why this can be asked before any
 * source map has been fetched — and answers the same afterwards, since a
 * dependency's map names sources inside the dependency.
 */
function installed(at: Position): boolean {
	return at.file.includes("/node_modules/");
}

/**
 * The innermost frame that knows where it is, in code the project wrote.
 *
 * The frame itself rather than its position, because it is often not the frame
 * that was pointed at — React stops recording positions after ten thousand
 * elements — and an excerpt from someone else's component has to say whose it
 * is. Presenting it as the line that rendered the text is how a closing brace
 * comes to look like the answer.
 *
 * A dependency's own line is stepped over rather than taken. React Router
 * writes the `<a>` behind every `<Link>`, MUI writes the `<button>`: the most
 * precise line there is belongs to a file nobody here can edit, and offering it
 * answers a question no one asked. The innermost of them is kept as the
 * fallback, because a line inside a library still beats an empty box — and the
 * excerpt says which file it is from either way.
 */
export function innermost(tree: readonly Frame[]): Frame | undefined {
	let dependency: Frame | undefined;

	for (let index = tree.length - 1; index >= 0; index--) {
		const frame = tree[index];
		if (!frame?.at || frame.at.line <= 0) continue;
		if (!installed(frame.at)) return frame;
		dependency ??= frame;
	}
	return dependency;
}
