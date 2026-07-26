/**
 * Enough of a lexer to colour an excerpt of somebody's component.
 *
 * Nine lines of grey monospace is the same picture whether it is the line that
 * rendered the value or the middle of an import block, and the reader has to
 * find the JSX by reading it. Colour is what makes an excerpt scannable, and this
 * is the smallest thing that gets strings, comments, keywords and tags right.
 *
 * It is a lexer, not a parser, and it does not pretend otherwise: a regex
 * literal comes out plain, and an apostrophe in JSX text only opens a string if
 * another one closes it on the same line — which is the rule JavaScript itself
 * applies to quotes. Where it cannot tell, it leaves the text alone rather than
 * colouring it wrongly, because a `return` painted as a string is a claim about
 * the code that is simply false.
 */

/** What a piece of source is, which is what decides its colour. */
export type Kind =
	| "comment"
	| "string"
	| "keyword"
	| "number"
	| "tag"
	| "plain";

export interface Token {
	kind: Kind;
	text: string;
}

/**
 * Words worth their own colour: what steers the code rather than what it names.
 * TypeScript's own included, since the excerpt is regularly a `.tsx`.
 */
const KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"from",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"of",
	"private",
	"protected",
	"public",
	"readonly",
	"return",
	"satisfies",
	"static",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"var",
	"void",
	"while",
	"yield",
]);

const STARTS_WORD = /[A-Za-z_$]/;
const IN_WORD = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const IN_NUMBER = /[0-9a-fA-FxXoObBeE._]/;

/**
 * Where the string opening at `at` ends, or `undefined` if it never does.
 *
 * A quote with no partner on its line is an apostrophe in prose — `It's` in JSX
 * text, most often — and JavaScript agrees: only a template literal may cross a
 * newline. Answering `undefined` is what keeps half a component from being
 * painted as a string.
 */
function pastString(source: string, at: number): number | undefined {
	const quote = source[at];
	for (let index = at + 1; index < source.length; index++) {
		const char = source[index];
		if (char === "\\") {
			index++;
			continue;
		}
		if (char === quote) return index + 1;
		if (char === "\n" && quote !== "`") return undefined;
	}
	return quote === "`" ? source.length : undefined;
}

function scan(source: string): Token[] {
	const tokens: Token[] = [];
	let plain = "";

	const flush = (): void => {
		if (plain !== "") {
			tokens.push({ kind: "plain", text: plain });
			plain = "";
		}
	};
	const push = (kind: Kind, text: string): void => {
		// Plain joins the run it belongs to rather than becoming a token of its own:
		// every identifier in a file is plain, and one element per identifier is
		// three times the nodes for a line that draws identically either way.
		if (kind === "plain") {
			plain += text;
			return;
		}
		flush();
		tokens.push({ kind, text });
	};

	/** Set by a `<` or `</`: whatever word comes next is a tag name. */
	let naming = false;
	let at = 0;

	while (at < source.length) {
		const char = source[at] as string;
		const next = source[at + 1];

		if (char === "/" && next === "/") {
			const end = source.indexOf("\n", at);
			const stop = end === -1 ? source.length : end;
			push("comment", source.slice(at, stop));
			at = stop;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", at + 2);
			const stop = end === -1 ? source.length : end + 2;
			push("comment", source.slice(at, stop));
			at = stop;
			continue;
		}

		if (char === "'" || char === '"' || char === "`") {
			const stop = pastString(source, at);
			if (stop !== undefined) {
				push("string", source.slice(at, stop));
				at = stop;
				continue;
			}
		}

		if (DIGIT.test(char)) {
			let stop = at + 1;
			while (stop < source.length && IN_NUMBER.test(source[stop] as string))
				stop++;
			push("number", source.slice(at, stop));
			at = stop;
			continue;
		}

		if (STARTS_WORD.test(char)) {
			let stop = at + 1;
			while (stop < source.length && IN_WORD.test(source[stop] as string))
				stop++;
			const word = source.slice(at, stop);
			push(naming ? "tag" : KEYWORDS.has(word) ? "keyword" : "plain", word);
			naming = false;
			at = stop;
			continue;
		}

		// `<div`, `</div` — and not `a < b`, which has a space where a tag has a
		// name. A `<` in an expression comes out plain, along with the comparison.
		if (char === "<" && (next === "/" || STARTS_WORD.test(next ?? ""))) {
			naming = true;
		}
		plain += char;
		at++;
	}

	flush();
	return tokens;
}

/**
 * The same lines back, each as coloured pieces.
 *
 * Lexed whole rather than line by line, because a block comment and a template
 * literal both outlive the line they start on. The excerpt is still only a window
 * into the file, so a comment that opened above it reads as code — the honest
 * limit of colouring nine lines out of the middle of a module.
 */
export function highlight(lines: readonly string[]): Token[][] {
	const rows: Token[][] = [[]];

	for (const token of scan(lines.join("\n"))) {
		token.text.split("\n").forEach((text, index) => {
			if (index > 0) rows.push([]);
			if (text !== "") rows[rows.length - 1]?.push({ kind: token.kind, text });
		});
	}
	return rows;
}
