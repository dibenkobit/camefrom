import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { intercept } from "./intercept";
import { findReads, findResponse, reset } from "./store";

const server = Bun.serve({
	port: 0,
	fetch: () =>
		Response.json({ items: [{ contractor: { name: "ТОО Астана" } }] }),
});

// Bun has no XMLHttpRequest of its own, so happy-dom supplies the one axios
// would be using in a browser. intercept() runs afterwards on purpose: picking
// up a global that appeared late is exactly what it has to survive.
const window = new Window({ url: server.url.origin });
globalThis.XMLHttpRequest =
	window.XMLHttpRequest as unknown as typeof XMLHttpRequest;
intercept();

afterAll(async () => {
	await window.happyDOM.close();
	await server.stop(true);
});

beforeEach(reset);

interface Body {
	items: { contractor: { name: string } }[];
}

/** How axios reads a response: text off the request, parsed by hand. */
function requestText(url: string): Promise<string> {
	return new Promise((settle, fail) => {
		const request = new XMLHttpRequest();
		request.open("GET", url);
		request.onreadystatechange = () => {
			if (request.readyState !== XMLHttpRequest.DONE) return;
			settle(request.responseText);
		};
		request.addEventListener("error", () => fail(new Error("request failed")));
		request.send();
	});
}

test("a body read over XHR and parsed by the app is traceable", async () => {
	const body = JSON.parse(await requestText(server.url.href)) as Body;

	expect(body.items[0]?.contractor.name).toBe("ТОО Астана");
	expect(findReads("ТОО Астана")).toEqual([
		{ responseId: 1, path: "items[0].contractor.name" },
	]);
});

test("the XHR that produced a value is recorded alongside it", async () => {
	const body = JSON.parse(await requestText(server.url.href)) as Body;
	void body.items[0]?.contractor.name;

	const read = findReads("ТОО Астана")[0];
	const recorded = read && findResponse(read.responseId);
	expect(recorded?.method).toBe("GET");
	expect(recorded?.status).toBe(200);
});

test("reading responseText repeatedly records the body once", async () => {
	const request = new XMLHttpRequest();
	await new Promise<void>((settle) => {
		request.open("GET", server.url.href);
		request.onreadystatechange = () => {
			if (request.readyState === XMLHttpRequest.DONE) settle();
		};
		request.send();
	});

	const first = JSON.parse(request.responseText) as Body;
	const second = JSON.parse(request.responseText) as Body;
	void first.items[0]?.contractor.name;
	void second.items[0]?.contractor.name;

	expect(findReads("ТОО Астана")).toEqual([
		{ responseId: 1, path: "items[0].contractor.name" },
	]);
});
