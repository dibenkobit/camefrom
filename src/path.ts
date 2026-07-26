/**
 * Paths into a response body, in one convention: `items[3].contractor.name`.
 *
 * Kept in one place because the recorder, the matcher and the JSON printer all
 * have to agree on them, and a disagreement surfaces as a confidently wrong
 * answer rather than as an error.
 */

/** Extends a path by one step. `isIndex` picks brackets over a dot. */
export function childPath(
	parent: string,
	key: string,
	isIndex: boolean,
): string {
	if (isIndex) return `${parent}[${key}]`;
	return parent ? `${parent}.${key}` : key;
}

/** Joins a path relative to an object onto the path of the object itself. */
export function joinPath(base: string, relative: string): string {
	if (relative === "") return base;
	if (base === "") return relative;
	return relative.startsWith("[")
		? `${base}${relative}`
		: `${base}.${relative}`;
}

/**
 * Whether `path` is `scope` itself or something inside it.
 *
 * Aware of where a segment ends, on purpose: a plain `startsWith` lets the
 * scope `user.name` claim `user.nameSuffix`, and answering with the wrong
 * field is the one thing this package must not do.
 */
export function within(scope: string, path: string): boolean {
	if (scope === "") return true;
	if (!path.startsWith(scope)) return false;
	const next = path[scope.length];
	return next === undefined || next === "." || next === "[";
}
