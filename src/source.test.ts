import { describe, expect, test } from "bun:test";
import { around, extract } from "./source";

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

describe("around", () => {
	const source = ["one", "two", "three", "four", "five", "six", "seven"].join(
		"\n",
	);

	test("centres the excerpt on the target line", () => {
		expect(around(source, 4, 1)).toEqual({
			lines: ["three", "four", "five"],
			first: 3,
			target: 4,
		});
	});

	test("clamps at the start of the file", () => {
		expect(around(source, 1, 2)).toMatchObject({
			lines: ["one", "two", "three"],
			first: 1,
		});
	});

	test("clamps at the end of the file", () => {
		expect(around(source, 7, 2)).toMatchObject({
			lines: ["five", "six", "seven"],
			first: 5,
		});
	});
});
