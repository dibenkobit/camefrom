import { beforeEach, describe, expect, test } from "bun:test";
import { recordResponse, reset } from "../capture/store";
import { taint } from "../capture/taint";
import { traceText } from "./resolve";

const meta = {
	method: "GET",
	url: "/api/works",
	status: 200,
	startedAt: 0,
	durationMs: 12,
};

beforeEach(reset);

function seed(body: unknown): void {
	const recorded = recordResponse(meta, body);
	// Reading through the proxy is what registers the paths.
	JSON.stringify(taint(body, recorded.id));
}

describe("traceText", () => {
	test("finds the field a rendered string came from", () => {
		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });

		const found = traceText("ТОО Барыс");
		expect(found.broken).toBe(false);
		expect(found.path).toBe("items[0].contractor.name");
		expect(found.request?.url).toBe("/api/works");
	});

	test("carries the response body so it can be shown inline", () => {
		seed({ total: 7 });
		expect(traceText("7").response).toEqual({ total: 7 });
	});

	test("matches a number that was rendered as text", () => {
		seed({ total: 42 });

		const found = traceText("42");
		expect(found.value).toBe(42);
		expect(found.path).toBe("total");
	});

	test("ignores the whitespace a layout added", () => {
		seed({ name: "Барыс" });
		expect(traceText("\n  Барыс  ").path).toBe("name");
	});

	test("reports the trace as broken when nothing matches", () => {
		seed({ name: "Барыс" });

		const found = traceText("Астана");
		expect(found.broken).toBe(true);
		expect(found.path).toBeUndefined();
		expect(found.request).toBeUndefined();
	});

	test("names the field and the call it was read from", () => {
		seed({ name: "Барыс" });

		const found = traceText("Барыс");
		expect(found.path).toBe("name");
		expect(found.request?.url).toBe("/api/works");
	});
});
