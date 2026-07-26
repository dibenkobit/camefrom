import type { Mapped } from "./sourcemap";

export interface Excerpt {
	/** Source lines around the target, in order. */
	lines: string[];
	/** One-based number of the first line in `lines`. */
	first: number;
	/**
	 * One-based, inclusive line range the chain points at.
	 *
	 * The whole element, not the line its tag opens on: a `<p>` written over
	 * three lines is one thing, and marking a third of it invites reading the
	 * two lines below as something else's.
	 */
	target: { from: number; to: number };
	/**
	 * The line the element closes on, when that is below the last one shown.
	 *
	 * Set only when the excerpt was cut short, and it is the whole reason the
	 * cut can be admitted to: a mark running off the bottom edge of an excerpt
	 * looks exactly like an element that ends there, and the reader who takes it
	 * for one goes looking for the rest of their component in the wrong file.
	 */
	closes?: number;
}

/** Enough of a position to cut an excerpt at; the file has already been read. */
export interface Place {
	line: number;
	/** One-based, and a hint only — see `closesAt`. */
	column?: number;
}

/**
 * Pulls file content out of what a dev server answers for `?raw`.
 *
 * Vite replies with a module whose default export is the file as one JSON
 * string, so the literal can be matched exactly rather than guessed at. A
 * different server answers something else, and the caller shows nothing.
 */
export function extract(moduleText: string): string | undefined {
	const match = /export default\s+("(?:[^"\\]|\\.)*")/.exec(moduleText);
	if (!match?.[1]) return undefined;
	try {
		return JSON.parse(match[1]) as string;
	} catch {
		return undefined;
	}
}

/** Both shapes an inspector might have written: rooted, or absolute on disk. */
function urlsFor(file: string): string[] {
	return file.startsWith("/")
		? [`/@fs${file}?raw`, `${file}?raw`]
		: [`/${file}?raw`, `/@fs/${file}?raw`];
}

async function read(file: string): Promise<string | undefined> {
	for (const url of urlsFor(file)) {
		try {
			const response = await fetch(url);
			if (!response.ok) continue;
			const source = extract(await response.text());
			if (source !== undefined) return source;
		} catch {
			// Try the next shape; a dead end here just means no excerpt.
		}
	}
	return undefined;
}

/** Index just past the quote that closes the string opening at `at`. */
function pastString(source: string, at: number): number {
	const quote = source[at];
	for (let i = at + 1; i < source.length; i++) {
		const char = source[i];
		if (char === "\\") {
			i++;
			continue;
		}
		// A template can hold anything, including the tags we are counting, so
		// its holes are stepped over as the expressions they are.
		if (quote === "`" && char === "$" && source[i + 1] === "{") {
			i = pastBraces(source, i + 1) - 1;
			continue;
		}
		if (char === quote) return i + 1;
	}
	return source.length;
}

/** Index just past the `}` that closes the brace opening at `at`. */
function pastBraces(source: string, at: number): number {
	let depth = 0;
	for (let i = at; i < source.length; i++) {
		const char = source[i];
		if (char === "'" || char === '"' || char === "`") {
			i = pastString(source, i) - 1;
			continue;
		}
		if (char === "/" && source[i + 1] === "/") {
			const line = source.indexOf("\n", i);
			if (line === -1) return source.length;
			i = line;
			continue;
		}
		if (char === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			if (end === -1) return source.length;
			i = end + 1;
			continue;
		}
		if (char === "{") depth++;
		else if (char === "}" && --depth === 0) return i + 1;
	}
	return source.length;
}

/**
 * Where the tag opening at `at` ends, and whether it left the element open.
 *
 * Quotes and braces are stepped over rather than read, which is all it takes:
 * a `>` only ever closes the tag when it is not inside one of them.
 */
function pastTag(source: string, at: number): { end: number; open: boolean } {
	for (let i = at + 1; i < source.length; i++) {
		const char = source[i];
		if (char === "'" || char === '"' || char === "`") {
			i = pastString(source, i) - 1;
			continue;
		}
		if (char === "{") {
			i = pastBraces(source, i) - 1;
			continue;
		}
		if (char === ">") return { end: i + 1, open: source[i - 1] !== "/" };
	}
	return { end: source.length, open: false };
}

