import { beforeEach, describe, expect, test } from "bun:test";
import { findReads, reset } from "./store";
import { originOf, taint } from "./taint";

beforeEach(reset);

const body = () => ({
	items: [
		{ contractor: { name: "ТОО Барыс" } },
		{ contractor: { name: "ТОО Астана" } },
	],
	total: 2,
});

describe("reading through the proxy", () => {
	test("records the path a primitive came from", () => {
		const data = taint(body(), 1);
		expect(data.items[1]?.contractor.name).toBe("ТОО Астана");
		expect(findReads("ТОО Астана")).toEqual([
			{ responseId: 1, path: "items[1].contractor.name" },
		]);
	});

	test("records nothing until the value is actually read", () => {
		taint(body(), 1);
		expect(findReads("ТОО Барыс")).toEqual([]);
	});

	test("does not record array length as data", () => {
		const data = taint(body(), 1);
		expect(data.items.length).toBe(2);
		expect(findReads(2)).toEqual([]);
	});

	test("survives array methods", () => {
		const data = taint(body(), 1);
		const names = data.items.map((item) => item.contractor.name);
		expect(names).toEqual(["ТОО Барыс", "ТОО Астана"]);
		expect(findReads("ТОО Барыс")).toHaveLength(1);
	});

	test("survives JSON round-tripping", () => {
		const data = taint(body(), 1);
		expect(JSON.parse(JSON.stringify(data))).toEqual(body());
	});
});

describe("identity", () => {
	test("is stable across repeated access, so memoisation still works", () => {
		const data = taint(body(), 1);
		expect(data.items[0]).toBe(data.items[0]);
	});

	test("is stable across repeated tainting of the same object", () => {
		const raw = body();
		expect(taint(raw, 1)).toBe(taint(raw, 1));
	});
});

describe("what is left alone", () => {
	test("primitives are returned as they are", () => {
		expect(taint("plain", 1)).toBe("plain");
		expect(taint(null, 1)).toBeNull();
	});

	test("class instances are not wrapped", () => {
		const date = new Date(0);
		expect(taint(date, 1)).toBe(date);
	});
});

describe("originOf", () => {
	test("reports where a tainted object sits in the body", () => {
		const data = taint(body(), 1);
		expect(originOf(data.items[0]?.contractor)).toEqual({
			responseId: 1,
			path: "items[0].contractor",
		});
	});

	test("is undefined for anything we never tainted", () => {
		expect(originOf({ name: "x" })).toBeUndefined();
	});
});
