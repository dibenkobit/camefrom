import { childPath } from "./path";
import { recorded, revision } from "./store";
import { originOf } from "./taint";

/**
 * Placing an object the app is holding back inside a response body.
 *
 * The identity of a tainted proxy is the exact answer, and it is the answer we
 * take whenever it survives. It usually does not: `{ ...row }`, an immer draft,
 * a `select` in TanStack Query, any normaliser — each hands the component a
 * fresh object that remembers nothing. What the fresh object still carries is
 * the record's own fields, and `id: 60` is enough to tell row 60 from row 59.
 */

/** Where an object sits in a recorded response. */
export interface Placement {
	responseId: number;
	path: string;
	/**
	 * The node as the response holds it. Field names have to come from here: a
	 * mapper that renamed `full_name` to `label` must not make us report a
	 * `label` the response never had.
	 */
	node: object;
	/** Fields that agreed. Higher is closer; `Infinity` is the same object. */
	score: number;
}

/** How deep into a body we look, and how much of one click may cost. */
const MAX_DEPTH = 10;
const MAX_VISITS = 40_000;

type Primitive = string | number | boolean | null;

function isPrimitive(value: unknown): value is Primitive {
	if (value === null) return true;
	const kind = typeof value;
	return kind === "string" || kind === "number" || kind === "boolean";
}

/**
 * Whether this is something a record could be hiding in.
 *
 * Deliberately not restricted by prototype: a table library hands the cell its
 * own `Row` instance with the record on `.original`, and refusing class
 * instances would lose exactly the case that matters most.
 */
export function isRecordLike(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false;
	// JSX, not data.
	if ("$$typeof" in value) return false;
	// A DOM node: huge, cyclic, and never came out of a response.
	if (typeof (value as { nodeType?: unknown }).nodeType === "number")
		return false;
	return !(
		value instanceof Date ||
		value instanceof RegExp ||
		value instanceof Error ||
		value instanceof Promise ||
		value instanceof Map ||
		value instanceof Set
	);
}

/**
 * Own data properties, without ever invoking a getter.
 *
 * Two reasons, both of them bugs otherwise: a click must not run someone
 * else's accessor, and reading a tainted proxy the normal way would record a
 * read no component ever made and poison the value index we search next.
 */
export function entriesOf(value: object): Array<[string, unknown]> {
	const isArray = Array.isArray(value);
	const entries: Array<[string, unknown]> = [];

	for (const key of Object.getOwnPropertyNames(value)) {
		if (isArray && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) continue;
		entries.push([key, descriptor.value]);
	}
	return entries;
}

/** The record's own primitive fields — its fingerprint. */
function fields(value: object): Map<string, Primitive> {
	const found = new Map<string, Primitive>();
	for (const [key, held] of entriesOf(value)) {
		if (isPrimitive(held)) found.set(key, held);
	}
	return found;
}

/** How many of `wanted`'s fields this node agrees with. Zero if any disagrees. */
function agreement(node: object, wanted: Map<string, Primitive>): number {
	let shared = 0;

	for (const [key, value] of wanted) {
		const descriptor = Object.getOwnPropertyDescriptor(node, key);
		if (!descriptor || !("value" in descriptor)) continue;
		const held: unknown = descriptor.value;
		if (!isPrimitive(held)) continue;

		// One field that disagrees settles it: this is a different record, not a
		// looser match. Telling row 60 from row 59 rests on exactly this line.
		if (held !== value) return 0;
		shared++;
	}
	return shared;
}

/** Only the closest matches: agreeing on six fields beats agreeing on one. */
function closest(found: Placement[]): Placement[] {
	if (found.length < 2) return found;

	let top = 0;
	for (const placement of found) top = Math.max(top, placement.score);
	return found.filter((placement) => placement.score === top);
}

/**
 * Placing the same row over and over is what hovering a table is: the cursor
 * crosses ten cells of one record. Kept until a response changes the answer.
 */
const placed = new WeakMap<object, { at: number; placements: Placement[] }>();

/**
 * Every place in a recorded response this object could have come from.
 *
 * Empty when it cannot be placed — which is an answer, and a better one than
 * the nearest guess.
 */
export function place(subject: object): Placement[] {
	const cached = placed.get(subject);
	if (cached && cached.at === revision()) return cached.placements;

	const placements = search(subject);
	placed.set(subject, { at: revision(), placements });
	return placements;
}

function search(subject: object): Placement[] {
	const origin = originOf(subject);
	if (origin) {
		return [
			{
				responseId: origin.responseId,
				path: origin.path,
				node: subject,
				score: Number.POSITIVE_INFINITY,
			},
		];
	}

	const wanted = fields(subject);
	if (wanted.size === 0) return [];

	const found: Placement[] = [];

	for (const response of recorded()) {
		let visits = 0;

		const walk = (node: unknown, path: string, depth: number): void => {
			if (node === null || typeof node !== "object") return;
			if (depth > MAX_DEPTH || ++visits > MAX_VISITS) return;

			if (node === subject) {
				found.push({
					responseId: response.id,
					path,
					node,
					score: Number.POSITIVE_INFINITY,
				});
				return;
			}

			const isArray = Array.isArray(node);
			if (!isArray) {
				const score = agreement(node, wanted);
				if (score > 0) {
					found.push({ responseId: response.id, path, node, score });
				}
			}

			for (const [key, child] of Object.entries(node)) {
				walk(child, childPath(path, key, isArray), depth + 1);
			}
		};

		walk(response.body, "", 0);
	}

	return closest(found);
}

/**
 * Paths inside `subject`, relative to it, whose value is `wanted`.
 *
 * The clicked text is rarely a top-level field of the row the component was
 * handed — `row.contractor.name` is the normal shape — so this looks inside.
 */
export function pathsOf(subject: object, wanted: unknown): string[] {
	const paths: string[] = [];
	let visits = 0;

	const walk = (node: unknown, path: string, depth: number): void => {
		if (node === null || typeof node !== "object") return;
		if (depth > MAX_DEPTH || ++visits > MAX_VISITS) return;

		const isArray = Array.isArray(node);
		for (const [key, child] of entriesOf(node)) {
			const here = childPath(path, key, isArray);
			if (child === wanted) paths.push(here);
			else if (isRecordLike(child)) walk(child, here, depth + 1);
		}
	};

	walk(subject, "", 0);
	return paths;
}
