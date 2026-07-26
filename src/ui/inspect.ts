/**
 * The mode: trace what the pointer is over without holding anything down.
 *
 * Holding alt answers one question well, and is the wrong shape for the thing
 * this tool is for. Reading a whole table means a minute of movement, and a
 * minute of holding a modifier down — during which alt is also the key that
 * opens the browser's menu bar, drags a window on some desktops, and is lost the
 * moment focus goes anywhere else. Every picker that expects to be used for
 * longer than a second — Chrome's element picker, React DevTools' — is a mode you
 * turn on, and this is that mode. Alt keeps working, for the one-off question.
 *
 * Two things are owed in exchange. The mode has to be visible, which is the
 * badge and the crosshair. And it has to own the clicks: a click in a picker
 * belongs to the picker, not to the router underneath it.
 */

import rules from "./inspect.css" with { type: "text" };
import { ours, own } from "./pointer";
import palette from "./tokens.css" with { type: "text" };

/** The shared palette, then the rules that draw with it. */
const STYLE = palette + rules;

/**
 * Shift, alt and C.
 *
 * Read off `code`, not `key`: alt is a compose key on macOS, where this
 * combination produces `Ç` and a check against `"C"` never matches. Chrome's own
 * picker is on cmd-shift-C and this must not fight it.
 */
const KEY = "KeyC";

/**
 * The cursor, forced onto the page for as long as the mode lasts.
 *
 * In the app's own head, and `!important`, because that is the only thing that
 * beats the `cursor: pointer` on every button in it — and a picker whose cursor
 * changes on some elements and not others is a picker that looks broken. Removed
 * on the way out, and it is the only mark the mode leaves on the page.
 */
const CURSOR = `*, *::before, *::after {
	cursor: crosshair !important;
	user-select: none !important;
}`;

/**
 * The host in the page and the badge inside it.
 *
 * Both, because only one of them can be hidden: the host carries `all: initial`
 * to keep the app's CSS out, and `all` resets `display` to `inline` — which
 * beats the `display: none` the `hidden` attribute asks a host for. Inside the
 * shadow tree the stylesheet says what `hidden` means, and there it holds.
 */
interface View {
	host: HTMLElement;
	badge: HTMLElement;
}

let on = false;
let watching = false;
let told: ((inspecting: boolean) => void) | undefined;
let view: View | undefined;
let forced: HTMLStyleElement | undefined;

/** Whether the mode is on. Asked on every pointer move, so it stays a boolean. */
export function inspecting(): boolean {
	return on;
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function mount(): View {
	if (view) {
		// An app that replaces the whole body takes the host with it, and a badge
		// that is gone is a mode nobody can see they are in.
		if (!view.host.isConnected) document.body.append(view.host);
		return view;
	}

	const host = element("div");
	own(host, "inspect");
	host.style.setProperty("all", "initial");
	const shadow = host.attachShadow({ mode: "open" });

	const badge = element("div", "badge");
	badge.hidden = true;
	const stop = element("button", "stop");
	stop.append(
		element("kbd", undefined, "esc"),
		document.createTextNode(" stop"),
	);
	stop.addEventListener("click", () => {
		leave();
	});
	badge.append(
		element("span", "dot"),
		element("span", undefined, "camefrom is inspecting — point at any value"),
		stop,
	);

	shadow.append(element("style", undefined, STYLE), badge);
	document.body.append(host);

	view = { host, badge };
	return view;
}

/**
 * A click in the mode belongs to the mode.
 *
 * The tracing itself is somebody else's listener, registered first and so run
 * first; this is only what stops the app acting on the same click — following the
 * link under the value, submitting the form around it. Without it, picking a value
 * in a table navigates away from the table.
 */
function swallow(event: Event): void {
	if (ours(event)) return;
	event.preventDefault();
	event.stopPropagation();
}

const OWNED = ["click", "mousedown"] as const;

export function enter(): void {
	if (on || typeof document === "undefined") return;
	on = true;

	mount().badge.hidden = false;
	forced = element("style");
	forced.textContent = CURSOR;
	document.head.append(forced);
	for (const type of OWNED) document.addEventListener(type, swallow, true);

	told?.(true);
}

export function leave(): void {
	if (!on) return;
	on = false;

	if (view) view.badge.hidden = true;
	forced?.remove();
	forced = undefined;
	for (const type of OWNED) document.removeEventListener(type, swallow, true);

	told?.(false);
}

/**
 * Listen for the shortcut that turns the mode on and the escape that ends it.
 *
 * `told` is how the hint hears about it, rather than this module reaching into
 * the hint: leaving the mode has to take the label off screen, and a module that
 * both drives and is driven by another is a cycle nobody needs.
 */
export function watch(changed: (inspecting: boolean) => void): void {
	told = changed;
	if (watching || typeof document === "undefined") return;
	watching = true;

	document.addEventListener(
		"keydown",
		(event) => {
			if (
				event.code === KEY &&
				event.shiftKey &&
				event.altKey &&
				!event.ctrlKey &&
				!event.metaKey
			) {
				event.preventDefault();
				if (on) leave();
				else enter();
				return;
			}
			// One key, one meaning: escape leaves the mode and — through the panel's
			// own listener — closes whatever it opened.
			if (event.key === "Escape" && on) leave();
		},
		true,
	);
}
