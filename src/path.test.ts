import { describe, expect, test } from "bun:test";
import { childPath, joinPath, within } from "./path";

describe("childPath", () => {
	test("brackets an index and dots a key", () => {
		expect(childPath("items", "3", true)).toBe("items[3]");
		expect(childPath("items[3]", "name", false)).toBe("items[3].name");
	});

	test("a key at the root has nothing to hang off", () => {
		expect(childPath("", "total", false)).toBe("total");
	});

	test("an index at the root keeps its brackets", () => {
		// A response body that is itself an array: `[0].name`, not `0.name`.
		expect(childPath("", "0", true)).toBe("[0]");
	});
});

describe("joinPath", () => {
	test("joins a field onto the record that holds it", () => {
		expect(joinPath("data[1]", "full_name")).toBe("data[1].full_name");
	});

	test("keeps an index against the object without a dot", () => {
		expect(joinPath("data", "[1]")).toBe("data[1]");
	});

	test("a record at the root of the body needs no prefix", () => {
		expect(joinPath("", "full_name")).toBe("full_name");
	});

	test("the body itself has nothing relative to add", () => {
		expect(joinPath("data[1]", "")).toBe("data[1]");
	});
});

describe("within", () => {
	test("a field of the scope is inside it", () => {
		expect(within("data[1]", "data[1].full_name")).toBe(true);
	});

	test("the scope is inside itself", () => {
		expect(within("data[1]", "data[1]")).toBe(true);
	});

	test("everything is inside the whole body", () => {
		expect(within("", "data[1].full_name")).toBe(true);
	});

	test("a sibling is not inside it", () => {
		expect(within("data[1]", "data[2].full_name")).toBe(false);
	});

	/**
	 * The reason this function exists rather than a `startsWith` call. Both of
	 * these pass a prefix test and neither is inside the scope, and answering
	 * with the wrong field is the one failure this package cannot afford.
	 */
	test("a longer name that merely starts the same is not inside it", () => {
		expect(within("user.name", "user.nameSuffix")).toBe(false);
		expect(within("data[1]", "data[10].full_name")).toBe(false);
	});

	test("an index is inside the array that holds it", () => {
		expect(within("data", "data[10]")).toBe(true);
	});
});
