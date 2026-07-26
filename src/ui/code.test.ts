import { describe, expect, test } from "bun:test";
import { highlight } from "./code";

/** One line as `kind:text` pairs, which is what the panel turns into spans. */
function pieces(...lines: string[]): string[][] {
	return highlight(lines).map((row) =>
		row.map((token) => `${token.kind}:${token.text}`),
	);
}

/** Only the coloured pieces, for lines whose plain runs are not the point. */
function coloured(line: string): string[] {
	return (pieces(line)[0] ?? []).filter((piece) => !piece.startsWith("plain:"));
}

describe("highlight", () => {
	test("gives back exactly the lines it was given", () => {
		expect(pieces("const a = 1", "", "return a")).toHaveLength(3);
	});

	test("keeps every character, so nothing is lost to colouring it", () => {
		const line = '  return <td className="cell">{format(total)}</td>';
		expect(
			(pieces(line)[0] ?? [])
				.map((piece) => piece.split(":").slice(1).join(":"))
				.join(""),
		).toBe(line);
	});

	test("separates what steers the code from what it names", () => {
		expect(coloured("const total = 42")).toEqual([
			"keyword:const",
			"number:42",
		]);
	});

	test("colours a tag by its name, on both sides of the element", () => {
		expect(coloured("<Row>text</Row>")).toEqual(["tag:Row", "tag:Row"]);
	});

	test("leaves a comparison alone, having no name after the bracket", () => {
		expect(coloured("if (a < b) {")).toEqual(["keyword:if"]);
	});

	test("takes a comment to the end of its line and no further", () => {
		expect(pieces("a // why", "b")).toEqual([
			["plain:a ", "comment:// why"],
			["plain:b"],
		]);
	});

	test("carries a block comment across the lines it spans", () => {
		expect(pieces("/* one", "   two */ a")).toEqual([
			["comment:/* one"],
			["comment:   two */", "plain: a"],
		]);
	});

	/**
	 * The failure that makes a naive highlighter worse than none: an apostrophe in
	 * text opens a string, and everything to the end of the excerpt comes out
	 * quoted — including the `return` the reader is looking for. A quote with no
	 * partner on its line is not a string, which is the rule JavaScript itself
	 * applies.
	 */
	test("does not let an apostrophe in text swallow the code after it", () => {
		const rows = pieces("<p>It's here</p>", "return null");

		expect(rows[0]?.some((piece) => piece.startsWith("string:"))).toBe(false);
		expect(rows[1]).toEqual(["keyword:return", "plain: ", "keyword:null"]);
	});

	test("keeps a template literal whole across its lines", () => {
		expect(pieces("const a = `one", "two`")).toEqual([
			["keyword:const", "plain: a = ", "string:`one"],
			["string:two`"],
		]);
	});
});
