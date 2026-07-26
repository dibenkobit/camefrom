import { beforeEach, describe, expect, test } from "bun:test";
import { findReads, recordResponse, reset } from "../capture/store";
import { taint } from "../capture/taint";
import { entriesOf, isRecordLike, pathsOf, place } from "./match";

const meta = {
	method: "GET",
	url: "/api/documents",
	status: 200,
	startedAt: 0,
	durationMs: 9,
};

/** Two documents whose names are identical. The ids are the only difference. */
const documents = () => ({
	data: [
		{ id: 59, full_name: "Alpyspayev Bakhtiyar", city: "Astana" },
		{ id: 60, full_name: "Alpyspayev Bakhtiyar", city: "Astana" },
	],
});

beforeEach(reset);

function seed<T extends object>(body: T): T {
	return taint(body, recordResponse(meta, body).id);
}

describe("place", () => {
	test("takes the identity of a tainted object over anything else", () => {
		const tainted = seed(documents());
		const row = (tainted.data as unknown[])[1] as object;

		expect(place(row)).toMatchObject([
			{ responseId: 1, path: "data[1]", score: Number.POSITIVE_INFINITY },
		]);
	});

	test("recognises a node of the body handed back untainted", () => {
		const body = documents();
		recordResponse(meta, body);
		// Not through the proxy, so there is no origin to read: the object is
		// simply one the body already holds, and identity settles it.
		expect(place(body.data[1] as object)).toMatchObject([
			{ path: "data[1]", score: Number.POSITIVE_INFINITY },
		]);
	});

	test("finds a copy of a record by the fields it kept", () => {
		const tainted = seed(documents());
		const copy = { ...((tainted.data as unknown[])[1] as object) };

		expect(place(copy).map((found) => found.path)).toEqual(["data[1]"]);
	});

	test("a record with no fields in common cannot be placed", () => {
		seed(documents());
		expect(place({ id: 61, full_name: "Someone Else" })).toEqual([]);
	});

	test("prefers the record that agrees on more fields", () => {
		seed({
			data: [
				{ id: 1, name: "Барыс" },
				{ id: 1, name: "Барыс", city: "Astana" },
			],
		});

		expect(
			place({ id: 1, name: "Барыс", city: "Astana" }).map(
				(found) => found.path,
			),
		).toEqual(["data[1]"]);
	});

	test("names both records when they are indistinguishable", () => {
		seed({ data: [{ name: "Барыс" }, { name: "Барыс" }] });

		expect(place({ name: "Барыс" }).map((found) => found.path)).toEqual([
			"data[0]",
			"data[1]",
		]);
	});

	test("nothing is placed by fields it does not have", () => {
		seed(documents());
		expect(place({})).toEqual([]);
	});
});

describe("pathsOf", () => {
	test("finds the field of a record that holds the value", () => {
		expect(pathsOf({ id: 60, full_name: "Барыс" }, "Барыс")).toEqual([
			"full_name",
		]);
	});

	test("looks inside, because a cell is rarely a top-level field", () => {
		expect(pathsOf({ contractor: { name: "ТОО Барыс" } }, "ТОО Барыс")).toEqual(
			["contractor.name"],
		);
	});

	test("uses index syntax inside arrays", () => {
		expect(pathsOf({ tags: ["urgent"] }, "urgent")).toEqual(["tags[0]"]);
	});

	test("reports every field holding the value, not the first", () => {
		expect(pathsOf({ a: "x", b: "x" }, "x")).toEqual(["a", "b"]);
	});
});

describe("entriesOf", () => {
	test("never invokes a getter", () => {
		let calls = 0;
		const object = {
			plain: 1,
			get lazy() {
				calls++;
				return 2;
			},
		};

		expect(entriesOf(object)).toEqual([["plain", 1]]);
		expect(calls).toBe(0);
	});

	test("does not record a read when walking a tainted object", () => {
		const tainted = seed({ name: "Барыс" });

		expect(entriesOf(tainted)).toEqual([["name", "Барыс"]]);
		// The value index is what a fallback lookup searches. A click that adds
		// to it would answer questions about itself.
		expect(findReads("Барыс")).toEqual([]);
	});

	test("leaves out the length of an array", () => {
		expect(entriesOf(["a"])).toEqual([["0", "a"]]);
	});
});

describe("isRecordLike", () => {
	test("accepts a class instance, because table libraries hand one down", () => {
		class Row {
			original = { id: 1 };
		}
		expect(isRecordLike(new Row())).toBe(true);
	});

	test("rejects what a response could never have contained", () => {
		expect(isRecordLike(null)).toBe(false);
		expect(isRecordLike("Барыс")).toBe(false);
		expect(isRecordLike(new Date())).toBe(false);
		expect(isRecordLike(new Map())).toBe(false);
		expect(isRecordLike({ $$typeof: Symbol.for("react.element") })).toBe(false);
		expect(isRecordLike({ nodeType: 1 })).toBe(false);
	});
});
