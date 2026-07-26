/**
 * Turning a position in a bundler's output back into the line somebody wrote.
 *
 * A stack trace carries positions in the module the browser actually loaded,
 * not in the file it came from. In a Vite dev server those two disagree by a
 * different amount on every line — the JSX transform prepends imports and wraps
 * each component — so a line read straight off a stack points at whatever
 * happens to sit there in the original file. A closing brace, usually.
 *
 * The map is the exact answer and every dev server ships one, so nothing here
 * guesses: no map, no position.
 */

import type { Frame, Position } from "./types";

const DIGITS =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Maps kept, keyed by module URL. HMR mints a new URL per edit, so bounded. */
const MAX_KEPT = 64;

/** A position as it was written, and the file it was written in. */
export interface Mapped {
	file: string;
	line: number;
	column: number;
	/** The file's own text, when the map carried it. Saves asking for it. */
	source?: string;
}

/** Where one run of generated columns came from. All values zero-based. */
interface Segment {
	column: number;
	sourceIndex: number;
	line: number;
	sourceColumn: number;
}

interface Decoded {
	/** Segments per generated line, in column order. */
	lines: Segment[][];
	/** Source paths, already resolved against the map. */
	sources: string[];
	contents: (string | undefined)[];
}

interface RawMap {
	version?: number;
	sources?: (string | null)[];
	sourcesContent?: (string | null)[];
	sourceRoot?: string;
	mappings?: string;
	sections?: unknown;
}

const value = new Map<string, number>();
for (let index = 0; index < DIGITS.length; index++) {
	value.set(DIGITS[index] as string, index);
}

/**
 * Reads one variable-length quantity, and says where it stopped.
 *
 * Base64 VLQ, little-endian in six-bit groups: the low bit of the first group
 * is the sign, the high bit of every group says whether another follows.
 */
function readVlq(text: string, from: number): [number, number] | undefined {
	let shift = 0;
	let accumulated = 0;
	let at = from;

	while (at < text.length) {
		const digit = value.get(text[at] as string);
		if (digit === undefined) return undefined;
		at++;

		accumulated += (digit & 31) << shift;
		if ((digit & 32) === 0) {
			const negative = (accumulated & 1) === 1;
			const magnitude = accumulated >> 1;
			return [negative ? -magnitude : magnitude, at];
		}
		shift += 5;
	}
	return undefined;
}

/** Decodes the mappings field. Deltas throughout, and reset per generated line. */
function decode(mappings: string): Segment[][] {
	const lines: Segment[][] = [];
	let segments: Segment[] = [];

	let sourceIndex = 0;
	let line = 0;
	let sourceColumn = 0;

	let at = 0;
	let column = 0;

	while (at < mappings.length) {
		const mark = mappings[at];

		if (mark === ";") {
			lines.push(segments);
			segments = [];
			// Only the generated column restarts on a new line; the rest carry over.
			column = 0;
			at++;
			continue;
		}
		if (mark === ",") {
			at++;
			continue;
		}

		const generated = readVlq(mappings, at);
		if (!generated) break;
		column += generated[0];
		at = generated[1];

		// A one-field segment marks generated code with no original: skipped, so
		// a lookup falls back to the nearest mapping that does name a source.
		const source = readVlq(mappings, at);
		if (!source || at >= mappings.length) {
			at = source ? source[1] : at;
			continue;
		}
		sourceIndex += source[0];
		at = source[1];

		const originalLine = readVlq(mappings, at);
		if (!originalLine) break;
		line += originalLine[0];
		at = originalLine[1];

		const originalColumn = readVlq(mappings, at);
		if (!originalColumn) break;
		sourceColumn += originalColumn[0];
		at = originalColumn[1];

		// The name index, when present, is of no interest here.
		const name = readVlq(mappings, at);
		if (name && mappings[at] !== "," && mappings[at] !== ";") at = name[1];

		segments.push({ column, sourceIndex, line, sourceColumn });
	}

	lines.push(segments);
	return lines;
}

/**
 * `atob` yields one byte per character, and a map carries the source itself —
 * so any file with a non-ASCII string in it comes back mojibake unless the
 * bytes are decoded as the UTF-8 they are.
 */
