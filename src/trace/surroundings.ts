import { findReads } from "../capture/store";
import { ELEMENT_NODE, elementOf, TEXT_NODE } from "../shared/dom";
import { segments, sharedSteps } from "../shared/path";
import { candidates, textOf } from "./text";

/**
 * What the page itself says about which of several fields was pointed at.
 *
 * The value cannot answer this. Four rows holding "Алматинская область" are
 * four reads of one string, and a string has no identity to follow — which is
 * why the row object is what a trace normally works from. When the record never
 * reaches a component, as in a table that builds its cells inline from a
 * `.map()`, there is no record to work from and only the page is left.
 *
 * Two things it can be asked, in order: what else this row shows, and — for a
 * row of nulls that shows nothing else — where it sits among the rows that do.
 * Neither ever prefers a candidate. Each either rules every other one out or
 * leaves the list exactly as long as it was.
 */

/** One field of one response that holds the value. */
export interface Field {
	responseId: number;
	path: string;
}

/**
 * How far out we look for the rest of what a record rendered, and how much one
 * container may show before it stops being a record and starts being a list.
 */
const MAX_LEVELS = 8;
const MAX_TEXTS = 80;
/** How many rows of a list are worth counting off against each other. */
const MAX_BRANCHES = 200;

/**
 * The texts a container shows, minus the one being traced.
 *
 * `undefined` when the container is no longer one record's. Two things say so,
 * and both have to be caught before anything inside is read as evidence:
 * showing the traced text a second time, which is another candidate's cell
 * sitting in the same box, and showing more text than a record ever has.
 */
function textsIn(container: Element, traced: string): string[] | undefined {
	const found: string[] = [];
	let shown = 0;

	const walk = (node: Node): boolean => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === TEXT_NODE) {
				const text = (child as Text).data.trim();
				if (text === "") continue;
				if (text === traced) {
					// The first is the one being traced; a second is another candidate.
					if (++shown > 1) return false;
					continue;
				}
				if (found.length >= MAX_TEXTS) return false;
				found.push(text);
			} else if (child.nodeType === ELEMENT_NODE && !walk(child)) {
				return false;
			}
		}
		return true;
	};

	return walk(container) ? found : undefined;
}

/**
 * What the containers around the click show, innermost first.
 *
 * A cell is rarely the only thing its record put on screen: the row around it
 * shows the name and the address of that same record, and that is the whole
 * difference between the four rows that all say "Алматинская область".
 *
 * Level by level and lazily, because the answer is usually settled by the first
 * container that holds anything, and the one above it is the whole table.
 */
function* neighbours(target: Node, traced: string): Generator<string[]> {
	let container = elementOf(target);

	for (let level = 0; container && level < MAX_LEVELS; level++) {
		const texts = textsIn(container, traced);
		if (!texts) return;
		if (texts.length > 0) yield texts;
		container = container.parentElement;
	}
}

/** A read of a text on screen, its path split ready to be compared. */
interface Nearby {
	responseId: number;
	steps: string[];
}

/** Everywhere a text on screen was read from, however the response held it. */
function readsOf(text: string): Nearby[] {
	const found: Nearby[] = [];
	for (const value of candidates(text)) {
		for (const read of findReads(value)) {
			found.push({ responseId: read.responseId, steps: segments(read.path) });
		}
	}
	return found;
}

/**
 * Whether a text came out of one of the bodies the candidates are in.
 *
 * Asked of a text that belongs to none of the candidate records: read from the
 * same body, it is another record entirely, and the box around it is therefore
 * the list rather than the row.
 */
function outside(reads: readonly Nearby[], hits: readonly Field[]): boolean {
	return reads.some((read) =>
		hits.some((hit) => read.responseId === hit.responseId),
	);
}

/** Whether a step of a path is an array index rather than a field name. */
function isIndex(step: string | undefined): boolean {
	return step !== undefined && step.startsWith("[");
}

/**
 * The step at which candidates stop being the same field of different records.
 *
 * Everything before it they share, so agreeing that far is agreeing about the
 * array rather than about a row, and only a text that reaches past it says
 * anything at all. `undefined` when candidates differ by a field name instead —
 * `[4].region` against `[4].rfdRegion` is one row showing one value in two
 * columns, and both of them are in every box the other one is.
 */
