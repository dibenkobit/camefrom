import { intercept } from "./capture/intercept";
import { elementOf } from "./shared/dom";
import type { Provenance } from "./shared/types";
import { resolve } from "./trace/resolve";
import { hide as hideHint, watch as watchHint } from "./ui/hint";
import { inspecting, watch as watchMode } from "./ui/inspect";
import { type Point, show } from "./ui/panel";
import { nodeAt, ours } from "./ui/pointer";
import { report } from "./ui/report";

let installed = false;

/**
 * How to say the shortcut where the reader is sitting.
 *
 * `navigator.platform` is deprecated and every browser still answers it, which is
 * more than can be said for the replacement. Getting this wrong is only cosmetic
 * — but `⇧⌥C` on Windows is a line nobody can follow.
 */
const SHORTCUT =
	typeof navigator !== "undefined" &&
	/Mac|iP(hone|ad|od)/.test(navigator.platform ?? "")
		? "⇧⌥C"
		: "shift+alt+C";

/**
 * Where to open the panel for a node nobody clicked.
 *
 * `camefrom($0)` has no pointer to work from, so the element's own box is the
 * next best anchor — under its bottom-left corner, the way a tooltip sits. A
 * node with no box, detached or hidden, measures zero on every side, and then
 * the panel is better off in its corner than at the top of the page.
 */
function anchorOf(target: Node): Point | undefined {
	const box = elementOf(target)?.getBoundingClientRect();
	if (!box || (box.width === 0 && box.height === 0)) return undefined;
	return { x: box.left, y: box.bottom };
}

function listen(): void {
	if (typeof document === "undefined") return;

	document.addEventListener(
		"click",
		(event) => {
			// Alt for the one-off question, the mode for reading a whole table.
			if (!event.altKey && !inspecting()) return;
			// A click on the panel belongs to the panel, and quietly: saying "no
			// text under the pointer" for its own text would be answering a
			// question nobody asked.
			if (ours(event)) return;

			const found = resolve(nodeAt(event));
			if (!found) {
				// Silence here is the worst possible answer: it cannot be told
				// apart from a tool that never loaded.
				console.log("camefrom: no text under the pointer");
				return;
			}

			// Only once there is something to say. An alt-click that traces
			// nothing should still behave like an ordinary click.
			event.preventDefault();
			event.stopPropagation();
			// The panel is about to say all of this properly, and two answers on
			// screen at once is one too many.
			hideHint();
			// Beside the click: the answer belongs next to the thing asked about,
			// not in the corner where the panel used to cover the next cell.
			show(found, { x: event.clientX, y: event.clientY });
			report(found);
		},
		// Captured, so an app that swallows clicks cannot swallow this one.
		true,
	);

	// A wheel over the panel is the panel scrolling, and no business of the app's.
	// Apps scroll themselves on wheel more often than one would think — a
	// virtualised table, a smooth-scroll wrapper — and a listener of theirs on the
	// document sees every wheel over our panel too, then moves the page while the
	// panel under the pointer sits still.
	//
	// On the window and captured, which is as early as a listener gets, and
	// `install()` is documented to run before the app's own. Propagation only:
	// what scrolls the box under the pointer is the default action, and that is
	// left alone.
	window.addEventListener(
		"wheel",
		(event) => {
			if (ours(event)) event.stopPropagation();
		},
		{ capture: true, passive: true },
	);

	// The cheap preview: one glance of answer under the pointer, so reading a
	// table is a movement rather than a click per cell.
	watchHint();

	// Leaving the mode has to take the label off screen with it, or the last thing
	// the pointer was over stays outlined over an app that is live again.
	watchMode((mode) => {
		if (!mode) hideHint();
	});

	// Says the tool is alive and how to use it, which is the difference between
	// "nothing happened" being a bug report and being a question.
	console.log(
		`%ccamefrom%c hold alt over any value, or press %c${SHORTCUT}%c to keep inspecting. Click for the whole answer.`,
		"font-weight:bold",
		"font-weight:normal",
		"font-weight:bold",
		"font-weight:normal",
	);
}

/**
 * Start recording and watch for alt-clicks.
 *
 * Call this before any library that patches `fetch` / `XMLHttpRequest`, or the
 * responses it reads will not be recorded.
 */
export function install(): void {
	if (installed) return;
	installed = true;
	intercept();
	listen();

	if (typeof window !== "undefined") {
		// So `camefrom($0)` works in the console without importing anything.
		window.camefrom = camefrom;
	}
}

/**
 * Answer "where did this come from?" for a node in the page.
 *
 * Opens the panel beside the node as well as returning the answer: the object
 * is what the console prints, but the chain, the source line and the response
 * body are only readable in the panel.
 *
 * Returns `null` when the node carries no text — callers should treat that as
 * "nothing to say", never as an error. A node whose text was never read out of
 * a response comes back with `broken: true` instead.
 */
export function camefrom(target: Node | null): Provenance | null {
	const found = resolve(target);
	if (found && target) show(found, anchorOf(target));
	return found;
}

declare global {
	interface Window {
		camefrom: typeof camefrom;
	}
}
