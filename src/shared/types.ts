/** A single HTTP response we recorded and can trace values back to. */
export interface RequestMeta {
	method: string;
	url: string;
	status: number;
	/** Epoch ms when the request started. */
	startedAt: number;
	durationMs: number;
	/**
	 * The headers the app set on the request, lower-cased.
	 *
	 * Only what the app asked for: a browser adds `Cookie`, `Origin` and the rest
	 * after JavaScript is done with the request, and never lets it read them
	 * back. Kept so the call can be reproduced outside the page — which is what
	 * makes the difference between a `curl` that answers and one that 401s.
	 */
	headers?: Record<string, string>;
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
	 * Why there is no `at`, when we can tell.
	 *
	 * A frame with no line and no reason is indistinguishable from a broken
	 * tool, and each of these has a different answer: `untracked` is fixed by
	 * reloading, `unmapped` by a dev server that emits source maps, and
	 * `inlined` by nothing at all.
	 *
	 * - `untracked` — React had stopped recording call sites. It keeps the first
	 *   ten thousand and hands out a shared placeholder after that.
	 * - `inlined` — React was recording, but the engine left no frame for the
	 *   component in the stack it captured.
	 * - `unmapped` — a position was recorded, in a bundler's output, and no
	 *   source map could say where it was written.
	 * - `unrecorded` — this build of React records no positions at all.
	 */
	missing?: "untracked" | "inlined" | "unmapped" | "unrecorded";
	/**
	 * The stack React captured, kept only when it named no frame of the app's
	 * own. There is no way to tell from the outside why an engine left a frame
	 * out, so the evidence is carried through and can be read rather than
	 * described — the panel prints it on request.
	 */
	stack?: string;
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
	/** Who rendered it, outermost first. Empty outside React. */
	tree: Frame[];
	broken: boolean;
}
