import { nodeAt } from "./pointer";
import { title } from "./report";
import { resolve } from "./resolve";
import { revision } from "./store";
import type { Provenance } from "./types";

const ELEMENT_NODE = 1;

/** How far the label keeps away from the pointer, in px. */
const AWAY = 14;

/** Said out loud rather than left blank: see the note on `Summary.field`. */
const BROKEN = "✗ not from a recorded response";

/**
 * The panel's tokens, on purpose: the two are one tool and should look like it.
 *
 * `--wash` is the one addition — the tint inside the outline — and it is spelled
 * out per scheme instead of derived from `--link`, so nothing here depends on
 * relative colour syntax being available.
 */
const STYLE = `
:host { all: initial; pointer-events: none; }
.hint {
    --bg: #ffffff;
    --fg: #1a1a1a;
    --dim: #6b6b6b;
    --edge: #e2e2e2;
    --link: #0a58ca;
    --warn: #b3450b;
    --wash: rgb(10 88 202 / 0.10);
}
@media (prefers-color-scheme: dark) {
    .hint {
        --bg: #17181a;
        --fg: #ededed;
        --dim: #8f9094;
        --edge: #2c2e31;
        --link: #7aa2f7;
        --warn: #e0a35e;
        --wash: rgb(122 162 247 / 0.16);
    }
}
[hidden] { display: none; }
.box {
    position: fixed;
    z-index: 2147483646;
    background: var(--wash);
    /* An outline rather than a border: it is drawn outside the box, so the ring
       never sits on top of the text it is pointing at. */
    outline: 1px solid var(--link);
    border-radius: 2px;
}
.line {
    position: fixed;
    z-index: 2147483646;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    max-width: min(520px, calc(100vw - 24px));
    padding: 3px 7px;
    border: 1px solid var(--edge);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.22);
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.line > span { overflow-wrap: anywhere; min-width: 0; }
.value { font-weight: 600; }
.source, .where { color: var(--dim); }
.broken { color: var(--warn); }
.field::before, .source::before { content: "← "; color: var(--dim); }
.field.broken::before { content: none; }
`;

/** One line of answer, in the pieces the hint colours differently. */
export interface Summary {
	/** The text as it was traced, quoted the way the panel quotes it. */
	value: string;
	/**
	 * The field it came from, how many fields hold it, or why neither can be
	 * said. Never empty: half a line is indistinguishable from a broken tool.
	 */
	field: string;
	/** Whether `field` is the bad news, so it can be coloured as such. */
	broken: boolean;
	/** `GET /api/works · 200`, when a recorded response is behind it. */
	source?: string;
	/** Who rendered it, innermost only — `<WorkRow>`. */
	where?: string;
}

/** What is on screen, built once and then only written to. */
interface View {
	host: HTMLElement;
	wrap: HTMLElement;
	box: HTMLElement;
	line: HTMLElement;
	value: HTMLElement;
	field: HTMLElement;
	source: HTMLElement;
	where: HTMLElement;
}

let view: View | undefined;
let watching = false;

/** Whether anything is on screen. Keeps the alt-is-not-held path a boolean. */
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

function elementOf(node: Node): Element | null {
	return node.nodeType === ELEMENT_NODE
		? (node as Element)
		: node.parentElement;
}

/**
 * The answer for a node, resolved at most once per node per revision.
 *
 * Hovering a table runs this on every frame the pointer moves, and `resolve()`
 * walks the fiber tree and searches recorded bodies — so the answer is kept.
 * A response that lands afterwards bumps the revision and the node is asked
 * again, because the reason it was `✗` a moment ago may be that the request had
 * not come back yet.
 */
function traced(node: Node): Provenance | null {
	const at = revision();
	const kept = answers.get(node);
	if (kept && kept.at === at) return kept.provenance;

	const provenance = resolve(node);
	answers.set(node, { at, provenance });
	return provenance;
}

