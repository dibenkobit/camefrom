import { describe, expect, test } from "bun:test";
import { around, closesAt, extract } from "./source";

describe("extract", () => {
	test("reads the file out of a Vite ?raw module", () => {
		const module = 'export default "const a = 1;\\nconst b = 2;\\n"';
		expect(extract(module)).toBe("const a = 1;\nconst b = 2;\n");
	});

	test("keeps quotes and backslashes intact", () => {
		expect(extract('export default "say \\"hi\\" \\\\ done"')).toBe(
			'say "hi" \\ done',
		);
	});

	test("gives up on anything that is not that module", () => {
		expect(extract("const compiled = 1;")).toBeUndefined();
		expect(extract("export default notAString")).toBeUndefined();
	});
});

describe("closesAt", () => {
	/** One-based line and column of `|` in a fixture, which it then removes. */
	function at(marked: string): {
		source: string;
		line: number;
		column: number;
	} {
		const before = marked.slice(0, marked.indexOf("|"));
		const lines = before.split("\n");
		return {
			source: marked.replace("|", ""),
			line: lines.length,
			column: (lines.at(-1)?.length ?? 0) + 1,
		};
	}

	test("keeps a one-line element on its line", () => {
		const { source, ...where } = at("<div>\n    |<h2>Главная</h2>\n</div>");
		expect(closesAt(source, where)).toBe(2);
	});

	test("runs to the closing tag of a multi-line element", () => {
		const { source, ...where } = at(
			["|<p className='mt-1'>", "    {greeting}", "</p>", "<hr />"].join("\n"),
		);
		expect(closesAt(source, where)).toBe(3);
	});

	test("runs to the end of a self-closing tag written over lines", () => {
		const { source, ...where } = at(
			["|<Input", "    value={value}", "/>", "<hr />"].join("\n"),
		);
		expect(closesAt(source, where)).toBe(3);
	});

	test("counts nested tags of the same name", () => {
		const { source, ...where } = at(
			["|<div>", "  <div>", "    <span />", "  </div>", "</div>"].join("\n"),
		);
		expect(closesAt(source, where)).toBe(5);
	});

	test("reads a comparison in an expression as text, not a tag", () => {
		const { source, ...where } = at(
			["|<p>", "  {count < 10 && '<'}", "</p>"].join("\n"),
		);
		expect(closesAt(source, where)).toBe(3);
	});

	test("steps over tags inside expressions and strings", () => {
		const { source, ...where } = at(
			[
				"|<ul title='</ul>'>",
				"  {items.map((item) => (",
				`    <li key={item.id}>{\`</ul> \${item.name}\`}</li>`,
				"  ))}",
				"</ul>",
			].join("\n"),
		);
		expect(closesAt(source, where)).toBe(5);
	});

	test("closes a fragment", () => {
		const { source, ...where } = at(["|<>", "  <br />", "</>"].join("\n"));
		expect(closesAt(source, where)).toBe(3);
	});

	test("takes the column when it names a tag of its own", () => {
		const { source, ...where } = at(
			["<div><span>|<b>", "  a", "</b></span>", "</div>"].join("\n"),
		);
		expect(closesAt(source, where)).toBe(3);
		// Without the column the line's first tag is all there is to go on, and
		// that is the `<div>` — proof the hint is what picked the inner one.
		expect(closesAt(source, { line: where.line })).toBe(4);
	});

	test("falls back to the line when nothing on it opens a tag", () => {
		expect(closesAt("const a = 1;\nconst b = 2;", { line: 1 })).toBe(1);
	});

	test("falls back to the line when the element never closes", () => {
		expect(closesAt("<p>\n  unfinished\n", { line: 1 })).toBe(1);
	});

	test("falls back to the line when there is no such line", () => {
		expect(closesAt("<p>a</p>", { line: 9 })).toBe(9);
	});
});

describe("around", () => {
	const source = ["one", "two", "three", "four", "five", "six", "seven"].join(
		"\n",
	);

	test("centres the excerpt on the target line", () => {
		expect(around(source, { line: 4 }, 1)).toEqual({
			lines: ["three", "four", "five"],
			first: 3,
			target: { from: 4, to: 4 },
		});
	});

	test("clamps at the start of the file", () => {
		expect(around(source, { line: 1 }, 2)).toMatchObject({
			lines: ["one", "two", "three"],
			first: 1,
		});
	});

	test("clamps at the end of the file", () => {
		expect(around(source, { line: 7 }, 2)).toMatchObject({
			lines: ["five", "six", "seven"],
			first: 5,
		});
	});

	test("marks every line of the element, not only its first", () => {
		const jsx = ["<div>", "  <p>", "    text", "  </p>", "</div>"].join("\n");
		expect(around(jsx, { line: 2 }, 4).target).toEqual({ from: 2, to: 4 });
	});

	test("stops the mark where the excerpt does", () => {
		const jsx = ["<div>", "  <p>", "    text", "  </p>", "</div>"].join("\n");
		expect(around(jsx, { line: 2 }, 1).target).toEqual({ from: 2, to: 3 });
	});
});