function slotOf(paths: readonly (readonly string[])[]): number | undefined {
	const first = paths[0];
	if (!first) return undefined;

	for (let step = 0; step < first.length; step++) {
		if (paths.every((path) => path[step] === first[step])) continue;
		return paths.every((path) => isIndex(path[step])) ? step : undefined;
	}
	return undefined;
}

/**
 * Which candidate the surroundings agree with.
 *
 * Only what points at exactly one of them counts. A text that fits several
 * equally — a status four rows share — cannot tell them apart and says nothing;
 * a text out of another record of the same body means this box is the list, and
 * there the search stops rather than letting the row with the most filled cells
 * win over the row that was pointed at.
 *
 * Evidence, not a preference: "the box this text sits in also shows
 * `[4].feName` and `[4].address`, and nothing of `[3]`, `[5]` or `[7]`".
 *
 * Exported for its own sake: this is the part that can be wrong, and the levels
 * it reasons over are worth handing it directly rather than through a browser.
 */
export function agreed<T extends Field>(
	hits: readonly T[],
	levels: Iterable<readonly string[]>,
): readonly T[] {
	const paths = hits.map((hit) => segments(hit.path));
	const slot = slotOf(paths);
	if (slot === undefined) return hits;

	for (const texts of levels) {
		const votes = new Set<T>();

		for (const text of texts) {
			const reads = readsOf(text);
			if (reads.length === 0) continue;

			let deepest = slot;
			let backers = 0;
			let backed: T | undefined;

			hits.forEach((hit, index) => {
				let depth = 0;
				for (const read of reads) {
					if (read.responseId !== hit.responseId) continue;
					depth = Math.max(depth, sharedSteps(paths[index] ?? [], read.steps));
				}

				// Agreeing only as far as the step they all share is agreeing about
				// the array, which every candidate is in.
				if (depth <= slot || depth < deepest) return;
				if (depth > deepest) {
					deepest = depth;
					backers = 1;
					backed = hit;
				} else backers++;
			});

			if (deepest > slot) {
				if (backed && backers === 1) votes.add(backed);
				continue;
			}
			// Read from one of these bodies, and from none of the records in
			// question: the box holding it is the list. Nothing further out is any
			// smaller, so this ends the search rather than the level.
			if (outside(reads, hits)) return hits;
		}

		const [only] = votes;
		if (votes.size === 1 && only) return [only];
		// This container renders more than one of the candidates, so it is the
		// list; everything further out only holds more of them.
		if (votes.size > 1) return hits;
	}

	return hits;
}

/** Which element of the array at `slot` a path is inside. */
function ordinalAt(
	steps: readonly string[],
	slot: number,
	prefix: readonly string[],
): number | undefined {
	for (let step = 0; step < prefix.length; step++) {
		if (steps[step] !== prefix[step]) return undefined;
	}

	const at = steps[slot];
	if (!isIndex(at) || at === undefined) return undefined;
	const ordinal = Number(at.slice(1, -1));
	return Number.isInteger(ordinal) ? ordinal : undefined;
}

/**
 * Which record a row of a list is showing, when its own texts say so.
 *
 * Only values the body holds in exactly one place are asked: a name is one row's
 * and settles it, while a status every row shares is what made this ambiguous
 * to begin with and cannot be evidence for anything now.
 */
function ordinalOf(
	branch: Element,
	slot: number,
	prefix: readonly string[],
	responseId: number,
): number | undefined {
	const texts = textsIn(branch, "");
	if (!texts) return undefined;

	let found: number | undefined;
	for (const text of texts) {
		const reads = readsOf(text).filter(
			(read) => read.responseId === responseId,
		);
		const only = reads.length === 1 ? reads[0] : undefined;
		if (!only) continue;

		const ordinal = ordinalAt(only.steps, slot, prefix);
		if (ordinal === undefined) continue;
		// Two of its texts came out of different records: not one row, and not
		// something to count positions with.
		if (found !== undefined && found !== ordinal) return undefined;
		found = ordinal;
	}
	return found;
}

/** A row of a list that could be placed, and where in the list it sits. */
interface Counted {
	at: number;
	ordinal: number;
}

