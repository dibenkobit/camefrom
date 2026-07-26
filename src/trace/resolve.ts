import { findReads, findResponse } from "../capture/store";
import { attributeOf, type Fiber, nearestFiber, treeOf } from "../react/fiber";
import { ELEMENT_NODE, elementOf, TEXT_NODE } from "../shared/dom";
import { joinPath, within } from "../shared/path";
import type { Frame, Hop, Provenance } from "../shared/types";
import { entriesOf, isRecordLike, pathsOf, place } from "./match";

/** How far up we look for the object a component was handed. */
const MAX_FIBERS = 40;
/** What one click may weigh: objects considered, and how far into each we open. */
const MAX_SCOPES = 64;
const MAX_INSIDE = 32;

/** The text a node shows itself, without sweeping up everything below it. */
export function textOf(node: Node): string {
	if (node.nodeType === TEXT_NODE) return (node as Text).data;
	if (node.nodeType !== ELEMENT_NODE) return "";

	let direct = "";
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === TEXT_NODE) direct += (child as Text).data;
	}
	return direct.trim() === "" ? (node.textContent ?? "") : direct;
}

/**
 * What the text on screen might have been before it was rendered. A cell
 * showing `42` was a number in the response, not the string it is now.
 */
function* candidates(text: string): Generator<unknown> {
	const trimmed = text.trim();
	yield trimmed;
	if (trimmed !== text) yield text;
	if (trimmed !== "") {
		const asNumber = Number(trimmed);
		if (Number.isFinite(asNumber)) yield asNumber;
	}
}

/** One field of one response that holds the value. */
interface Located {
	responseId: number;
	path: string;
}

/** One field is one answer, however many recorded copies of it we hold. */
function unique(located: readonly Located[]): Located[] {
	const byPath = new Map<string, Located>();
	for (const hit of located) {
		if (!byPath.has(hit.path)) byPath.set(hit.path, hit);
	}
	return [...byPath.values()];
}

/**
 * Which field holds this value, worked out from the objects around the click.
 *
 * This is the part that tells row 60 from row 59, and it runs in the only
 * direction that can: from the record the component was handed, down to the
 * field of it that equals the text, then back to where that record sits in the
 * body. The value alone is never asked, because in a table it cannot answer.
 */
function locate(value: unknown, scopes: readonly object[]): Located[] {
	for (const scope of scopes) {
		// Has this record anything to do with the text at all? Cheapest question
		// first, and it is the one that makes a scope worth placing.
		if (pathsOf(scope, value).length === 0) continue;

		// It holds the text but we cannot say where it came from. A wider object
		// may still know — a wrapper rarely does, the container it sits in does.
		const placements = place(scope);
		if (placements.length === 0) continue;

		const located: Located[] = [];
		for (const placement of placements) {
			// Read the field name off the response, never off the copy.
			for (const relative of pathsOf(placement.node, value)) {
				located.push({
					responseId: placement.responseId,
					path: joinPath(placement.path, relative),
				});
			}
		}
		if (located.length > 0) return unique(located);
	}
	return [];
}

/**
 * Every read of this value anywhere, narrowed to the click when possible.
 *
 * The last resort: the value reached the screen without the record it came
 * from being anywhere near the components that rendered it — through a store,
 * a context, a formatter. Narrowing by the objects we _can_ place keeps the
 * answer as small as the truth allows.
 */
function anywhere(value: unknown, scopes: readonly object[]): Located[] {
	const reads = unique(findReads(value));
	if (reads.length < 2) return reads;

	for (const scope of scopes) {
		const placements = place(scope);
		if (placements.length === 0) continue;

		const narrowed = reads.filter((read) =>
			placements.some((placement) => within(placement.path, read.path)),
		);
		if (narrowed.length > 0) return narrowed;
	}
	return reads;
}

/**
 * The data half of the answer: which response field holds this text.
 *
 * Pure on purpose — the join is the part that can be wrong, and it should be
 * exercisable without a browser.
 */
