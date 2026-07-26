import { afterAll, beforeEach, expect, test } from "bun:test";
import { intercept } from "./intercept";
import { findReads, findResponse, reset } from "./store";

const server = Bun.serve({
	port: 0,
	fetch: () =>
		Response.json({ items: [{ contractor: { name: "ТОО Барыс" } }] }),
});

intercept();

afterAll(() => server.stop(true));
beforeEach(reset);

interface Body {
	items: { contractor: { name: string } }[];
}

test("a body read through Response.json is traceable to its request", async () => {
	const response = await fetch(server.url);
	const body = (await response.json()) as Body;

	expect(body.items[0]?.contractor.name).toBe("ТОО Барыс");
	expect(findReads("ТОО Барыс")).toEqual([
		{ responseId: 1, path: "items[0].contractor.name" },
	]);
});

test("a body parsed by the app itself is traceable too", async () => {
	const response = await fetch(server.url);
	const body = JSON.parse(await response.text()) as Body;

	expect(body.items[0]?.contractor.name).toBe("ТОО Барыс");
	expect(findReads("ТОО Барыс")).toEqual([
		{ responseId: 1, path: "items[0].contractor.name" },
	]);
});

test("the request that produced a value is recorded alongside it", async () => {
	const response = await fetch(server.url);
	const body = (await response.json()) as Body;
	void body.items[0]?.contractor.name;

	const read = findReads("ТОО Барыс")[0];
	const recorded = read && findResponse(read.responseId);
	expect(recorded?.method).toBe("GET");
	expect(recorded?.status).toBe(200);
});

test("parsing unrelated JSON records nothing", () => {
	JSON.parse('{"name":"из localStorage"}');
	expect(findReads("из localStorage")).toEqual([]);
});
