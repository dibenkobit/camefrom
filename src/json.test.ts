import { describe, expect, test } from "bun:test";
import { print } from "./json";

const body = {
	items: [{ status: "Активен" }, { status: "Активен" }],
	total: 2,
};

function lineAt(value: unknown, path: string): string | undefined {
	const printed = print(value);
	const line = printed.lineOfPath.get(path);
	return line === undefined ? undefined : printed.text.split("\n")[line];
}

describe("print", () => {
	test("stays valid JSON", () => {
		expect(JSON.parse(print(body).text)).toEqual(body);
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
		expect(print(42).text).toBe("42");
		expect(print(null).text).toBe("null");
	});
});
