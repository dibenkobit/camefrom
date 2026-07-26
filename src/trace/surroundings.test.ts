import { beforeEach, describe, expect, test } from "bun:test";
import { recordResponse, reset } from "../capture/store";
import { taint } from "../capture/taint";
import { agreed, type Field } from "./surroundings";

const meta = {
	method: "GET",
	url: "/api/sites",
	status: 200,
	startedAt: 0,
	durationMs: 12,
};

beforeEach(reset);

function seed(body: unknown): number {
	const recorded = recordResponse(meta, body);
	// Reading through the proxy is what registers the paths.
	JSON.stringify(taint(body, recorded.id));
	return recorded.id;
}

/** The two rows of `body` that hold the same status, as a trace leaves them. */
function both(responseId: number): Field[] {
	return [
		{ responseId, path: "items[0].status" },
		{ responseId, path: "items[1].status" },
	];
}

describe("agreed", () => {
	test("takes the candidate the container around it shows the rest of", () => {
		const body = {
			items: [
				{ code: "A-1", status: "Активен" },
				{ code: "A-2", status: "Активен" },
			],
		};
		const hits = both(seed(body));

		// The cell beside it, in the same row. Nothing about the text being traced
		// could say which of the two rows it is; `A-2` says it outright.
		expect(agreed(hits, [["A-2"]])).toEqual([hits[1] as Field]);
	});

	test("a neighbour both rows share tells them apart no better", () => {
		const hits = both(
			seed({
				items: [
					{ kind: "сайт", status: "Активен" },
					{ kind: "сайт", status: "Активен" },
				],
			}),
		);

		expect(agreed(hits, [["сайт"]])).toEqual(hits);
	});

	test("a container holding both of them is the list, and settles nothing", () => {
		const hits = both(
			seed({
				items: [
					{ code: "A-1", status: "Активен" },
					{ code: "A-2", status: "Активен" },
				],
			}),
		);

		// Innermost first: the row shows nothing else, the table shows both rows.
		// Naming whichever of them was listed first is the bug this exists to fix.
		expect(agreed(hits, [[], ["A-1", "A-2"]])).toEqual(hits);
	});

	/**
	 * The one that decides between an answer and a wrong answer. A box holding
	 * another record of the same body is the list, and a list is where the row
	 * with the most filled cells would win over the row that was pointed at.
	 */
	test("a text out of another record stops the search where it stands", () => {
		const hits = both(
			seed({
				items: [
					{ code: "A-1", status: "Активен" },
					{ code: "A-2", status: "Активен" },
					{ code: "A-3", status: "Закрыт" },
				],
			}),
		);

		expect(agreed(hits, [["A-3", "A-2"]])).toEqual(hits);
	});

	test("a text nothing ever read is not evidence either way", () => {
		const hits = both(
			seed({
				items: [
					{ code: "A-1", status: "Активен" },
					{ code: "A-2", status: "Активен" },
				],
			}),
		);

		// A label, a formatted date, a dash where a null was: most of what a row
		// shows never came out of the body at all.
		expect(agreed(hits, [["02.07.2026", "—"]])).toEqual(hits);
	});
});
