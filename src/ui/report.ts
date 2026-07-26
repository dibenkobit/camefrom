import { MAX_RESPONSES, recorded } from "../capture/store";
import type { Frame, Provenance } from "../shared/types";
import { locate } from "../source/sourcemap";
import { type Verdict, verdictOf } from "./verdict";

/**
 * How the value itself is announced. Strings keep their quotes.
 *
 * Exported so the panel, the console and the clipboard say it the same way.
 * Three copies of one sentence drift, and the one on the clipboard ends up in a
 * ticket.
 */
export function title(value: unknown): string {
	return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * Why a frame has no line.
 *
 * A row with neither a line nor a reason is indistinguishable from a broken
 * tool, and each of these has a different answer — so each names what would
 * change it rather than only what went wrong. Shared with the panel, which shows
 * the same sentences on the same rows.
 */
export const MISSING: Record<NonNullable<Frame["missing"]>, string> = {
	untracked: "React stopped recording call sites — reload the page",
	inlined: "the engine left no frame for it in the stack",
	unmapped: "no source map for this module",
	unrecorded: "this build of React records no positions",
};

/**
 * The one cause worth spelling out in full, because reloading actually fixes it.
 * Shared with the panel for the same reason as `MISSING`.
 */
export const RELOAD =
	"React records the call site of the first 10 000 elements only and never starts again. Reload the page to get them back.";

/** How wide the label column is, so the values line up under each other. */
const LABEL = 9;

function row(label: string, text: string): string {
	return `${label.padEnd(LABEL)}${text}`;
}

/** `GET /api/works  200  143ms`, spaced rather than punctuated. */
export function callOf(request: NonNullable<Provenance["request"]>): string {
	return `${request.method} ${request.url}  ${request.status}  ${request.durationMs}ms`;
}

/** `<WorkRow>`, indented to its depth, padded so every file starts at one column. */
function named(frame: Frame, depth: number, width: number): string {
	return `${"  ".repeat(depth + 1)}<${frame.name}>`.padEnd(width);
}

function treeLines(tree: readonly Frame[]): string[] {
	const width =
		Math.max(...tree.map((frame, depth) => named(frame, depth, 0).length)) + 2;

	const lines = tree.map((frame, depth) => {
		const at = frame.at;
		const where =
			at && at.line > 0
				? `${at.file}:${at.line}`
				: (at?.file ?? (frame.missing ? MISSING[frame.missing] : ""));
		return `${named(frame, depth, width)}${where}`.trimEnd();
	});

	// The one cause a reader can act on, and acting on it brings every line back.
	if (tree.some((frame) => frame.missing === "untracked"))
		lines.push(`  ${RELOAD}`);
	return lines;
}

/**
 * The whole answer as lines, verdict first.
 *
 * Pure, and the same lines the clipboard writes: what the console says and what
 * lands in a ticket must not be two different reports, because the ticket is
 * written by somebody reading the console.
 */
export function format(provenance: Provenance, verdict: Verdict): string[] {
	const lines = [verdict.says];
	if (verdict.advice) lines.push(verdict.advice);
	lines.push("");

	if (provenance.path !== undefined) {
		lines.push(row("field", provenance.path));
	}

	// Which of them it is cannot be told from here, so all of them are named. One
	// confident line would be the more useful shape and the wrong one.
	if (provenance.ambiguous) {
		provenance.ambiguous.forEach((path, index) => {
			lines.push(row(index === 0 ? "fields" : "", path));
		});
	}

	if (provenance.request)
		lines.push(row("request", callOf(provenance.request)));

	// The tree rather than the nearest component: a `<Cell>` is forty cells, and
	// the column that built this one is three frames further out. The last line is
	// the frame that rendered the text.
	if (provenance.tree.length > 0) {
		lines.push("", "rendered by", ...treeLines(provenance.tree));
	}
	return lines;
}

/**
 * Print the answer where the developer already is.
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
		const verdict = verdictOf(provenance, {
			count: recorded().length,
			limit: MAX_RESPONSES,
		});

		console.group(`camefrom ${title(provenance.value)}`);
		for (const line of format({ ...provenance, tree }, verdict))
			console.log(line);
		if (provenance.response !== undefined)
			console.log("response", provenance.response);
		console.groupEnd();
	});
}
