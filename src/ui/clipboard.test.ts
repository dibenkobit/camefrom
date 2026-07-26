import { afterAll, describe, expect, test } from "bun:test";
import type { Provenance, RequestMeta } from "../shared/types";
import { asCurl, copyItems } from "./clipboard";
import { verdictOf } from "./verdict";

// A recorded URL is regularly a path, and resolving one needs the page it was
// fetched from. There is no page in a test runner, so this is the page.
(globalThis as { location?: unknown }).location = { href: "http://localhost/" };

afterAll(() => {
	delete (globalThis as { location?: unknown }).location;
});

const request: RequestMeta = {
	method: "GET",
	url: "/api/works?status=active",
	status: 200,
	startedAt: 0,
	durationMs: 143,
	headers: { authorization: "Bearer abc.123", accept: "application/json" },
};

const traced: Provenance = {
	value: "ТОО Барыс",
	path: "items[0].contractor.name",
	request,
	response: { items: [] },
	tree: [{ name: "td", target: true }],
	broken: false,
};

function items(provenance: Provenance) {
	return copyItems(provenance, verdictOf(provenance, { count: 3, limit: 50 }));
}

function labelled(provenance: Provenance, label: string) {
	const found = items(provenance).find((item) => item.label === label);
	if (!found) throw new Error(`no ${label} in the menu`);
	return found;
}

describe("asCurl", () => {
	test("carries the headers the app set, which is what makes it answer", () => {
		expect(asCurl(request)).toBe(
			[
				"curl 'http://localhost/api/works?status=active'",
				"  -H 'authorization: Bearer abc.123'",
				"  -H 'accept: application/json'",
			].join(" \\\n"),
		);
	});

	test("names the method only when it is not the default", () => {
		expect(
			asCurl({ ...request, method: "post", headers: undefined }),
		).toContain("-X POST");
		expect(asCurl({ ...request, headers: undefined })).not.toContain("-X");
	});

	/** A URL or a token with a quote in it must not end the shell word early. */
	test("closes and reopens the quote around a quote", () => {
		expect(
			asCurl({ ...request, headers: { "x-note": "it's fine" } }),
		).toContain("-H 'x-note: it'\\''s fine'");
	});
});

describe("the copy menu", () => {
	test("offers the same four items whatever the answer is", () => {
		expect(items(traced).map((item) => item.label)).toEqual([
			"Answer, for a ticket",
			"Field path",
			"Request URL",
			"curl",
		]);
	});

	test("copies the answer as the console prints it", () => {
		const text = labelled(traced, "Answer, for a ticket").text ?? "";

		expect(text.startsWith('camefrom "ТОО Барыс"\n')).toBe(true);
		expect(text).toContain("Came from the API");
		expect(text).toContain("items[0].contractor.name");
	});

	test("makes a relative URL something a colleague can open", () => {
		expect(labelled(traced, "Request URL").text).toBe(
			"http://localhost/api/works?status=active",
		);
	});

	/**
	 * An item that cannot copy anything says why, in place, rather than vanishing.
	 * A menu whose length changes with the answer is a menu the reader cannot
	 * learn.
	 */
	test("keeps an item it cannot fill, and says what is missing", () => {
		const broken: Provenance = {
			value: "1 250,00 ₸",
			tree: [],
			broken: true,
		};

		const path = labelled(broken, "Field path");
		expect(path.text).toBeUndefined();
		expect(path.note).toBe("this text was not read from a response");

		const curl = labelled(broken, "curl");
		expect(curl.text).toBeUndefined();
		expect(curl.note).toBe("no request recorded behind this value");
	});

	test("says why the field cannot be copied when several hold the value", () => {
		const unsure: Provenance = {
			...traced,
			path: undefined,
			ambiguous: ["data[0].name", "data[1].name"],
		};

		expect(labelled(unsure, "Field path").note).toBe(
			"more than one field holds this value",
		);
	});

	test("warns that a cookie-authenticated call will need one added", () => {
		expect(labelled(traced, "curl").note).toContain("without cookies");
	});
});
