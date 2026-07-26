import { describe, expect, test } from "bun:test";
import type { Provenance } from "../shared/types";
import { verdictOf } from "./verdict";

/**
 * The four answers, and the wording of each.
 *
 * Pinned rather than left to the panel, because the whole design rests on there
 * being exactly four: a headline that says whose bug it is, and a pane chosen to
 * match. A fifth case answered by falling through to "Built in the app" would be
 * the tool blaming the app for its own silence, which is the one mistake here
 * that costs somebody an afternoon.
 */
const kept = { count: 12, limit: 50 };

function traced(over: Partial<Provenance> = {}): Provenance {
	return {
		value: "ТОО Барыс",
		path: "items[0].contractor.name",
		response: { items: [] },
		tree: [],
		broken: false,
		...over,
	};
}

describe("verdictOf", () => {
	test("one field is the API's answer, and opens the response", () => {
		const verdict = verdictOf(traced(), kept);

		expect(verdict.answer).toBe("api");
		expect(verdict.says).toBe("Came from the API");
		expect(verdict.advice).toBeUndefined();
		expect(verdict.opens).toBe("response");
	});

	test("admits a body that aged out instead of pointing at nothing", () => {
		const verdict = verdictOf(traced({ response: undefined }), kept);

		expect(verdict.answer).toBe("api");
		expect(verdict.advice).toContain("keeps the last 50");
		// There is no response pane to open, so the source is the next best answer.
		expect(verdict.opens).toBe("source");
	});

	test("counts the candidates rather than choosing one", () => {
		const verdict = verdictOf(
			traced({
				path: undefined,
				ambiguous: ["data[0].full_name", "data[1].full_name"],
			}),
			kept,
		);

		expect(verdict.answer).toBe("choose");
		expect(verdict.says).toBe("2 fields hold this value");
		expect(verdict.advice).toContain("Pick one to mark it in the response");
		expect(verdict.opens).toBe("choices");
	});

	/** An instruction that cannot be followed is worse than none at all. */
	test("does not offer to mark a response that is no longer kept", () => {
		const verdict = verdictOf(
			traced({
				path: undefined,
				response: undefined,
				ambiguous: ["data[0].full_name", "data[1].full_name"],
			}),
			kept,
		);

		expect(verdict.advice).not.toContain("Pick one");
		expect(verdict.advice).toContain("has aged out");
	});

	test("blames the app only after saying how much it searched", () => {
		const verdict = verdictOf(
			traced({ path: undefined, response: undefined, broken: true }),
			kept,
		);

		expect(verdict.answer).toBe("app");
		expect(verdict.says).toBe("Built in the app");
		expect(verdict.advice).toContain("None of the 12 responses");
		expect(verdict.opens).toBe("source");
	});

	test("counts one response in the singular", () => {
		const verdict = verdictOf(
			traced({ path: undefined, response: undefined, broken: true }),
			{ count: 1, limit: 50 },
		);

		expect(verdict.advice).toContain(
			"The one response camefrom recorded does not",
		);
	});

	/**
	 * The case the old panel could not tell from the one above it, and the
	 * difference between "your app built this string" and "this tool is not
	 * running". Both used to print `✗ not read from any recorded response`.
	 */
	test("blames itself when it has recorded nothing at all", () => {
		const verdict = verdictOf(
			traced({ path: undefined, response: undefined, broken: true }),
			{ count: 0, limit: 50 },
		);

		expect(verdict.answer).toBe("quiet");
		expect(verdict.says).toBe("Nothing recorded yet");
		expect(verdict.advice).toContain("install() ran too late");
		expect(verdict.advice).toContain("patches fetch");
	});
});