/**
 * The candidates left once the row is counted off against the rows around it.
 *
 * `undefined` when this list says nothing, so the search can carry on outwards.
 * Nothing here assumes that the fifth row on screen is `[4]`: the rows either
 * side of it are placed from what they show, and the answer is whatever single
 * candidate is forced to sit between them. A list that is sorted, filtered,
 * paginated or virtualised is counted off just as correctly — and one that
 * cannot be counted at all leaves the list of candidates alone.
 */
function amongst<T extends Field>(
	hits: readonly T[],
	ordinals: readonly number[],
	list: Element,
	branch: Element,
	slot: number,
	prefix: readonly string[],
	responseId: number,
): readonly T[] | undefined {
	const branches = Array.from(list.children).slice(0, MAX_BRANCHES);
	const tracedAt = branches.indexOf(branch);
	if (tracedAt < 0 || branches.length < 2) return undefined;

	const kept = (
		fits: (ordinal: number) => boolean,
	): readonly T[] | undefined => {
		const left = hits.filter((_, index) => fits(ordinals[index] ?? -1));
		return left.length > 0 && left.length < hits.length ? left : undefined;
	};

	const placed: Counted[] = [];
	for (const [at, child] of branches.entries()) {
		// The row being pointed at is the hole this is working out, and what it
		// shows was already asked, under guards this loop does not have.
		if (at === tracedAt) continue;
		const ordinal = ordinalOf(child, slot, prefix, responseId);
		if (ordinal !== undefined) placed.push({ at, ordinal });
	}
	// One row either side of it, or there is nothing to be between.
	if (placed.length < 2) return undefined;

	// A list counts up or it counts down. One that does neither is not something
	// to read positions off, whatever else it is.
	const ordered = placed.every(
		(row, index) =>
			index === 0 || row.ordinal > (placed[index - 1]?.ordinal ?? 0),
	);
	const reversed = placed.every(
		(row, index) =>
			index === 0 || row.ordinal < (placed[index - 1]?.ordinal ?? 0),
	);
	if (!ordered && !reversed) return undefined;

	const before = placed.findLast((row) => row.at < tracedAt);
	const after = placed.find((row) => row.at > tracedAt);
	// A row at the end of the list is bounded on one side only, and one bound
	// forces nothing.
	if (!before || !after) return undefined;

	const low = Math.min(before.ordinal, after.ordinal);
	const high = Math.max(before.ordinal, after.ordinal);
	return kept((candidate) => candidate > low && candidate < high);
}

/**
 * Which row of a list the click landed in, read off the rows around it.
 *
 * The answer for a row of nulls: it shows nothing of its own to be recognised
 * by, but it sits between two rows that do, and only one candidate fits there.
 */
function counted<T extends Field>(
	hits: readonly T[],
	target: Node,
): readonly T[] {
	const [first] = hits;
	// Rows of two different responses have no order between them to count off.
	if (!first || hits.some((hit) => hit.responseId !== first.responseId)) {
		return hits;
	}

	const paths = hits.map((hit) => segments(hit.path));
	const slot = slotOf(paths);
	if (slot === undefined) return hits;

	const prefix = paths[0]?.slice(0, slot) ?? [];
	const ordinals: number[] = [];
	for (const steps of paths) {
		const ordinal = ordinalAt(steps, slot, prefix);
		if (ordinal === undefined) return hits;
		ordinals.push(ordinal);
	}

	let branch = elementOf(target);
	for (let level = 0; branch?.parentElement && level < MAX_LEVELS; level++) {
		const list = branch.parentElement;
		const found = amongst(
			hits,
			ordinals,
			list,
			branch,
			slot,
			prefix,
			first.responseId,
		);
		if (found) return found;
		branch = list;
	}
	return hits;
}

/**
 * Everything the page can say about which candidate this is.
 *
 * What the row shows first, because a name in the cell next door is the
 * shortest possible proof. Counting rows off against each other second, because
 * it is the only thing left when the row shows nothing at all.
 */
export function narrow<T extends Field>(
	hits: readonly T[],
	target: Node,
): readonly T[] {
	if (hits.length < 2) return hits;

	const shown = agreed(hits, neighbours(target, textOf(target).trim()));
	return shown.length < hits.length ? shown : counted(hits, target);
}
