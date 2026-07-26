import { beforeEach, describe, expect, test } from "bun:test";
import {
	findReads,
	findResponse,
	recordRead,
	recordResponse,
	reset,
} from "./store";

const meta = {
	method: "GET",
	url: "/api/works",
	status: 200,
	startedAt: 0,
	durationMs: 1,
};

beforeEach(reset);

describe("responses", () => {
	test("are retrievable by the id they were given", () => {
		const recorded = recordResponse(meta, { items: [] });
		expect(findResponse(recorded.id)?.body).toEqual({ items: [] });
	});

	test("drop the oldest once the cap is reached", () => {
		const first = recordResponse(meta, 1);
		for (let i = 0; i < 60; i++) recordResponse(meta, i);
		expect(findResponse(first.id)).toBeUndefined();
	});
});

describe("reads", () => {
	test("are found by the value that was read", () => {
		recordRead(1, "items[0].name", "ТОО Барыс");
		expect(findReads("ТОО Барыс")).toEqual([
			{ responseId: 1, path: "items[0].name" },
		]);
	});

	test("return empty for a value we never saw", () => {
		expect(findReads("nothing")).toEqual([]);
	});

	test("keep every distinct path a value came from", () => {
		recordRead(1, "items[0].name", "Барыс");
		recordRead(1, "items[4].name", "Барыс");
		expect(findReads("Барыс")).toHaveLength(2);
	});

	test("do not duplicate the same path read twice", () => {
		recordRead(1, "items[0].name", "Барыс");
		recordRead(1, "items[0].name", "Барыс");
		expect(findReads("Барыс")).toHaveLength(1);
	});

	test('distinguish the number 42 from the string "42"', () => {
		recordRead(1, "total", 42);
		expect(findReads(42)).toHaveLength(1);
		expect(findReads("42")).toHaveLength(0);
	});
});
