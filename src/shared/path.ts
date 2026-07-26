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
 * The steps of a path: `items[3].contractor.name` is four of them.
 *
 * Split rather than compared as text, because the question asked of two paths
 * is how much of one record they agree on — and `items[3]` shares eight
 * characters with `items[30]` while sharing no step at all.
 */
export function segments(path: string): string[] {
	const steps: string[] = [];
	let step = "";

	for (const character of path) {
		if (character === ".") {
			if (step) steps.push(step);
			step = "";
		} else if (character === "[") {
			if (step) steps.push(step);
			step = "[";
		} else {
			step += character;
		}
	}

	if (step) steps.push(step);
	return steps;
}

/** How many leading steps two paths share: how much of one record they are. */
export function sharedSteps(
	first: readonly string[],
	second: readonly string[],
): number {
	let shared = 0;
	while (
		shared < first.length &&
		shared < second.length &&
		first[shared] === second[shared]
	) {
		shared++;
	}
	return shared;
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
