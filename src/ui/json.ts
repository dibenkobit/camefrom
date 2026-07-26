/**
 * Pretty-prints a response body, remembers which line each path landed on, and
 * says what every piece of it is.
 *
 * `JSON.stringify` plus a text search would be shorter and would pick the wrong
 * line the moment two fields hold the same value — which, in a table, is most of
 * the time. Printing it ourselves is the only way to be exact.
 *
 * Printing it ourselves is also why the colours are exact and not a guess. A
 * highlighter handed finished text has to work out what a run of characters
 * meant, and gets `"1985"` wrong twice — once as a number, once as a key. Here
 * the walk already knows: it is holding the value.
 *
 * The paths come out of `childPath`, the same function the recorder writes them
 * with, and not a second copy of the convention: what the panel is asked for is
 * a path the recorder produced, so the two agreeing is what makes the lookup
 * work at all. A copy that drifted would not fail — it would mark a line, and
 * the wrong one.
 */
import { childPath } from "../shared/path";

/** What a piece of printed JSON is, which is what decides its colour. */
export type Kind =
	| "key"
	| "string"
	| "number"
	| "boolean"
	| "null"
	| "punctuation";

export interface Token {
	kind: Kind;
	text: string;
}

export interface PrintedJson {
	/** One entry per line, in order. */
	lines: Token[][];
	/** Which line a path was printed on, counted from zero. */
	lineOfPath: Map<string, number>;
}

const INDENT = "  ";

function punctuation(text: string): Token {
	return { kind: "punctuation", text };
}

/** A value that prints on one line, as itself rather than as a guess at itself. */
function leaf(node: unknown): Token {
	// `undefined` has no JSON form, and a body that came out of `JSON.parse` has
	// none in it — but one built by hand and handed to `camefrom($0)` might.
	const text = JSON.stringify(node) ?? "undefined";
	if (typeof node === "string") return { kind: "string", text };
	if (typeof node === "number" && text !== "null")
		return { kind: "number", text };
	if (typeof node === "boolean") return { kind: "boolean", text };
	return { kind: "null", text };
}

export function print(value: unknown): PrintedJson {
	const lines: Token[][] = [];
	const lineOfPath = new Map<string, number>();

	const write = (tokens: Token[], path?: string): void => {
		if (path !== undefined) lineOfPath.set(path, lines.length);
		// The indent at depth zero and the comma after a last entry are both empty,
		// and an empty token is an empty element in the panel.
		lines.push(tokens.filter((token) => token.text !== ""));
	};

	const walk = (
		node: unknown,
		path: string,
		depth: number,
		prefix: Token[],
		comma: string,
	): void => {
		const pad = punctuation(INDENT.repeat(depth));

		if (Array.isArray(node)) {
			write([pad, ...prefix, punctuation("[")], path);
			node.forEach((item, index) => {
				walk(
					item,
					childPath(path, String(index), true),
					depth + 1,
					[],
					index === node.length - 1 ? "" : ",",
				);
			});
			write([pad, punctuation(`]${comma}`)]);
			return;
		}

		if (node !== null && typeof node === "object") {
			const entries = Object.entries(node);
			write([pad, ...prefix, punctuation("{")], path);
			entries.forEach(([key, item], index) => {
				walk(
					item,
					childPath(path, key, false),
					depth + 1,
					[{ kind: "key", text: JSON.stringify(key) }, punctuation(": ")],
					index === entries.length - 1 ? "" : ",",
				);
			});
			write([pad, punctuation(`}${comma}`)]);
			return;
		}

		write([pad, ...prefix, leaf(node), punctuation(comma)], path);
	};

	walk(value, "", 0, [], "");
	return { lines, lineOfPath };
}
