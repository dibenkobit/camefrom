import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { recordResponse, reset } from "../capture/store";
import { taint } from "../capture/taint";
import type { Provenance } from "../shared/types";
import { hide, summarize, watch } from "./hint";
import { own } from "./pointer";

const window = new Window({ url: "http://localhost" });
const document = window.document as unknown as Document;

/**
 * The hint reaches the page through globals, the way it will in a browser, so
 * the happy-dom window has to be one. `resolve()` needs no such thing — it only
 * ever touches instance members — which is why its test does without this.
 */
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = window;
globals.document = document;

/**
 * Frames, run by hand.
 *
 * The hint throttles to one resolution per frame, and that is a thing to assert
 * rather than wait for: `flush()` is the frame boundary.
 */
let queued: (FrameRequestCallback | undefined)[] = [];
globals.requestAnimationFrame = (callback: FrameRequestCallback): number =>
	queued.push(callback);
globals.cancelAnimationFrame = (handle: number): void => {
	queued[handle - 1] = undefined;
};

function pending(): number {
	return queued.filter((callback) => callback !== undefined).length;
}

function flush(): void {
	const due = queued;
	queued = [];
	for (const callback of due) callback?.(0);
}

const meta = {
	method: "GET",
	url: "/api/works",
	status: 200,
	startedAt: 0,
	durationMs: 12,
};

const PointerEventOf = (
	window as unknown as { PointerEvent: typeof PointerEvent }
).PointerEvent;
const KeyboardEventOf = (
	window as unknown as { KeyboardEvent: typeof KeyboardEvent }
).KeyboardEvent;

watch();

afterAll(async () => {
	await window.happyDOM.close();
});

beforeEach(() => {
	reset();
	hide();
	queued = [];
	document.body.innerHTML = "";
});

function seed<T extends Record<string, unknown>>(body: T): T {
	const recorded = recordResponse(meta, body);
	// Reading through the proxy is what registers the paths.
	const tainted = taint(body, recorded.id);
	JSON.stringify(tainted);
	return tainted;
}

/** Cells are divs because a bare `<td>` outside a table is dropped by parsers. */
function render(html: string): Element {
	document.body.innerHTML = html;
	const element = document.body.firstElementChild;
	if (!element) throw new Error("nothing rendered");
	return element;
}

/**
 * A pointer move over a node, with alt held unless told otherwise.
 *
 * happy-dom has no `caretPositionFromPoint`, so the hint falls back to
 * `event.target` — the same fallback Safari gets.
 */
function move(target: Node, x = 10, y = 10, altKey = true): PointerEvent {
	const event = new PointerEventOf("pointermove", {
		altKey,
		clientX: x,
		clientY: y,
		bubbles: true,
		cancelable: true,
		// As a real pointer event is: without this one dispatched inside a shadow
		// root would stop at its boundary and never reach the document.
		composed: true,
	});
	target.dispatchEvent(event);
	return event;
}

/** A move and the frame it schedules, which is what the hint answers on. */
function hover(target: Node, x = 10, y = 10): void {
	move(target, x, y);
	flush();
}

function root(): ShadowRoot | null {
	const host = document.querySelector('[data-camefrom="hint"]');
	return host?.shadowRoot ?? null;
}

function shown(): boolean {
	const wrap = root()?.querySelector(".hint") as HTMLElement | null;
	return wrap ? !wrap.hidden : false;
}

/** Everything the label says, spans run together — assert with `toContain`. */
function said(): string {
	return root()?.querySelector(".line")?.textContent ?? "";
}

/**
 * How many times `resolve()` reads the text of this cell.
 *
 * It gets an element's text from the `data` of its text children, so one
 * resolution is at least one read here. The tests compare the count across a
 * move rather than assume a number, and assert it moved at all, so this can
 * never pass by watching nothing.
 */
function reads(cell: Element): () => number {
	const node = cell.firstChild as Text;
	const data = node.data;
	let count = 0;
	Object.defineProperty(node, "data", {
		configurable: true,
		get: () => {
			count++;
			return data;
		},
	});
	return () => count;
}

/**
 * A provenance shaped the way `resolve()` returns it once `ambiguous` and `tree`
 * land in `types.ts`.
 *
 * Cast, because those fields are not on the type on this branch yet — which is
 * also why these two cases are put to `summarize()` directly instead of being
 * driven through the real `resolve()`.
 */
