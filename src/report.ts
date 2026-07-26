import type { Provenance } from "./types";

/** Candidates worth reading one by one before a count says more. */
const MAX_LISTED = 6;

/** How the value itself is announced. Strings keep their quotes. */
function title(value: unknown): string {
	return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * The chain as lines, nearest step first. Pure, so the wording is testable
 * without a console.
 */
export function format(provenance: Provenance): string[] {
	const lines = provenance.hops.map((hop) => {
		const where = hop.file
			? `${hop.file}${hop.line ? `:${hop.line}` : ""}`
			: undefined;
		return where ? `← ${hop.label} · ${where}` : `← ${hop.label}`;
	});

	// Which of them it is cannot be told apart from here, so all of them are
	// named. A single confident line would be the more useful shape and the
	// wrong one.
	if (provenance.ambiguous) {
		for (const path of provenance.ambiguous.slice(0, MAX_LISTED)) {
			lines.push(`  ? ${path}`);
		}
		const rest = provenance.ambiguous.length - MAX_LISTED;
		if (rest > 0) lines.push(`  ? …${rest} more`);
	}

	if (provenance.broken) {
		// The honest ending. A tool that guesses confidently is worse than no
		// tool, so an unreachable chain says so instead of trailing off.
		lines.push("✗ not read from any recorded response");
	}
	return lines;
}

/**
 * Print a chain where the developer already is.
 *
 * The response body goes in as an object rather than as text, so the console's
 * own inspector does the browsing and there is no reason to open the network
 * panel at all.
 */
export function report(provenance: Provenance): void {
	console.group(`camefrom ${title(provenance.value)}`);
	for (const line of format(provenance)) console.log(line);
	if (provenance.response !== undefined)
		console.log("response", provenance.response);
	console.groupEnd();
}
