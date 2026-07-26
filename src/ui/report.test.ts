import { describe, expect, test } from "bun:test";
import type { Provenance } from "../shared/types";
import { format } from "./report";

const traced: Provenance = {
	value: "ТОО Барыс",
	path: "items[0].contractor.name",
	hops: [
		{ kind: "read", label: "items[0].contractor.name" },
		{ kind: "response", label: "GET /api/works · 200 · 143ms" },
	],
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

describe("format", () => {
	test("reads as a chain from the value outwards", () => {
		expect(format(traced)).toEqual([
			"← items[0].contractor.name",
			"← GET /api/works · 200 · 143ms",
			"← rendered by",
			"  <WorksTable> · src/works.tsx:12",
			"    <WorkRow> · src/works.table-columns.tsx:41",
			"      <td>",
		]);
	});

	test("names every candidate rather than resolving to the first", () => {
		const unsure: Provenance = {
			...traced,
			path: undefined,
			ambiguous: ["data[0].full_name", "data[1].full_name"],
			hops: [{ kind: "read", label: "2 fields hold this value" }],
			tree: [],
		};

		expect(format(unsure)).toEqual([
			"← 2 fields hold this value",
			"  ? data[0].full_name",
			"  ? data[1].full_name",
		]);
	});

	test("counts the candidates it does not spell out", () => {
		const many: Provenance = {
			...traced,
			path: undefined,
			ambiguous: Array.from({ length: 9 }, (_, index) => `data[${index}].n`),
			hops: [],
			tree: [],
		};

		expect(format(many).at(-1)).toBe("  ? …3 more");
	});

	test("says plainly when the chain does not reach a response", () => {
		const broken: Provenance = {
			value: "Подрядчик",
			hops: [],
			tree: [{ name: "WorkForm", target: true }],
			broken: true,
		};

		expect(format(broken)).toEqual([
			"← rendered by",
			"  <WorkForm>",
			"✗ not read from any recorded response",
		]);
	});
});
