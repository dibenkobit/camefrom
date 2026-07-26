import type { Position } from "./types";

/**
 * Where a piece of JSX is written, read out of the stack React captured there.
 *
 * React 19 hangs an `Error` off every element, thrown away nowhere: the frame
 * under the JSX runtime is the line of the app that wrote the element. That is
 * the file and line a developer wants, and it needs no Babel plugin, no source
 * attribute and no build step — which is the whole point of this package.
 *
 * Pure, and the fiddliest thing here, because every engine writes a frame
 * differently and getting it wrong points the editor at someone else's file.
 */

/** React truncates its own owner stacks here, and so do we. */
const BOTTOM = "react_stack_bottom_frame";

/** Frames belonging to React rather than to the app that called it. */
const REACT = /react[-_]jsx|react\/jsx|react-dom|\/node_modules\/react\//;

/** The placeholder React shares out once it has stopped recording. */
const UNTRACKED = "UnknownOwner";

/**
 * Whether React had given up recording positions before this element was made.
 *
 * It records the call site of the first ten thousand elements and then hands
 * every one after that the same placeholder stack. The counter is only ever
 * incremented — nothing resets it — so in a session of any length most elements
 * have no position of their own, and a table that re-renders spends the budget
 * in seconds. Telling this apart from the other kinds of silence is what turns
 * "the tool is broken" into "reload the page".
 */
export function untracked(stack: string): boolean {
	return stack.includes(UNTRACKED);
}

/** Turns whatever an engine wrote into a path a dev server can be asked for. */
export function fileOf(url: string): string | undefined {
	let path = url;

	if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
		try {
			path = new URL(path).pathname;
		} catch {
			return undefined;
		}
	}

	// Vite hangs a cache-busting query off module URLs.
	const query = path.indexOf("?");
	if (query !== -1) path = path.slice(0, query);

	// `/@fs/…` is how Vite serves a file from outside the project root.
	if (path.startsWith("/@fs/")) path = path.slice(4);

	// Anything else is `native`, `[native code]` or an eval wrapper: no file.
	return path.startsWith("/") ? path : undefined;
}

/**
 * The location V8 wraps in parentheses when it also names the function.
 *
 * Balanced from the end rather than read as "brackets with nothing bracketed
 * inside them": a route group is a directory literally called `(table)`, and a
 * URL carrying one used to fail the match and take the whole frame with it. The
 * component's own line was the frame lost, so the panel stopped at its caller.
 */
function parenthesised(text: string): string | undefined {
	if (!text.endsWith(")")) return undefined;

	let depth = 0;
	for (let at = text.length - 1; at >= 0; at--) {
		const character = text[at];
		if (character === ")") depth++;
		else if (character === "(") {
			depth--;
			if (depth === 0) return text.slice(at + 1, -1);
		}
	}
	return undefined;
}

/** One frame, in any of the three shapes a browser might have written it. */
function frameOf(line: string): Position | undefined {
	const text = line.trim();
	let location = parenthesised(text);

	if (location === undefined) {
		// `at url:line:column` in V8, `name@url:line:column` everywhere else.
		const at = text.startsWith("at ") ? text.slice(3) : text;
		// The first `@`, not the last: a function name never carries one and a
		// URL routinely does. `/@fs/…` is how Vite serves a file from outside the
		// project root, and `@scope/name` is most of `node_modules`.
		const marker = at.indexOf("@");
		location = marker === -1 ? at : at.slice(marker + 1);
	}

	const match = /^(.*):(\d+):(\d+)$/.exec(location);
	if (!match?.[1]) return undefined;

	const file = fileOf(match[1]);
	return file === undefined
		? undefined
		: {
				file,
				line: Number(match[2]),
				column: Number(match[3]),
				// The module as loaded, kept whole: the query a dev server hangs off
				// it is part of the address its source map lives at.
				bundle: match[1],
			};
}

/**
 * The app's own call site in a captured stack, or nothing.
 *
 * Nothing is a real answer: an engine that inlines a frame away, or a
 * component whose whole body is a `return`, leaves React with an empty owner
 * stack too, and inventing the next frame down would name the wrong file.
 */
export function callSite(stack: string): Position | undefined {
	const frames: Array<{ text: string; position: Position }> = [];

	for (const line of stack.split("\n")) {
		if (line.includes(BOTTOM)) break;
		const position = frameOf(line);
		if (position) frames.push({ text: line, position });
	}

	// The first frame is inside the JSX runtime that captured the stack; the
	// one after it belongs to whoever wrote the element.
	for (const frame of frames.slice(1)) {
		if (!REACT.test(frame.text)) return frame.position;
	}
	return undefined;
}