function shaped(extra: Record<string, unknown>): Provenance {
	return {
		hops: [],
		tree: [],
		broken: false,
		...extra,
	} as unknown as Provenance;
}

describe("before alt is held", () => {
	// First in the file on purpose: nothing has been mounted yet, so this can
	// hold the hint to renting no space in the page at all until it is wanted.
	test("nothing is mounted and no frame is asked for", () => {
		seed({ items: [{ status: "Активен" }] });
		move(render("<div>Активен</div>"), 10, 10, false);

		expect(document.querySelector('[data-camefrom="hint"]')).toBeNull();
		expect(pending()).toBe(0);
		expect(shown()).toBe(false);
	});
});

describe("the line of answer", () => {
	test("names the value, the field and the response", () => {
		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });
		hover(render("<div>ТОО Барыс</div>"));

		expect(shown()).toBe(true);
		expect(said()).toContain('"ТОО Барыс"');
		expect(said()).toContain("items[0].contractor.name");
		expect(said()).toContain("GET /api/works · 200");
	});

	test("says so when the text was not read from any response", () => {
		seed({ items: [{ status: "Активен" }] });
		hover(render("<label>Подрядчик</label>"));

		expect(shown()).toBe(true);
		expect(said()).toContain("✗ not from a recorded response");
		expect(said()).not.toContain("Активен");
	});

	test("leaves nothing on screen where there is no text", () => {
		seed({ items: [{ status: "Активен" }] });
		hover(render("<div>Активен</div>"));
		expect(shown()).toBe(true);

		hover(render("<div>   </div>"));
		expect(shown()).toBe(false);
	});

	test("outlines the element it is answering for", () => {
		seed({ items: [{ status: "Активен" }] });
		hover(render("<div>Активен</div>"));

		// Only that the outline is there: happy-dom does not lay anything out,
		// so every rect it reports is zeros and where the box ends up cannot be
		// tested here at all.
		expect(root()?.querySelector(".box")).not.toBeNull();
	});

	test("counts the fields instead of naming one when several match", () => {
		const summary = summarize(
			shaped({
				value: "Активен",
				ambiguous: ["items[0].status", "items[1].status"],
				request: meta,
			}),
		);

		expect(summary.field).toBe("2 fields hold this value");
		expect(summary.broken).toBe(false);
		expect(summary.source).toBe("GET /api/works · 200");
	});

	test("names the innermost component that rendered the text", () => {
		const summary = summarize(
			shaped({
				value: "Активен",
				path: "items[0].status",
				tree: [
					{ name: "WorksTable", target: false },
					{ name: "WorkRow", target: true },
				],
			}),
		);

		expect(summary.where).toBe("<WorkRow>");
	});

	test("calls a value with no field at all broken, rather than say nothing", () => {
		const summary = summarize(shaped({ value: "Активен" }));

		expect(summary.field).toBe("✗ not from a recorded response");
		expect(summary.broken).toBe(true);
	});
});

describe("what it costs", () => {
	test("moving inside the same node does not resolve it again", () => {
		seed({ items: [{ status: "Активен" }, { title: "ТОО Барыс" }] });
		const cell = render("<div>Активен</div>");
		const count = reads(cell);

		hover(cell, 10, 10);
		const once = count();
		expect(once).toBeGreaterThan(0);
		expect(said()).toContain("items[0].status");

		hover(cell, 40, 12);
		expect(count()).toBe(once);
		expect(said()).toContain("items[0].status");
	});

	test("several moves in one frame resolve once", () => {
		seed({ items: [{ status: "Активен" }] });
		const first = render("<div>Активен</div><div>Активен</div>");
		const second = first.nextElementSibling as Element;
		const count = reads(second);

		move(first, 10, 10);
		move(second, 20, 10);
		move(second, 30, 10);
		expect(pending()).toBe(1);

		flush();
		const once = count();
		expect(once).toBeGreaterThan(0);
		expect(pending()).toBe(0);
	});

	test("a response that lands afterwards is not answered from the old one", () => {
		render("<div>ТОО Барыс</div><div>ещё не важно</div>");
		const cell = document.body.firstElementChild as Element;
		const other = document.body.lastElementChild as Element;

		hover(cell);
		expect(said()).toContain("✗ not from a recorded response");

		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });

		// Away and back: coming back is when the kept answer is asked for again,
		// and the response bumped the revision it was kept under.
		hover(other);
		hover(cell);
		expect(said()).toContain("items[0].contractor.name");
	});
});

