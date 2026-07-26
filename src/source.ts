export interface Excerpt {
	/** Source lines around the target, in order. */
	lines: string[];
	/** One-based number of the first line in `lines`. */
	first: number;
	/** One-based number of the line the chain points at. */
	target: number;
}

/**
 * Pulls file content out of what a dev server answers for `?raw`.
 *
 * Vite replies with a module whose default export is the file as one JSON
 * string, so the literal can be matched exactly rather than guessed at. A
 * different server answers something else, and the caller shows nothing.
 */
export function extract(moduleText: string): string | undefined {
	const match = /export default\s+("(?:[^"\\]|\\.)*")/.exec(moduleText);
	if (!match?.[1]) return undefined;
	try {
		return JSON.parse(match[1]) as string;
	} catch {
		return undefined;
	}
}

/** Both shapes an inspector might have written: rooted, or absolute on disk. */
function urlsFor(file: string): string[] {
	return file.startsWith("/")
		? [`/@fs${file}?raw`, `${file}?raw`]
		: [`/${file}?raw`, `/@fs/${file}?raw`];
}

async function read(file: string): Promise<string | undefined> {
	for (const url of urlsFor(file)) {
		try {
			const response = await fetch(url);
			if (!response.ok) continue;
			const source = extract(await response.text());
			if (source !== undefined) return source;
		} catch {
			// Try the next shape; a dead end here just means no excerpt.
		}
	}
	return undefined;
}

/** Splits an excerpt around a line, clamped to the file. Pure, so it is tested. */
export function around(source: string, line: number, radius: number): Excerpt {
	const all = source.split("\n");
	const first = Math.max(1, line - radius);
	const last = Math.min(all.length, line + radius);
	return { lines: all.slice(first - 1, last), first, target: line };
}

/** The lines around `line` of `file`, or nothing if the server will not say. */
export async function excerpt(
	file: string,
	line: number,
	radius = 4,
): Promise<Excerpt | undefined> {
	const source = await read(file);
	return source === undefined ? undefined : around(source, line, radius);
}
