import type { RequestMeta } from "../shared/types";

/** Responses kept for inspection. Older ones fall off the end. */
const MAX_RESPONSES = 50;
/** Distinct values we can look up. Oldest keys are evicted first. */
const MAX_TRACKED_VALUES = 20_000;

export interface RecordedResponse extends RequestMeta {
	id: number;
	body: unknown;
}

/** One primitive we saw being read out of a response body. */
export interface RecordedRead {
	responseId: number;
	/** Path inside the body, e.g. `items[3].contractor.name`. */
	path: string;
}

const responses: RecordedResponse[] = [];
const readsByValue = new Map<unknown, RecordedRead[]>();

let nextId = 1;
let revisionCount = 0;

/**
 * Bumped whenever what we know changes.
 *
 * Callers cache answers derived from the store; a request that lands between
 * two hovers has to invalidate them, or the panel keeps repeating a conclusion
 * that was only true a moment ago.
 */
export function revision(): number {
	return revisionCount;
}

export function recordResponse(
	meta: RequestMeta,
	body: unknown,
): RecordedResponse {
	const response: RecordedResponse = { ...meta, id: nextId++, body };
	responses.push(response);
	if (responses.length > MAX_RESPONSES) responses.shift();
	revisionCount++;
	return response;
}

export function findResponse(id: number): RecordedResponse | undefined {
	return responses.find((response) => response.id === id);
}

/**
 * Everything still kept, newest first.
 *
 * Newest first because a value that appears in a stale response and in the one
 * that just arrived came from the one that just arrived.
 */
export function recorded(): readonly RecordedResponse[] {
	return responses.slice().reverse();
}

/**
 * Remember that `value` was read at `path` of a response.
 *
 * Indexed by value rather than by path: the question we answer starts from a
 * value on screen and works backwards, never the other way round.
 */
export function recordRead(
	responseId: number,
	path: string,
	value: unknown,
): void {
	const existing = readsByValue.get(value);
	if (existing) {
		const known = existing.some(
			(read) => read.responseId === responseId && read.path === path,
		);
		if (!known) existing.push({ responseId, path });
		return;
	}

	if (readsByValue.size >= MAX_TRACKED_VALUES) {
		const oldest = readsByValue.keys().next();
		if (!oldest.done) readsByValue.delete(oldest.value);
	}
	readsByValue.set(value, [{ responseId, path }]);
}

/** Every place this exact value was read from. Empty when we never saw it. */
export function findReads(value: unknown): readonly RecordedRead[] {
	return readsByValue.get(value) ?? [];
}

/** Drops everything recorded so far. */
export function reset(): void {
	responses.length = 0;
	readsByValue.clear();
	nextId = 1;
	revisionCount++;
}