export function traceText(
	text: string,
	scopes: readonly object[] = [],
): Provenance {
	for (const candidate of candidates(text)) {
		const near = locate(candidate, scopes);
		const hits = near.length > 0 ? near : anywhere(candidate, scopes);
		const first = hits[0];
		if (!first) continue;

		const settled = hits.length === 1;
		const response = findResponse(first.responseId);
		const hops: Hop[] = [
			{
				kind: "read",
				label: settled ? first.path : `${hits.length} fields hold this value`,
			},
		];
		if (response) {
			hops.push({
				kind: "response",
				label: `${response.method} ${response.url} · ${response.status} · ${response.durationMs}ms`,
			});
		}

		return {
			value: candidate,
			path: settled ? first.path : undefined,
			// Which one it is cannot be told from here. Saying so is the answer;
			// picking the first would be the same bug the row lookup exists to fix.
			ambiguous: settled ? undefined : hits.map((hit) => hit.path),
			request: response,
			response: response?.body,
			hops,
			tree: [],
			broken: false,
		};
	}

	// Nothing matched. Say so rather than offer the nearest guess.
	return { value: text, hops: [], tree: [], broken: true };
}

/**
 * The objects the components around the click were handed, nearest first.
 *
 * Props, and one level inside each of them: a table library hands the cell a
 * wrapper of its own — TanStack Table's is `{ row }` with the record sitting on
 * `row.original` — and the wrapper never came out of a response.
 */
function scopesOf(fiber: Fiber | undefined): object[] {
	const scopes: object[] = [];
	const seen = new WeakSet<object>();

	const add = (value: unknown): boolean => {
		if (!isRecordLike(value)) return false;
		if (!seen.has(value) && scopes.length < MAX_SCOPES) {
			seen.add(value);
			scopes.push(value);
		}
		return true;
	};

	let current = fiber;
	for (
		let step = 0;
		current && step < MAX_FIBERS && scopes.length < MAX_SCOPES;
		step++
	) {
		const props = current.memoizedProps;
		if (props !== null && typeof props === "object") {
			const held = entriesOf(props)
				.map(([, value]) => value)
				.filter(isRecordLike);

			// Whole props before their fields: the record is more often the prop
			// than something hanging off it, and nearest wins.
			for (const value of held) add(value);
			for (const value of held) {
				let opened = 0;
				for (const [, nested] of entriesOf(value)) {
					if (opened >= MAX_INSIDE) break;
					if (add(nested)) opened++;
				}
			}
		}
		current = current.return ?? undefined;
	}
	return scopes;
}

/**
 * The tree, with whatever an inspector wrote on the DOM filled in.
 *
 * React only records positions in a development build, and the Babel transform
 * that used to provide them is gone in React 19. Where it recorded nothing, a
 * `data-tsd-source` left by another inspector describes the element that was
 * pointed at — which is the innermost frame, and the most precise one.
 */
function positioned(tree: Frame[], target: Node): Frame[] {
	const innermost = tree.at(-1);
	if (innermost?.at) return tree;

	const at = attributeOf(target);
	if (!at) return tree;
	if (innermost) {
		innermost.at = at;
		// Whatever React failed to record, an inspector did. Leaving the reason
		// on a frame that now has a position would contradict it.
		delete innermost.missing;
		return tree;
	}

	// No fiber at all, but something knows where this came from. Naming the tag
	// is honest: it is what rendered the text, we just cannot say what wrote it.
	const tag = elementOf(target)?.tagName.toLowerCase();
	return tag ? [{ name: tag, at, target: true }] : tree;
}

/** Answer for a node in the page: the field it came from and who rendered it. */
export function resolve(target: Node | null): Provenance | null {
	if (!target) return null;

	const text = textOf(target);
	if (text.trim() === "") return null;

	const fiber = nearestFiber(target);
	const provenance = traceText(text, scopesOf(fiber));
	provenance.tree = positioned(treeOf(fiber), target);
	return provenance;
}
