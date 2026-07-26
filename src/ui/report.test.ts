import { describe, expect, test } from "bun:test";
import type { Provenance } from "../shared/types";
import { format } from "./report";
import { verdictOf } from "./verdict";

const traced: Provenance = {
	value: "ТОО Барыс",
	path: "items[0].contractor.name",
	request: {
		method: "GET",
		url: "/api/works",
		status: 200,
		startedAt: 0,
		durationMs: 143,
	},
	tree: [
		{
			name: "WorksTable",
			at: { file: "src/works.tsx", line: 12, column: 3 },
			target: false,
		},
		{
			name: "WorkRow",
			at: { file: "src/works.table-columns.tsx", line: 41, column: 9 },
			target: false,
		},
		{ name: "td", target: true },
	],
	broken: false,
};

/** The lines as one block, for asking whether something is in them at all. */
function lines(provenance: Provenance, kept = 4): string[] {
	return format(provenance, verdictOf(provenance, { count: kept, limit: 50 }));
}

describe("format", () => {
	test("leads with the verdict, then the facts behind it", () => {
		expect(lines({ ...traced, response: { items: [] } })).toEqual([
			"Came from the API",
			"",
			"field    items[0].contractor.name",
			"request  GET /api/works  200  143ms",
			"",
			"rendered by",
			"  <WorksTable>  src/works.tsx:12",
			"    <WorkRow>   src/works.table-columns.tsx:41",
			"      <td>",
		]);
	});

	test("lines every file up under the one above it", () => {
		const files = lines({ ...traced, response: {} })
			.filter((line) => line.includes(".tsx:"))
			.map((line) => line.indexOf("src/"));

		expect(new Set(files).size).toBe(1);
	});

	test("names every candidate rather than resolving to the first", () => {
		expect(
			lines({
				...traced,
				path: undefined,
				response: {},
				ambiguous: ["data[0].full_name", "data[1].full_name"],
				tree: [],
			}),
		).toEqual([
			"2 fields hold this value",
			"Nothing around the click narrowed it down. Pick one to mark it in the response.",
			"",
			"fields   data[0].full_name",
			"         data[1].full_name",
			"request  GET /api/works  200  143ms",
		]);
	});

	test("says what it searched when the text was built in the app", () => {
		const broken: Provenance = {
			value: "1 250,00 ₸",
			tree: [{ name: "InvoiceTotal", target: true }],
			broken: true,
		};

		expect(lines(broken, 12)).toEqual([
			"Built in the app",
			"None of the 12 responses camefrom recorded holds this text, so something on the way to the screen made it — a template, a number format, a .map() into new objects.",
			"",
			"",
			"rendered by",
			"  <InvoiceTotal>",
		]);
	});

	test("blames the install, not the value, when nothing was recorded at all", () => {
		const nothing: Provenance = { value: "Подрядчик", tree: [], broken: true };

		expect(lines(nothing, 0)[0]).toBe("Nothing recorded yet");
		expect(lines(nothing, 0)[1]).toContain("install() ran too late");
	});

	test("spells out the one cause a reader can act on", () => {
		const untracked: Provenance = {
			...traced,
			tree: [{ name: "td", missing: "untracked", target: true }],
		};

		expect(lines(untracked).at(-2)).toContain(
			"React stopped recording call sites",
		);
		expect(lines(untracked).at(-1)).toContain("Reload the page");
	});
});
