import { MAX_RESPONSES, recorded, revision } from "../capture/store";
import { elementOf } from "../shared/dom";
import type { Provenance } from "../shared/types";
import { resolve } from "../trace/resolve";
import rules from "./hint.css" with { type: "text" };
import { inspecting } from "./inspect";
import { nodeAt, ours, own } from "./pointer";
import palette from "./tokens.css" with { type: "text" };
import { verdictOf } from "./verdict";

/** How far the label keeps away from the pointer, in px. */
const AWAY = 14;

/** The shared palette, then the rules that draw with it. */
const STYLE = palette + rules;

/**
 * One line of answer, in the pieces the hint sets differently.
 *
 * Two rows and no more: this is read at a glance, while the pointer is moving
 * across a table, and every row past the second is a row nobody has time for.
 * The panel is where the rest of it lives.
 */
export interface Summary {
	/**
	 * The field it came from, or the verdict when there is no field to name.
	 * Never empty: half a line is indistinguishable from a broken tool.
	 */
	answer: string;
	/** Whether `answer` is a sentence rather than a path, and set as one. */
	prose: boolean;
	/** Whether it is the bad news, so it can be coloured as such. */
	warn: boolean;
	/** `GET /api/works`, when a recorded response is behind it. */
	call?: string;
	/** Its status, kept apart from the call so it can be coloured. */
	status?: number;
	/** Who rendered it — `<WorkRow>`. Shown when no call can be. */
	where?: string;
}

/** What is on screen, built once and then only written to. */
interface View {
	host: HTMLElement;
	box: HTMLElement;
	label: HTMLElement;
	answer: HTMLElement;
	context: HTMLElement;
	call: HTMLElement;
	status: HTMLElement;
	where: HTMLElement;
}

let view: View | undefined;
let watching = false;

/** Whether anything is on screen. Keeps the nothing-to-do path a boolean. */
let showing = false;
/** The node the current answer belongs to; `undefined` before the first move. */
let resolved: Node | null | undefined;
let answer: Provenance | null = null;
/** The answer the label is currently spelling out, compared by identity. */
let spoken: Provenance | undefined;

let pending: PointerEvent | undefined;
let frame: number | undefined;

const answers = new WeakMap<
	Node,
	{ at: number; provenance: Provenance | null }
>();

/**
 * The answer for a node, resolved at most once per node per revision.
 *
 * Hovering a table runs this on every frame the pointer moves, and `resolve()`
 * walks the fiber tree and searches recorded bodies — so the answer is kept.
 * A response that lands afterwards bumps the revision and the node is asked
 * again, because the reason it could not be placed a moment ago may be that the
 * request had not come back yet.
 */
function traced(node: Node): Provenance | null {
	const at = revision();
	const kept = answers.get(node);
	if (kept && kept.at === at) return kept.provenance;

	const provenance = resolve(node);
	answers.set(node, { at, provenance });
	return provenance;
}

/**
 * One glance of answer: which field, and which call it came out of.
 *
 * The verdict comes from the same function the panel uses, so the two never
 * disagree about what happened — the hint says it in three words and the panel
 * in a sentence, but it is one conclusion.
 */
export function summarize(provenance: Provenance): Summary {
	const verdict = verdictOf(provenance, {
		count: recorded().length,
		limit: MAX_RESPONSES,
	});
	const request = provenance.request;
	const innermost = provenance.tree.at(-1)?.name;
	const traceless = verdict.answer === "app" || verdict.answer === "quiet";

	return {
		// The field when there is one; the verdict when naming a field would mean
		// picking one of several, or inventing one.
		answer: provenance.path ?? verdict.says,
		prose: provenance.path === undefined,
		warn: traceless,
		call: request && `${request.method} ${request.url}`,
		status: request?.status,
		// The component is the lead when there is no call to name, and clutter when
		// there is: two rows, and the panel holds the rest.
		where: request ? undefined : innermost && `<${innermost}>`,
	};
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
}

function mount(): View {
	if (view) {
		// An app that replaces the whole body takes the host with it, and a tool
		// that goes quiet at that point cannot be told apart from one that never
		// loaded. Putting it back costs a property read per frame.
		if (!view.host.isConnected) document.body.append(view.host);
		return view;
	}

	const host = element("div");
	own(host, "hint");
	host.style.setProperty("all", "initial");
	// Never eat a pointer event: the app has to keep receiving them, and hit
	// testing has to keep reaching the text under the label rather than the
	// label itself.
	host.style.setProperty("pointer-events", "none");

	const shadow = host.attachShadow({ mode: "open" });
	const style = element("style");
	style.textContent = STYLE;

	const box = element("div", "box");
	box.hidden = true;
	const label = element("div", "label");
	label.hidden = true;

	const answer = element("div", "answer");
	const context = element("div", "context");
	const call = element("span", "call");
	const status = element("span", "status");
	const where = element("span", "where");

	context.append(call, status, where);
	label.append(answer, context);
	shadow.append(style, box, label);
	document.body.append(host);

	view = { host, box, label, answer, context, call, status, where };
	return view;
}

/** How much of a problem a status is. Matches the panel, which explains it. */
function tone(status: number): string {
	if (status === 0 || (status >= 300 && status < 400)) return "status";
	if (status < 300) return "status good";
	return status < 500 ? "status warn" : "status bad";
}

