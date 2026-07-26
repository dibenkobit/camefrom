import * as devtools from "./devtools";
import type { Provenance } from "./shared/types";

export type {
	Frame,
	Position,
	Provenance,
	RequestMeta,
} from "./shared/types";

/**
 * Whether this build is allowed to trace anything.
 *
 * A bundler replaces `process.env.NODE_ENV` with a string literal, so the
 * checks below fold to constants and the branch holding `devtools` becomes
 * unreachable. Nothing in `./devtools` — the interceptor, the panel, the
 * store — is left to reach a production bundle, which is why this module is
 * the only entry point and why it must stay free of side effects.
 *
 * Anything that is not "development" counts as production. That is how React
 * and @tanstack/react-query-devtools read this variable, and it errs toward
 * shipping nothing: a build that forgets to say what it is gets the no-op
 * rather than a tracer in front of every request.
 */
const enabled = process.env.NODE_ENV === "development";

/**
 * Start recording and watch for alt-clicks.
 *
 * Call this before any library that patches `fetch` / `XMLHttpRequest`, or the
 * responses it reads will not be recorded. Does nothing outside development.
 */
export const install: () => void = enabled ? devtools.install : () => {};

/**
 * Answer "where did this come from?" for a node in the page.
 *
 * Opens the panel beside the node as well as returning the answer. Returns
 * `null` when the node carries no text, and always `null` outside development.
 */
export const camefrom: (target: Node | null) => Provenance | null = enabled
	? devtools.camefrom
	: () => null;
