import { childPath } from "./path";
import { type RecordedResponse, recorded, revision } from "./store";
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

/**
 * How deep into a body we look, and how many nodes of it we take. The visit
 * budget is spent once per body now that bodies are indexed rather than walked
 * per query, so it can afford to be large enough for any real response.
 */
const MAX_DEPTH = 10;
const MAX_VISITS = 200_000;

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

/**
 * One recorded body, turned inside out.
 *
 * Placing a record by walking every recorded body measured at 15ms per cell
 * with fifty responses of five hundred rows held — acceptable for a click and
 * hopeless for a pointer crossing a table, where a whole frame is 16ms.
 * Indexed, the walk becomes a lookup and the same case costs 1.5ms; a record
 * that cannot be placed at all falls from 15ms to 0.02ms.
 *
 * Built from the body as it was recorded, once. An app that mutated a response
 * in place afterwards would leave this stale; React apps replace rather than
 * mutate, and the alternative costs those 15ms on every cell.
 */
interface Index {
	/** Path of every node, so a match can say where it sits. */
	paths: Map<object, string>;
	/** Which nodes hold exactly this value under this field name. */
	byField: Map<string, Map<Primitive, object[]>>;
}

/** Keyed by the response, so an evicted body takes its index with it. */
const indexes = new WeakMap<RecordedResponse, Index>();

function indexOf(response: RecordedResponse): Index {
	const cached = indexes.get(response);
	if (cached) return cached;

	const index: Index = { paths: new Map(), byField: new Map() };
	let visits = 0;

	const walk = (node: unknown, path: string, depth: number): void => {
		if (node === null || typeof node !== "object") return;
		if (depth > MAX_DEPTH || ++visits > MAX_VISITS) return;

		index.paths.set(node, path);
		const isArray = Array.isArray(node);

		for (const [key, child] of Object.entries(node)) {
			if (!isArray && isPrimitive(child)) {
				let values = index.byField.get(key);
				if (!values) {
					values = new Map();
					index.byField.set(key, values);
				}
				const holders = values.get(child);
				if (holders) holders.push(node);
				else values.set(child, [node]);
			}
			walk(child, childPath(path, key, isArray), depth + 1);
		}
	};

	walk(response.body, "", 0);
	indexes.set(response, index);
	return index;
}

/**
 * The closest matches inside one body.
 *
 * Counted first, verified after, thickest first. `agreement` returns either
 * zero or every field the node shares, and a node can only share a field the
 * index already counted it for — so the first level that verifies is the best
 * this body has, and thinner ones cannot beat it.
 */
function matches(
	index: Index,
	wanted: Map<string, Primitive>,
	responseId: number,
): Placement[] {
	const counts = new Map<object, number>();
	for (const [name, value] of wanted) {
		for (const node of index.byField.get(name)?.get(value) ?? []) {
			counts.set(node, (counts.get(node) ?? 0) + 1);
		}
	}
	if (counts.size === 0) return [];

	const byLevel = new Map<number, object[]>();
	for (const [node, count] of counts) {
		const level = byLevel.get(count);
		if (level) level.push(node);
		else byLevel.set(count, [node]);
	}

	const levels = [...byLevel.keys()].sort((first, second) => second - first);
	for (const level of levels) {
		const found: Placement[] = [];

		for (const node of byLevel.get(level) ?? []) {
			const score = agreement(node, wanted);
			const path = index.paths.get(node);
			if (score > 0 && path !== undefined) {
				found.push({ responseId, path, node, score });
			}
		}
		if (found.length > 0) return found;
	}
	return [];
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

	// Every response, not just the newest: a record matching one field of a
	// fresher body from another endpoint must lose to the record that matches
	// six fields of an older one, and that can only be judged across all of them.
	for (const response of recorded()) {
		const index = indexOf(response);

		const itself = index.paths.get(subject);
		if (itself !== undefined) {
			found.push({
				responseId: response.id,
				path: itself,
				node: subject,
				score: Number.POSITIVE_INFINITY,
			});
			continue;
		}

		found.push(...matches(index, wanted, response.id));
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
