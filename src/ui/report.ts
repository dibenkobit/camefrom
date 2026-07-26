import type { Frame, Provenance } from "../shared/types";
import { locate } from "../source/sourcemap";

/** Candidates worth reading one by one before a count says more. */
const MAX_LISTED = 6;

/**
 * How the value itself is announced. Strings keep their quotes.
 *
 * Exported so the panel and the clipboard say it the same way. Three copies of
 * one sentence drift, and the one on the clipboard ends up in a ticket.
 */
export function title(value: unknown): string {
	return typeof value === "string" ? `"${value}"` : String(value);
}

/** Why a frame has no line. A row with neither reads as a broken tool. */
const MISSING: Record<NonNullable<Frame["missing"]>, string> = {
	untracked: "React stopped recording call sites; reload to get them back",
	inlined: "no frame for it in the stack React captured",
	unmapped: "no source map for the module it is in",
	unrecorded: "this build of React records no positions",
};

/** `<WorkRow>  src/works.tsx:41`, indented to its depth in the tree. */
function frame(entry: Frame, depth: number): string {
	const indent = "  ".repeat(depth + 1);
	const at = entry.at;
	if (at && at.line > 0)
		return `${indent}<${entry.name}> · ${at.file}:${at.line}`;

	const why = entry.missing ? ` · ${MISSING[entry.missing]}` : "";
	return `${indent}<${entry.name}>${at ? ` · ${at.file}` : why}`;
}

/**
 * The chain as lines, nearest step first. Pure, so the wording is testable
 * without a console.
 */
export function format(provenance: Provenance): string[] {
	const lines = provenance.hops.map((hop) => `← ${hop.label}`);

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

	// The tree rather than the nearest component: a `<Cell>` is forty cells, and
	// the column that built this one is three frames further out.
	if (provenance.tree.length > 0) {
		lines.push("← rendered by");
		provenance.tree.forEach((entry, depth) => {
			lines.push(frame(entry, depth));
		});

		// The one cause a reader can act on, so it is worth more than the short
		// form on the row: reloading brings every line in the tree back.
		if (provenance.tree.some((entry) => entry.missing === "untracked")) {
			lines.push(
				"  ! React records the call site of the first 10 000 elements only, and never starts again; reload to get them back",
			);
		}
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
	// Positions come off a stack trace, which describes the module a bundler
	// built. Printing them unmapped would put a line number in a ticket that
	// names a closing brace in the reader's editor. The map is a request, hence
	// the wait; the panel is already on screen by then.
	void locate(provenance.tree).then((tree) => {
		console.group(`camefrom ${title(provenance.value)}`);
		for (const line of format({ ...provenance, tree })) console.log(line);
		if (provenance.response !== undefined)
			console.log("response", provenance.response);
		console.groupEnd();
	});
}
