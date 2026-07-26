/** A single HTTP response we recorded and can trace values back to. */
export interface RequestMeta {
	method: string;
	url: string;
	status: number;
	/** Epoch ms when the request started. */
	startedAt: number;
	durationMs: number;
}

/** One step of the chain, rendered as one line in the panel. */
export interface Hop {
	kind: "response" | "read" | "component";
	/** Human readable label, e.g. `items[3].contractor.name` or `<WorkRow>`. */
	label: string;
	file?: string;
	line?: number;
	column?: number;
}

/**
 * The answer to "where did this come from?".
 *
 * `broken` is deliberately part of the contract: a value that passed through a
 * transform which created a new primitive cannot be traced any further, and
 * saying so is the whole point. We never guess.
 */
export interface Provenance {
	value: unknown;
	/**
	 * Path inside the response body, e.g. `items[3].contractor.name`. Set only
	 * when exactly one field holds the value.
	 */
	path?: string;
	/**
	 * Every field that holds the value, when it could not be narrowed to one.
	 * Present instead of `path`, never alongside it — a list of two is the
	 * honest answer where naming the first would be a wrong one.
	 */
	ambiguous?: string[];
	request?: RequestMeta;
	/** Parsed response body as recorded, for showing it inline. */
	response?: unknown;
	hops: Hop[];
	broken: boolean;
}