/** Index the one-based `line` starts at, or `undefined` past the last one. */
function startOf(source: string, line: number): number | undefined {
	if (line < 1) return undefined;
	let at = 0;
	for (let n = 1; n < line; n++) {
		const end = source.indexOf("\n", at);
		if (end === -1) return undefined;
		at = end + 1;
	}
	return at;
}

/** The one-based line an index falls on. */
function lineOf(source: string, index: number): number {
	let line = 1;
	for (let at = 0; at < index; at++) if (source[at] === "\n") line++;
	return line;
}

/** The `<` a position names: the recorded column, or the line's first tag. */
function tagOn(source: string, at: Place): number | undefined {
	const from = startOf(source, at.line);
	if (from === undefined) return undefined;

	const end = source.indexOf("\n", from);
	const stop = end === -1 ? source.length : end;

	// The column is worth trusting only when it lands on a tag: what a bundler
	// maps a `jsx()` call back to is its own business, and it is regularly the
	// name rather than the bracket.
	if (at.column !== undefined) {
		const hinted = from + at.column - 1;
		if (hinted < stop && source[hinted] === "<") return hinted;
	}

	const first = source.slice(from, stop).indexOf("<");
	return first === -1 ? undefined : from + first;
}

/**
 * The line the element at a position closes on, counting nested tags of the
 * same name — its own line when it fits on one, or when the source is not the
 * JSX we take it for. Falling back to the one line we were told about is the
 * honest answer; guessing a range is not. Pure, so it is tested.
 */
export function closesAt(source: string, at: Place): number {
	const start = tagOn(source, at);
	if (start === undefined) return at.line;

	const opened = pastTag(source, start);
	if (!opened.open) return lineOf(source, opened.end - 1);

	let depth = 1;
	let i = opened.end;
	while (i < source.length) {
		const char = source[i];
		// Children are text until a brace or a bracket: a `<` in an expression
		// is a comparison, and this is the only place that can tell them apart.
		if (char === "{") {
			i = pastBraces(source, i);
			continue;
		}
		if (char !== "<") {
			i++;
			continue;
		}

		const tag = pastTag(source, i);
		if (source[i + 1] === "/") {
			if (--depth === 0) return lineOf(source, tag.end - 1);
		} else if (tag.open) depth++;
		i = tag.end;
	}

	return at.line;
}

/**
 * The most lines an excerpt may carry.
 *
 * Room for any element written to be read in one go, and a stop short of the
 * file a page component's root `<div>` would otherwise drag in whole.
 */
const LIMIT = 40;

/**
 * Splits an excerpt around an element, clamped to the file. Pure, so it is
 * tested.
 *
 * The window is measured from the element rather than from the one line its tag
 * opens on: a `<Comp>` with its props on four lines of their own closes below
 * anything a radius around the opening line reaches, and an excerpt that stops
 * mid-prop list is asking the reader to guess the rest.
 */
export function around(source: string, at: Place, radius: number): Excerpt {
	const all = source.split("\n");
	const closes = closesAt(source, at);
	const first = Math.max(1, at.line - radius);
	// The same context under the element as over it. The line a tag opens on
	// says what is being rendered; the one it closes on is what says where that
	// stops, and the lines after it are what it sits next to.
	const last = Math.min(all.length, closes + radius, first + LIMIT - 1);
	return {
		lines: all.slice(first - 1, last),
		first,
		target: { from: at.line, to: Math.min(closes, last) },
		...(closes > last ? { closes } : {}),
	};
}

/**
 * The lines around a written position.
 *
 * A source map usually carries the file it maps, so most of the time there is
 * nothing to ask anybody for. The `?raw` request is the fallback, and it is why
 * this used to work under Vite and nowhere else.
 */
export async function excerptOf(
	where: Mapped,
	radius = 4,
): Promise<Excerpt | undefined> {
	const source = where.source ?? (await read(where.file));
	return source === undefined ? undefined : around(source, where, radius);
}