describe("over the tool's own UI", () => {
	/**
	 * A shadow host of ours, holding text the hint could answer for.
	 *
	 * Not the real panel: `panel.ts` mounts itself once against whichever ambient
	 * document it first saw, and these suites share a process, so the panel's own
	 * suite is the one that can own it. What the hint promises is that anything
	 * marked as ours is left alone; that the panel marks itself is what
	 * `panel.dom.test.ts` holds it to.
	 */
	function ours(text: string): Node {
		const host = document.createElement("div");
		own(host, "panel");
		document.body.append(host);

		const inside = document.createElement("div");
		inside.textContent = text;
		host.attachShadow({ mode: "open" }).append(inside);
		return inside;
	}

	test("nothing is shown, for text that would otherwise answer", () => {
		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });

		// The panel prints the response body it was traced out of, so its text is
		// text this tool can trace — and tracing it is the tool reading itself.
		hover(ours("ТОО Барыс"));
		expect(shown()).toBe(false);
	});

	test("a hint already on screen is taken off on the way in", () => {
		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });
		hover(render("<div>ТОО Барыс</div>"));
		expect(shown()).toBe(true);

		// After `render()`, which writes the whole body and would take the host
		// with it.
		hover(ours("ТОО Барыс"));
		expect(shown()).toBe(false);
		// And no frame is left queued to put it back.
		expect(pending()).toBe(0);
	});
});

describe("getting out of the way", () => {
	function upTo(cell: Element): void {
		seed({ items: [{ status: "Активен" }] });
		hover(cell);
		expect(shown()).toBe(true);
	}

	test("hides when alt comes up", () => {
		upTo(render("<div>Активен</div>"));

		document.dispatchEvent(
			new KeyboardEventOf("keyup", { key: "Alt", bubbles: true }),
		);
		expect(shown()).toBe(false);
	});

	test("stays for a key-up with alt still held", () => {
		upTo(render("<div>Активен</div>"));

		document.dispatchEvent(
			new KeyboardEventOf("keyup", { key: "a", altKey: true, bubbles: true }),
		);
		expect(shown()).toBe(true);
	});

	test("hides when the window loses focus", () => {
		upTo(render("<div>Активен</div>"));

		window.dispatchEvent(new window.Event("blur"));
		expect(shown()).toBe(false);
	});

	test("hides when the pointer leaves the page", () => {
		upTo(render("<div>Активен</div>"));

		document.body.dispatchEvent(
			new PointerEventOf("pointerout", { bubbles: true, relatedTarget: null }),
		);
		expect(shown()).toBe(false);
	});

	test("stays when the pointer only leaves one cell for the next", () => {
		const cell = render("<div>Активен</div><div>Активен</div>");
		upTo(cell);

		cell.dispatchEvent(
			new PointerEventOf("pointerout", {
				bubbles: true,
				relatedTarget: cell.nextElementSibling,
			}),
		);
		expect(shown()).toBe(true);
	});

	test("hides on the next pointer move once alt is let go", () => {
		const cell = render("<div>Активен</div>");
		upTo(cell);

		move(cell, 20, 20, false);
		expect(shown()).toBe(false);
		// And the frame that move would have queued is not there to put it back.
		expect(pending()).toBe(0);
	});

	test("hide() takes it off screen, which is what the panel opening does", () => {
		upTo(render("<div>Активен</div>"));

		hide();
		expect(shown()).toBe(false);
	});

	test("a queued frame cannot put it back after hide()", () => {
		const cell = render("<div>Активен</div>");
		upTo(cell);

		move(cell, 30, 30);
		hide();
		flush();
		expect(shown()).toBe(false);
	});

	test("never calls preventDefault on movement", () => {
		seed({ items: [{ status: "Активен" }] });
		const event = move(render("<div>Активен</div>"));
		flush();

		expect(event.defaultPrevented).toBe(false);
	});
});
