/**
 * What the copy button offers, and what each item puts on the clipboard.
 *
 * One button labelled `copy` is a button nobody presses twice: the first press
 * teaches you it copies something, and never which of the four things you wanted.
 * A path goes in a message to the person who owns the endpoint, a URL goes in the
 * address bar, a `curl` goes to the backend, and the whole answer goes in a
 * ticket — so each is an item that says so.
 *
 * Pure but for the clipboard itself, which is the one part that can fail and the
 * reason `copy` reports back what happened.
 */

import type { Provenance, RequestMeta } from "../shared/types";
import { format, title } from "./report";
import type { Verdict } from "./verdict";

export interface CopyItem {
	/** What the menu says. Names the thing, not the act. */
	label: string;
	/** What lands on the clipboard. Absent when there is nothing to copy. */
	text?: string;
	/** The small print under the label: a caveat, or why there is no text. */
	note?: string;
}

/** Escapes a value for a single-quoted shell word: end, escape, reopen. */
function quoted(text: string): string {
	return text.replaceAll("'", "'\\''");
}

/**
 * The URL as something that can be pasted anywhere.
 *
 * A recorded URL is regularly `/api/works`, which is an answer only inside the
 * page it was fetched from. Neither a `curl` nor a colleague's address bar has
 * that context.
 */
function absolute(url: string): string {
	try {
		return new URL(url, globalThis.location?.href).href;
	} catch {
		return url;
	}
}

/**
 * The request as a command.
 *
 * Headers included, which is the whole difference between a command that answers
 * and one that 401s. Cookies are not: the browser attaches them after JavaScript
 * is finished with the request and never lets it read them back, so a
 * cookie-authenticated API needs one added by hand — said out loud on the menu
 * item rather than discovered at the shell.
 */
export function asCurl(request: RequestMeta): string {
	const parts = [`curl '${quoted(absolute(request.url))}'`];

	const method = request.method.toUpperCase();
	if (method !== "GET") parts.push(`-X ${method}`);
	for (const [name, value] of Object.entries(request.headers ?? {})) {
		parts.push(`-H '${quoted(name)}: ${quoted(value)}'`);
	}
	// One switch per line, continued: a `curl` with six headers on one line is
	// unreadable in the ticket it was pasted into.
	return parts.join(" \\\n  ");
}

/** The whole answer, headed so it is recognisable in a ticket. */
export function asReport(provenance: Provenance, verdict: Verdict): string {
	return [
		`camefrom ${title(provenance.value)}`,
		...format(provenance, verdict),
	].join("\n");
}

/**
 * The menu, in the order the items are wanted.
 *
 * An item with nothing to copy is kept and says why. Dropping it would leave a
 * menu whose length changes with the answer, and a reader wondering whether the
 * item they remember was removed or never existed.
 */
export function copyItems(
	provenance: Provenance,
	verdict: Verdict,
): CopyItem[] {
	const request = provenance.request;
	const missing = request ? undefined : "no request recorded behind this value";

	return [
		{
			label: "Answer, for a ticket",
			text: asReport(provenance, verdict),
			note: "verdict, field, request and render tree",
		},
		{
			label: "Field path",
			text: provenance.path,
			note:
				provenance.path === undefined
					? provenance.ambiguous
						? "more than one field holds this value"
						: "this text was not read from a response"
					: undefined,
		},
		{
			label: "Request URL",
			text: request && absolute(request.url),
			note: missing,
		},
		{
			label: "curl",
			text: request && asCurl(request),
			note: missing ?? "headers as the app sent them, without cookies",
		},
	];
}

/** How the copy went, for the button to say. */
export type Copied = "copied" | "console";

/**
 * Put text on the clipboard, and say where it went.
 *
 * `navigator.clipboard` is missing on a plain http origin in Chrome and Safari,
 * and rejects when the document is not focused, so the console keeps a copy
 * either way: a copy button that quietly does nothing is worse than no button.
 */
export async function copy(text: string): Promise<Copied> {
	try {
		await navigator.clipboard.writeText(text);
		return "copied";
	} catch (error) {
		console.log(
			`camefrom: no clipboard here (${String(error)}). To copy by hand:\n${text}`,
		);
		return "console";
	}
}