function fromBase64(payload: string): string {
	const binary = atob(payload);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** Pulls the map out of whatever the last `sourceMappingURL` comment points at. */
async function load(moduleUrl: string): Promise<Decoded | undefined> {
	const response = await fetch(moduleUrl);
	if (!response.ok) return undefined;
	const code = await response.text();

	const marker = code.lastIndexOf("sourceMappingURL=");
	if (marker === -1) return undefined;
	const target = code.slice(marker + "sourceMappingURL=".length).trim();

	let raw: RawMap;
	let base = moduleUrl;

	if (target.startsWith("data:")) {
		const comma = target.indexOf(",");
		if (comma === -1) return undefined;
		const payload = target.slice(comma + 1);
		const json = target.slice(0, comma).includes(";base64")
			? fromBase64(payload)
			: decodeURIComponent(payload);
		raw = JSON.parse(json) as RawMap;
	} else {
		base = new URL(target, moduleUrl).href;
		const beside = await fetch(base);
		if (!beside.ok) return undefined;
		raw = (await beside.json()) as RawMap;
	}

	// An index map is a different shape and nobody's dev server emits one.
	// Saying nothing beats decoding it wrongly.
	if (raw.sections || typeof raw.mappings !== "string") return undefined;

	const root = raw.sourceRoot ? `${raw.sourceRoot}/` : "";
	const sources = (raw.sources ?? []).map((source) => {
		if (!source) return "";
		try {
			return new URL(root + source, base).pathname;
		} catch {
			return source;
		}
	});

	return {
		lines: decode(raw.mappings),
		sources,
		contents: (raw.sourcesContent ?? []).map((text) => text ?? undefined),
	};
}

const kept = new Map<string, Promise<Decoded | undefined>>();

function mapFor(moduleUrl: string): Promise<Decoded | undefined> {
	const already = kept.get(moduleUrl);
	if (already) return already;

	const loading = load(moduleUrl).catch(() => undefined);
	if (kept.size >= MAX_KEPT) {
		const oldest = kept.keys().next();
		if (!oldest.done) kept.delete(oldest.value);
	}
	kept.set(moduleUrl, loading);
	return loading;
}

/**
 * Where a recorded position was written, mapped back if it has to be.
 *
 * A position React recorded through the Babel transform, or one an inspector
 * wrote on the DOM, already names the file somebody edited. One read off a
 * stack does not, and this is the only place that difference is handled.
 */
export async function written(at: Position): Promise<Mapped | undefined> {
	if (at.bundle === undefined) {
		return { file: at.file, line: at.line, column: at.column };
	}
	return mapped(at.bundle, at.line, at.column);
}

/**
 * A whole tree with every position mapped back, for callers that cannot wait
 * frame by frame — the console being the one that matters, since a chain
 * printed there is the one that gets pasted into a ticket.
 */
export async function locate(tree: readonly Frame[]): Promise<Frame[]> {
	return Promise.all(
		tree.map(async (frame) => {
			if (!frame.at) return frame;

			const original = await written(frame.at);
			return {
				...frame,
				at: original && {
					file: original.file,
					line: original.line,
					column: original.column,
				},
			};
		}),
	);
}

/** The segment covering a generated column, or the first one on that line. */
function segmentAt(segments: Segment[], column: number): Segment | undefined {
	let found: Segment | undefined;
	for (const segment of segments) {
		if (segment.column > column) break;
		found = segment;
	}
	return found ?? segments[0];
}

/**
 * Where a position in a loaded module was written.
 *
 * `undefined` when the module carries no map, or the map has nothing to say
 * about that line — both of which mean the honest answer is no position at all
 * rather than a line number that looks right and is not.
 */
export async function mapped(
	moduleUrl: string,
	line: number,
	column: number,
): Promise<Mapped | undefined> {
	const map = await mapFor(moduleUrl);
	if (!map) return undefined;

	const segments = map.lines[line - 1];
	if (!segments || segments.length === 0) return undefined;

	const segment = segmentAt(segments, column - 1);
	if (!segment) return undefined;

	const file = map.sources[segment.sourceIndex];
	if (!file) return undefined;

	return {
		file,
		line: segment.line + 1,
		column: segment.sourceColumn + 1,
		source: map.contents[segment.sourceIndex],
	};
}