/** One line of answer: the value, the field it came from, and the response. */
export function summarize(provenance: Provenance): Summary {
	const many = provenance.ambiguous ?? [];

	// Naming one of several would be exactly the wrong answer the row lookup
	// exists to avoid, so this says how many there are instead.
	const field =
		many.length > 1
			? `${many.length} fields hold this value`
			: (provenance.path ?? many[0]);
	const request = provenance.request;
	const innermost = provenance.tree.at(-1)?.name;

	return {
		value: title(provenance.value),
		field: field ?? BROKEN,
		// No field to name reads the same as a broken trace, and both have to
		// say so out loud.
		broken: provenance.broken || field === undefined,
		source: request && `${request.method} ${request.url} · ${request.status}`,
		where: innermost && `<${innermost}>`,
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
	host.setAttribute("data-camefrom", "hint");
	host.style.setProperty("all", "initial");
	// Never eat a pointer event: the app has to keep receiving them, and hit
	// testing has to keep reaching the text under the label rather than the
	// label itself.
	host.style.setProperty("pointer-events", "none");

	const shadow = host.attachShadow({ mode: "open" });
	const style = element("style");
	style.textContent = STYLE;

	const wrap = element("div", "hint");
	wrap.hidden = true;
	const box = element("div", "box");
	const line = element("div", "line");
	const value = element("span", "value");
	const field = element("span", "field");
	const source = element("span", "source");
	const where = element("span", "where");

	line.append(value, field, source, where);
	wrap.append(box, line);
	shadow.append(style, wrap);
	document.body.append(host);

	view = { host, wrap, box, line, value, field, source, where };
	return view;
}

/** Writes the label. Text only, never markup: a response body is untrusted. */
function say(into: View, summary: Summary): void {
	into.value.textContent = summary.value;
	into.field.textContent = summary.field;
	into.field.className = summary.broken ? "field broken" : "field";
	into.source.textContent = summary.source ?? "";
	into.source.hidden = !summary.source;
	into.where.textContent = summary.where ?? "";
	into.where.hidden = !summary.where;
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
function follow(line: HTMLElement, x: number, y: number): void {
	const width = window.innerWidth;
	const height = window.innerHeight;

	if (x * 2 > width) {
		line.style.left = "auto";
		line.style.right = `${width - x + AWAY}px`;
	} else {
		line.style.right = "auto";
		line.style.left = `${x + AWAY}px`;
	}

	if (y * 2 > height) {
		line.style.top = "auto";
		line.style.bottom = `${height - y + AWAY}px`;
	} else {
		line.style.bottom = "auto";
		line.style.top = `${y + AWAY}px`;
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
		// Nothing under the pointer carries traceable text. The click path is
		// the one that says so; a hover has nothing to report.
		hide();
		return;
	}

	const into = mount();
	if (spoken !== answer) {
		say(into, summarize(answer));
		spoken = answer;
	}
	place(into.box, outlined.getBoundingClientRect());
	follow(into.line, event.clientX, event.clientY);
	into.wrap.hidden = false;
	showing = true;
}

function moved(event: PointerEvent): void {
	// This runs on every pointer move on the page, so alt not being held has to
	// cost a boolean and nothing else.
	if (!event.altKey) {
		hide();
		return;
	}

	pending = event;
	// One resolution per frame no matter how many moves arrive in it.
	if (frame === undefined) frame = requestAnimationFrame(paint);
}

function released(event: KeyboardEvent): void {
	// Any key-up that leaves alt up, not just alt's own: a hint that outlives
	// the key that summoned it is worse than no hint.
	if (!event.altKey) hide();
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
	if (view) view.wrap.hidden = true;
}

/**
 * Trace whatever the pointer is over, for as long as alt is held.
 *
 * The cheap preview beside the full panel: one line of answer and an outline,
 * so scanning a table is a movement rather than five hundred clicks. Called
 * once by `install()`; calling it again does nothing.
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
