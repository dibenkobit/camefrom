import { describe, expect, test } from "bun:test";
import { print, type Token } from "./json";

const body = {
	items: [{ status: "Активен" }, { status: "Активен" }],
	total: 2,
};

/** A printed line back as the text it draws, for comparing against JSON. */
function textOf(line: readonly Token[] | undefined): string {
	return (line ?? []).map((token) => token.text).join("");
}

function whole(value: unknown): string {
	return print(value).lines.map(textOf).join("\n");
}

function lineAt(value: unknown, path: string): string | undefined {
	const printed = print(value);
	const line = printed.lineOfPath.get(path);
	return line === undefined ? undefined : textOf(printed.lines[line]);
}

/** Every token on the line a path landed on, as `kind:text` pairs. */
function tokensAt(value: unknown, path: string): string[] {
	const printed = print(value);
	const line = printed.lineOfPath.get(path);
	return (line === undefined ? [] : (printed.lines[line] ?? [])).map(
		(token) => `${token.kind}:${token.text}`,
	);
}

describe("print", () => {
	test("stays valid JSON", () => {
		expect(JSON.parse(whole(body))).toEqual(body);
	});

	test("points a path at the line that holds it", () => {
		expect(lineAt(body, "total")?.trim()).toBe('"total": 2');
	});

	test("tells identical values on different paths apart", () => {
		const first = print(body).lineOfPath.get("items[0].status");
		const second = print(body).lineOfPath.get("items[1].status");
		expect(first).not.toBe(second);
		expect(lineAt(body, "items[1].status")?.trim()).toBe('"status": "Активен"');
	});

	test("maps containers as well as leaves", () => {
		expect(lineAt(body, "items")?.trim()).toBe('"items": [');
	});

	test("survives a body that is not an object", () => {
		expect(whole(42)).toBe("42");
		expect(whole(null)).toBe("null");
	});
});

/**
 * The colours are the walk's own knowledge, not a second guess at finished text.
 * That is the whole reason to print it here, so it is worth pinning: a key and a
 * string that read the same are two different things, and `"1985"` is neither a
 * number nor a key.
 */
describe("what each piece is", () => {
	test("separates the key from the value it holds", () => {
		expect(tokensAt({ name: "Барыс" }, "name")).toEqual([
			"punctuation:  ",
			'key:"name"',
			"punctuation:: ",
			'string:"Барыс"',
		]);
	});

	test("keeps a numeric string a string", () => {
		expect(tokensAt({ year: "1985" }, "year")).toContain('string:"1985"');
		expect(tokensAt({ year: 1985 }, "year")).toContain("number:1985");
	});

	test("names the three things that print without quotes", () => {
		expect(tokensAt({ a: true }, "a")).toContain("boolean:true");
		expect(tokensAt({ a: null }, "a")).toContain("null:null");
		// No JSON form at all, and a body handed to `camefrom($0)` by hand can hold
		// one. Printing nothing there would be a line the reader cannot account for.
		expect(tokensAt({ a: undefined }, "a")).toContain("null:undefined");
	});
});
