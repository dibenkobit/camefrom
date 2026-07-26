import { describe, expect, test } from "bun:test";
import { format } from "./report";
import type { Provenance } from "./types";

const traced: Provenance = {
	value: "ТОО Барыс",
	path: "items[0].contractor.name",
	hops: [
		{ kind: "read", label: "items[0].contractor.name" },
		{ kind: "response", label: "GET /api/works · 200 · 143ms" },
		{
			kind: "component",
			label: "<WorkRow>",
			file: "src/works.table-columns.tsx",
			line: 41,
		},
	],
	broken: false,
};

describe("format", () => {
	test("reads as a chain from the value outwards", () => {
		expect(format(traced)).toEqual([
			"← items[0].contractor.name",
			"← GET /api/works · 200 · 143ms",
			"← <WorkRow> · src/works.table-columns.tsx:41",
		]);
	});

	test("leaves out a position the inspector did not provide", () => {
		const hop = {
			kind: "component",
			label: "<WorkRow>",
			file: "src/works.tsx",
		} as const;
		expect(format({ ...traced, hops: [hop] })).toEqual([
			"← <WorkRow> · src/works.tsx",
		]);
	});

	test("says plainly when the chain does not reach a response", () => {
		const broken: Provenance = { value: "Подрядчик", hops: [], broken: true };
		expect(format(broken)).toEqual(["✗ not read from any recorded response"]);
	});
});
