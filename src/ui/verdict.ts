/**
 * The one sentence the reader came for.
 *
 * A developer pointing at a value is not asking for a chain, a tree and a body;
 * they are asking whose bug it is. The answer is already in the `Provenance` and
 * used to be left as an exercise: four sections of evidence, no verdict, and the
 * reader doing the reasoning the tool had already done.
 *
 * There are exactly four answers, and which one it is decides everything the
 * panel does next — the headline, what to do about it, and which pane opens.
 * Pure, so the wording is testable without a browser and cannot drift from the
 * console's copy of it.
 */

import type { Provenance } from "../shared/types";

/**
 * Which of the four answers this is.
 *
 * - `api` — one field of one recorded response holds it. Whatever is wrong with
 *   it was wrong before it arrived.
 * - `choose` — several fields hold it and nothing on the page could narrow it
 *   down. The reader knows which; we do not, and we will not guess.
 * - `app` — we searched what we recorded and none of it holds this text, so the
 *   app made it. The line that rendered it is the lead.
 * - `quiet` — we recorded nothing at all, which is not an answer about the value
 *   but about the tool, and has to be said as such.
 */
export type Answer = "api" | "choose" | "app" | "quiet";

/** The evidence the panel can show, in the order the tab strip lists it. */
export type Pane = "response" | "source" | "tree" | "choices";

export interface Verdict {
	answer: Answer;
	/** The headline. Plain language, no jargon, never empty. */
	says: string;
	/** What follows from it: what to do, or what to distrust. */
	advice?: string;
	/** The pane that answers this verdict. The panel falls back when it is not there. */
	opens: Pane;
}

/**
 * What the store is holding.
 *
 * Half of what "not found" means: a value missing from fifty recorded responses
 * is a fact about the value, and one missing from none is a fact about whether
 * the tool is even running. The two read identically until the number is said
 * out loud, and telling them apart is minutes of somebody's afternoon.
 */
export interface Kept {
	/** Responses still in the store. */
	count: number;
	/** How many it keeps at most, for explaining one that aged out. */
	limit: number;
}

export function verdictOf(provenance: Provenance, kept: Kept): Verdict {
	const many = provenance.ambiguous;
	if (many && many.length > 1) {
		return {
			answer: "choose",
			says: `${many.length} fields hold this value`,
			// Only offer the marking when there is a body left to mark. The same
			// response can age out of the store while the page goes on showing what
			// it said, and an instruction that cannot be followed is worse than none.
			advice:
				provenance.response === undefined
					? `Nothing around the click narrowed it down, and the response itself has aged out — camefrom keeps the last ${kept.limit}.`
					: "Nothing around the click narrowed it down. Pick one to mark it in the response.",
			opens: "choices",
		};
	}

	if (provenance.path !== undefined) {
		// The field is known and the body it sits in is not: the response scrolled
		// off the end of the store while the page went on showing what it said.
		// Naming the field without admitting that would send the reader looking
		// for a body the panel is never going to show.
		const gone = provenance.response === undefined;
		return {
			answer: "api",
			says: "Came from the API",
			advice: gone
				? `The response itself has aged out — camefrom keeps the last ${kept.limit}.`
				: undefined,
			opens: gone ? "source" : "response",
		};
	}

	if (kept.count === 0) {
		return {
			answer: "quiet",
			says: "Nothing recorded yet",
			advice:
				"camefrom has not seen a single response. If the page already loaded its data, install() ran too late — it has to come before anything that patches fetch or XMLHttpRequest.",
			opens: "source",
		};
	}

	return {
		answer: "app",
		says: "Built in the app",
		advice: `${searched(kept.count)}, so something on the way to the screen made it — a template, a number format, a .map() into new objects.`,
		opens: "source",
	};
}

/** How many were searched and came back empty, in both grammars. */
function searched(count: number): string {
	return count === 1
		? "The one response camefrom recorded does not hold this text"
		: `None of the ${count} responses camefrom recorded holds this text`;
}