/** Writes the label. Text only, never markup: a response body is untrusted. */
function say(into: View, summary: Summary): void {
	into.answer.textContent = summary.answer;
	into.answer.className = `answer${summary.prose ? " prose" : ""}${summary.warn ? " warn" : ""}`;

	into.call.textContent = summary.call ?? "";
	into.call.hidden = !summary.call;

	const status = summary.status;
	into.status.textContent =
		status === undefined || status === 0 ? "" : String(status);
	into.status.className = status === undefined ? "status" : tone(status);
	into.status.hidden = status === undefined || status === 0;

	into.where.textContent = summary.where ?? "";
	into.where.hidden = !summary.where;
	// A row with nothing in it is a row of padding under the answer.
	into.context.hidden = !summary.call && !summary.where;
}

function place(box: HTMLElement, rect: DOMRect): void {
	box.style.left = `${rect.left}px`;
	box.style.top = `${rect.top}px`;
	box.style.width = `${rect.width}px`;
	box.style.height = `${rect.height}px`;
}

/**
 * Puts the label beside the pointer, anchored by whichever edge it is nearer.
 *
 * Anchoring by the near edge is what lets it stay inside the viewport without
 * ever being measured — and measuring it would mean reading layout back after
 * writing it, on every frame of every hover.
 */
function follow(label: HTMLElement, x: number, y: number): void {
	const width = window.innerWidth;
	const height = window.innerHeight;

	if (x * 2 > width) {
		label.style.left = "auto";
		label.style.right = `${width - x + AWAY}px`;
	} else {
		label.style.right = "auto";
		label.style.left = `${x + AWAY}px`;
	}

	if (y * 2 > height) {
		label.style.top = "auto";
		label.style.bottom = `${height - y + AWAY}px`;
	} else {
		label.style.bottom = "auto";
		label.style.top = `${y + AWAY}px`;
	}
}

function paint(): void {
	frame = undefined;
	const event = pending;
	pending = undefined;
	if (!event) return;

	const node = nodeAt(event);
	if (node !== resolved) {
		resolved = node;
		answer = node ? traced(node) : null;
	}

	const outlined = answer && node ? elementOf(node) : null;
	if (!answer || !outlined) {
		// Nothing under the pointer carries traceable text. The click path is the
		// one that says so; a hover has nothing to report.
		hide();
		return;
	}

	const into = mount();
	if (spoken !== answer) {
		say(into, summarize(answer));
		spoken = answer;
	}
	place(into.box, outlined.getBoundingClientRect());
	follow(into.label, event.clientX, event.clientY);
	into.box.hidden = false;
	into.label.hidden = false;
	showing = true;
}

function moved(event: PointerEvent): void {
	// This runs on every pointer move on the page, so neither alt being held nor
	// the mode being off may cost more than a boolean.
	if (!event.altKey && !inspecting()) {
		hide();
		return;
	}

	// Over the panel there is nothing to preview: what it says is already on
	// screen, in more detail than a line under the pointer could hold.
	if (ours(event)) {
		hide();
		return;
	}

	pending = event;
	// One resolution per frame no matter how many moves arrive in it.
	if (frame === undefined) frame = requestAnimationFrame(paint);
}

function released(event: KeyboardEvent): void {
	// Any key-up that leaves alt up, not just alt's own: a hint that outlives the
	// key that summoned it is worse than no hint. The mode does not answer to alt.
	if (!event.altKey && !inspecting()) hide();
}

/**
 * The pointer leaving the page, as opposed to leaving one cell for the next.
 *
 * `pointerout` bubbles, so this sees every exit; what tells the two apart is
 * `relatedTarget`, which names whatever is being entered and is null when that
 * is nothing at all.
 */
function exited(event: PointerEvent): void {
	if (event.relatedTarget === null) hide();
}

/** Takes the hint off screen. Cheap enough to call on every pointer move. */
export function hide(): void {
	pending = undefined;
	if (frame !== undefined) {
		// Whatever was queued would put the hint back after this.
		cancelAnimationFrame(frame);
		frame = undefined;
	}

	if (!showing) return;
	showing = false;
	if (view) {
		view.box.hidden = true;
		view.label.hidden = true;
	}
}

/**
 * Trace whatever the pointer is over, while alt is held or the mode is on.
 *
 * The cheap preview beside the full panel: one glance of answer and an outline,
 * so scanning a table is a movement rather than five hundred clicks. Called once
 * by `install()`; calling it again does nothing.
 */
export function watch(): void {
	if (watching) return;
	// Both, because the hint measures the viewport as well as listening to the
	// document.
	if (typeof document === "undefined" || typeof window === "undefined") return;
	watching = true;

	// Captured and passive: an app that swallows pointer moves cannot swallow
	// these, and movement is never something to call preventDefault on.
	const quietly = { capture: true, passive: true } as const;
	document.addEventListener("pointermove", moved, quietly);
	document.addEventListener("keyup", released, quietly);
	document.addEventListener("pointerout", exited, quietly);
	// The key-up is lost when the focus goes, so this is what catches alt being
	// released in another window — or in the devtools.
	window.addEventListener("blur", hide, { passive: true });
	// Captured, because a scroll inside a container does not reach the document
	// otherwise. Every position on screen was measured before it, and the honest
	// thing to do with a stale measurement is drop it.
	document.addEventListener("scroll", hide, quietly);
}
