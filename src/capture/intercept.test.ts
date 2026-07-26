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

/**
 * The headers are what make the `curl` the panel offers answer rather than 401,
 * and they are only readable on the way out: a `Request` never hands them back
 * once the browser has sent it.
 */
test("the headers the app set are recorded with the request", async () => {
	const response = await fetch(server.url, {
		headers: { Authorization: "Bearer abc.123", Accept: "application/json" },
	});
	void ((await response.json()) as Body).items[0]?.contractor.name;

	const read = findReads("ТОО Барыс")[0];
	expect(read && findResponse(read.responseId)?.headers).toEqual({
		authorization: "Bearer abc.123",
		accept: "application/json",
	});
});

test("a Request carries its own headers, and init still overrides them", async () => {
	const response = await fetch(
		new Request(server.url, {
			headers: { accept: "text/plain", "x-from": "request" },
		}),
		{ headers: { accept: "application/json" } },
	);
	void ((await response.json()) as Body).items[0]?.contractor.name;

	const read = findReads("ТОО Барыс")[0];
	expect(read && findResponse(read.responseId)?.headers).toEqual({
		accept: "application/json",
		"x-from": "request",
	});
});

test("a call with no headers of its own records none", async () => {
	const response = await fetch(server.url);
	void ((await response.json()) as Body).items[0]?.contractor.name;

	const read = findReads("ТОО Барыс")[0];
	expect(read && findResponse(read.responseId)?.headers).toBeUndefined();
});
