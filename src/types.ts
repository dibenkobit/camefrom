/** A single HTTP response we recorded and can trace values back to. */
export interface RequestMeta {
	method: string;
	url: string;
	status: number;
	/** Epoch ms when the request started. */
	startedAt: number;
	durationMs: number;
}

/** A place in a source file, as an editor would be told to open it. */
export interface Position {
	file: string;
	line: number;
	column: number;
	/**
	 * The URL of the module this position is really inside, when it came off a
	 * stack trace and therefore describes a bundler's output rather than the file
	 * anybody wrote. Set means the line has to be mapped back before it is shown;
	 * the module's own source map is what does that.
	 */
	bundle?: string;
}

/** One step of the chain, rendered as one line in the panel. */
export interface Hop {
	kind: "response" | "read";
	/** Human readable label, e.g. `items[3].contractor.name`. */
	label: string;
}

/**
 * One component of the tree that rendered the value, outermost first.
 *
 * The tree rather than the nearest component alone: knowing a `<Cell>` showed
 * the text is no help when there are forty of them, and the column that built
 * it is three frames up.
 */
export interface Frame {
	/** `WorkRow` for a component, `td` for a host element. */
	name: string;
	/** Where its JSX is written, when React or an inspector recorded it. */
	at?: Position;
	/**
	 * Set when React had already stopped recording positions by the time this
	 * element was created — it keeps the call site of the first ten thousand and
	 * nothing after. Tells a position we failed to read apart from one that was
	 * never written down, which is the difference between a bug and a reload.
	 */
	untracked?: boolean;
	/** The innermost frame: the one that rendered the text you pointed at. */
	target: boolean;
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
	/** Who rendered it, outermost first. Empty outside React. */
	tree: Frame[];
	broken: boolean;
}
