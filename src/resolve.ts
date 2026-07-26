import { entriesOf, isRecordLike, pathsOf, place } from "./match";
import { joinPath, within } from "./path";
import { findReads, findResponse } from "./store";
import type { Hop, Provenance } from "./types";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Attributes written by source inspectors. Ours first, then TanStack's. */
const SOURCE_ATTRIBUTES = ["data-camefrom-source", "data-tsd-source"];

/** How far up we look for the object a component was handed. */
const MAX_FIBERS = 40;
/** What one click may weigh: objects considered, and how far into each we open. */
const MAX_SCOPES = 64;
const MAX_INSIDE = 32;

interface Source {
	file: string;
	line?: number;
	column?: number;
}

/** The little of a React fiber we need. */
interface Fiber {
	return: Fiber | null;
	type?: unknown;
	elementType?: unknown;
	memoizedProps?: unknown;
}

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
			broken: false,
		};
	}

	// Nothing matched. Say so rather than offer the nearest guess.
	return { value: text, hops: [], broken: true };
}

function elementOf(node: Node): Element | null {
	return node.nodeType === ELEMENT_NODE
		? (node as Element)
		: node.parentElement;
}

function fiberOf(element: Element): Fiber | undefined {
	for (const key of Object.keys(element)) {
		if (key.startsWith("__reactFiber$")) {
			return (element as unknown as Record<string, Fiber>)[key];
		}
	}
	return undefined;
}

function nearestFiber(node: Node): Fiber | undefined {
	let element = elementOf(node);
	while (element) {
		const fiber = fiberOf(element);
		if (fiber) return fiber;
		element = element.parentElement;
	}
	return undefined;
}

function componentName(fiber: Fiber | undefined): string | undefined {
	let current = fiber;
	while (current) {
		const type = current.type ?? current.elementType;
		if (
			typeof type === "function" ||
			(typeof type === "object" && type !== null)
		) {
			const named = type as { displayName?: string; name?: string };
			const name = named.displayName ?? named.name;
			if (name) return name;
		}
		current = current.return ?? undefined;
	}
	return undefined;
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

function sourceOf(node: Node): Source | undefined {
	const element = elementOf(node);
	if (!element) return undefined;

	for (const attribute of SOURCE_ATTRIBUTES) {
		const raw = element.closest(`[${attribute}]`)?.getAttribute(attribute);
		if (!raw) continue;
		const match = /^(.+):(\d+):(\d+)$/.exec(raw);
		if (match?.[1]) {
			return {
				file: match[1],
				line: Number(match[2]),
				column: Number(match[3]),
			};
		}
		return { file: raw };
	}
	return undefined;
}

/** Answer for a node in the page: the field it came from and who rendered it. */
export function resolve(target: Node | null): Provenance | null {
	if (!target) return null;

	const text = textOf(target);
	if (text.trim() === "") return null;

	const fiber = nearestFiber(target);
	const provenance = traceText(text, scopesOf(fiber));
	const name = componentName(fiber);
	const source = sourceOf(target);

	if (name || source) {
		provenance.hops.push({
			kind: "component",
			label: name ? `<${name}>` : (source?.file ?? ""),
			file: source?.file,
			line: source?.line,
			column: source?.column,
		});
	}

	return provenance;
}
