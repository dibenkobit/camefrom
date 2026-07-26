import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { recordResponse, reset } from "../capture/store";
import type { Provenance } from "../shared/types";
import { beside, hide, show, within } from "./panel";
import { ours } from "./pointer";

const window = new Window({ url: "http://localhost" });

// The panel reaches for the ambient document the way it will in a browser, so
// the globals have to be in place before it is ever called. happy-dom's
// document is structurally what it needs.
globalThis.document = window.document as unknown as Document;
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
	Number(setTimeout(() => callback(0), 0))) as typeof requestAnimationFrame;

/**
 * Every request the panel makes, and none of them answered.
 *
 * The source pane asks for a module's map and then for the file itself, neither
 * of which exists here. Failing on purpose is also what puts the pane's own
 * empty state under test, which is the half that says why there is no excerpt.
 */
const asked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: string) => {
	asked.push(String(url));
	return Promise.reject(new Error("nothing is serving this"));
}) as unknown as typeof fetch;

afterAll(async () => {
	await window.happyDOM.close();
	// Other suites share this process and should not inherit a DOM — nor a `fetch`
	// that refuses everything, which is what `intercept()` would go on to wrap.
	globalThis.fetch = realFetch;
	delete (globalThis as { document?: Document }).document;
	delete (globalThis as { requestAnimationFrame?: unknown })
		.requestAnimationFrame;
});

beforeEach(() => {
	// Not `document.body.innerHTML = ""`: the module keeps the host it mounted,
	// and a fresh body would leave it appending panels to a detached shadow root.
	hide();
	reset();
	asked.length = 0;
	// The verdict for a value that matched nothing depends on how much was
	// recorded, so every test starts from a store that has seen one response.
	recordResponse(
		{
			method: "GET",
			url: "/api/works",
			status: 200,
			startedAt: 0,
			durationMs: 1,
		},
		{},
	);
});

function traced(over: Partial<Provenance> = {}): Provenance {
	return {
		value: "ТОО Барыс",
		path: "items[0].contractor.name",
		request: {
			method: "GET",
			url: "/api/works",
			status: 200,
			startedAt: 0,
			durationMs: 143,
		},
		response: { items: [{ contractor: { name: "ТОО Барыс" } }] },
		tree: [
			{
				name: "WorkRow",
				at: { file: "src/works.table-columns.tsx", line: 41, column: 9 },
				target: false,
			},
			{ name: "td", target: true },
		],
		broken: false,
		...over,
	};
}

/** The panel as it stands in the page, through the shadow root it lives in. */
function panel(): HTMLElement {
	const found = document
		.querySelector('[data-camefrom="panel"]')
		?.shadowRoot?.querySelector(".panel") as HTMLElement | null | undefined;
	if (!found) throw new Error("no panel in the page");
	return found;
}

function part(selector: string): HTMLElement {
	const found = panel().querySelector(selector) as HTMLElement | null;
	if (!found) throw new Error(`no ${selector} in the panel`);
	return found;
}

function all(selector: string): HTMLElement[] {
	return Array.from(panel().querySelectorAll(selector)) as HTMLElement[];
}

/** The label of every tab, and which one is on. */
function tabs(): string[] {
	return all(".tab").map(
		(tab) =>
			`${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`,
	);
}

/** The labelled rows of the answer, as `label: value` pairs. */
function facts(): string[] {
	const rows = all(".facts > *");
	const said: string[] = [];
	for (let index = 0; index < rows.length; index += 2) {
		said.push(`${rows[index]?.textContent}: ${rows[index + 1]?.textContent}`);
	}
	return said;
}

function pointer(
	type: string,
	on: Element,
	where: { clientX?: number; clientY?: number } = {},
): void {
	on.dispatchEvent(
		new window.PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			// As a real pointer event is: without this one dispatched inside the
			// panel would stop at the shadow boundary and never reach the document,
			// which is exactly the listener under test.
			composed: true,
			pointerId: 1,
			button: 0,
			...where,
		}) as unknown as Event,
	);
}

function press(key: string, on: EventTarget = document): boolean {
	const event = new window.KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		composed: true,
	}) as unknown as KeyboardEvent;
	on.dispatchEvent(event);
	return event.defaultPrevented;
}

/** Lets a promise the panel is waiting on settle. */
function settle(): Promise<void> {
	return new Promise((done) => {
		setTimeout(done, 0);
	});
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
	(navigator as { clipboard?: unknown }).clipboard = { writeText };
}

describe("within", () => {
	test("keeps a margin at either edge", () => {
		expect(within(-40, 100, 800)).toBe(16);
		expect(within(780, 100, 800)).toBe(684);
	});

	test("pins the near edge when the panel is bigger than the viewport", () => {
		// The header is the half worth keeping.
		expect(within(300, 900, 800)).toBe(16);
	});
});

describe("beside", () => {
	test("sits past the point when there is room", () => {
		expect(beside(100, 560, 1200)).toBe(114);
	});

	test("flips to the near side rather than overflow", () => {
		expect(beside(1180, 560, 1200)).toBe(606);
	});

	test("stays inside the viewport wherever the click lands", () => {
		for (const point of [0, 1, 600, 1199, 1200]) {
			const start = beside(point, 560, 1200);
			expect(start).toBeGreaterThanOrEqual(16);
			expect(start + 560).toBeLessThanOrEqual(1200 - 16);
		}
	});
});

describe("show", () => {
	test("positions the panel by left/top, not by the corner it defaults to", () => {
		show(traced(), { x: 120, y: 90 });

		expect(panel().style.left).toMatch(/^\d+px$/);
		expect(panel().style.top).toMatch(/^\d+px$/);
		expect(panel().style.right).toBe("auto");
		expect(panel().style.bottom).toBe("auto");
	});

	test("leaves the stylesheet's corner alone when given no point", () => {
		show(traced());

		expect(panel().style.left).toBe("");
		expect(panel().style.top).toBe("");
		expect(panel().style.right).toBe("");
	});

	test("titles the panel with the value, quoted the way the console quotes it", () => {
		show(traced({ value: 42 }));
		expect(part(".value").textContent).toBe("42");

		show(traced());
		expect(part(".value").textContent).toBe('"ТОО Барыс"');
	});
});

/**
 * The whole point of the rewrite: the answer is a sentence, at the top, before
 * any evidence. What used to be here was four sections of evidence and the
 * reader doing the reasoning themselves.
 */
describe("the verdict", () => {
	test("leads with whose bug it is", () => {
		show(traced());
		expect(part(".verdict").textContent).toBe("Came from the API");
		// Nothing to do about it, so nothing is said.
		expect(panel().querySelector(".advice")).toBeNull();
	});

	test("says what to do when the app built the value itself", () => {
		show(
			traced({
				path: undefined,
				request: undefined,
				response: undefined,
				broken: true,
			}),
		);

		expect(part(".verdict").textContent).toBe("Built in the app");
		expect(part(".advice").textContent).toContain(
			"The one response camefrom recorded",
		);
	});

	test("blames the install, not the value, when nothing was recorded", () => {
		reset();
		show(
			traced({
				path: undefined,
				request: undefined,
				response: undefined,
				broken: true,
			}),
		);

		expect(part(".verdict").textContent).toBe("Nothing recorded yet");
		expect(part(".verdict").className).toContain("quiet");
		expect(part(".advice").textContent).toContain("install() ran too late");
	});
});

describe("the answer, row by row", () => {
	test("names the field, the call and the line", async () => {
		show(traced());
		await settle();

		expect(facts()).toEqual([
			"field: items[0].contractor.name",
			"request: GET /api/works200143ms",
			"source: src/works.table-columns.tsx:41<WorkRow>",
		]);
	});

	test("colours the status by how much of a problem it is", () => {
		const answered = (status: number): Provenance => {
			const call = traced().request;
			return traced({ request: call && { ...call, status } });
		};

		show(answered(200));
		expect(part(".status").className).toBe("status good");

		show(answered(500));
		expect(part(".status").className).toBe("status bad");

		// XHR that never got one at all, which is worth saying rather than a `0`.
		show(answered(0));
		expect(part(".status").textContent).toBe("no status");
	});

	test("does not repeat the headline as a field row", () => {
		show(
			traced({
				path: undefined,
				ambiguous: ["data[0].name", "data[1].name"],
			}),
		);

		expect(facts().some((row) => row.startsWith("field:"))).toBe(false);
	});

	/** The row that carries the reason, rather than an empty box beside a label. */
	test("says why there is no line when React recorded none", async () => {
		show(
			traced({ tree: [{ name: "td", missing: "untracked", target: true }] }),
		);
		await settle();

		expect(facts().at(-1)).toContain("React stopped recording call sites");
		expect(part(".facts .absent")).toBeTruthy();
	});
});

describe("the panes", () => {
	test("open on the one that answers the verdict", () => {
		show(traced());
		expect(tabs()).toEqual(["Response*", "Source", "Tree2"]);
	});

	test("open on the candidates when there is a choice to make", () => {
		show(traced({ path: undefined, ambiguous: ["a.name", "b.name"] }));
		expect(tabs().at(-1)).toBe("Candidates2*");
	});

	test("skip the response when there is none to show", () => {
		show(
			traced({
				path: undefined,
				request: undefined,
				response: undefined,
				broken: true,
			}),
		);
		expect(tabs()).toEqual(["Source*", "Tree2"]);
	});

	test("switch on a click and on the number keys", () => {
		show(traced());

		part('.tab[data-pane="tree"]').click();
		expect(tabs()).toEqual(["Response", "Source", "Tree2*"]);

		expect(press("1")).toBe(true);
		expect(tabs()).toEqual(["Response*", "Source", "Tree2"]);
	});

	test("number the response, colour it, and mark the field", () => {
		show(traced());

		const rows = all(".line");
		expect(rows.map((row) => row.querySelector(".num")?.textContent)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
			"8",
			"9",
		]);

		const marked = part(".line.on");
		expect(marked.querySelector(".num")?.textContent).toBe("5");
		expect(marked.textContent).toContain('"name": "ТОО Барыс"');
		// The key and the string it holds are two different things, and the panel
		// only knows that because `print` told it.
		expect(marked.querySelector(".t-key")?.textContent).toBe('"name"');
		expect(marked.querySelector(".t-string")?.textContent).toBe('"ТОО Барыс"');
	});

	test("mark whichever candidate the reader picks", () => {
		show(
			traced({
				path: undefined,
				ambiguous: ["items[0].contractor.name", "items[0].contractor"],
			}),
		);

		all(".choice")[1]?.click();
		// Picked in one pane and shown in another: a choice that quietly re-marks a
		// pane nobody is looking at is a click that did nothing.
		expect(tabs()[0]).toBe("Response*");
		expect(part(".line.on").textContent).toContain('"contractor": {');
	});

	test("say why there is no excerpt rather than showing an empty box", async () => {
		show(traced());
		press("2");
		await settle();

		expect(part(".empty").textContent).toContain("but not the file it is in");
		expect(asked.some((url) => url.includes("works.table-columns.tsx"))).toBe(
			true,
		);
	});
});

describe("the copy menu", () => {
	test("stays shut until it is asked for", () => {
		show(traced());

		expect(part(".menu").hidden).toBe(true);
		part(".copy").click();
		expect(part(".menu").hidden).toBe(false);
		expect(part(".copy").getAttribute("aria-expanded")).toBe("true");
	});

	test("names what each item copies, instead of one button called copy", () => {
		show(traced());

		expect(all(".item .what").map((what) => what.textContent)).toEqual([
			"Answer, for a ticket",
			"Field path",
			"Request URL",
			"curl",
		]);
	});

	test("puts the answer on the clipboard and says it went", async () => {
		const written: string[] = [];
		stubClipboard(async (text) => {
			written.push(text);
		});

		show(traced());
		part(".copy").click();
		all(".item")[0]?.click();
		await settle();

		expect(written[0]).toContain('camefrom "ТОО Барыс"');
		expect(written[0]).toContain("Came from the API");
		expect(written[0]).toContain("items[0].contractor.name");
		expect(part(".copy").textContent).toContain("copied");
		// And the menu is done with, rather than left open over the answer.
		expect(part(".menu").hidden).toBe(true);
	});

	test("keeps an item it cannot fill, disabled and saying why", () => {
		show(
			traced({
				path: undefined,
				request: undefined,
				response: undefined,
				broken: true,
			}),
		);

		const items = all(".item");
		expect(items).toHaveLength(4);
		expect((items[3] as HTMLButtonElement).disabled).toBe(true);
		expect(items[3]?.textContent).toContain("no request recorded");
	});

	test("copies the answer on its key, without the menu", async () => {
		const written: string[] = [];
		stubClipboard(async (text) => {
			written.push(text);
		});

		show(traced());
		expect(press("c")).toBe(true);
		await settle();

		expect(written[0]).toContain("Came from the API");
	});

	test("logs the answer and says so when the clipboard rejects", async () => {
		stubClipboard(() => Promise.reject(new Error("Document is not focused")));
		const logged: string[] = [];
		const spoke = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};

		try {
			show(traced());
			part(".copy").click();
			all(".item")[0]?.click();
			await settle();
		} finally {
			console.log = spoke;
		}

		expect(logged.join("\n")).toContain("Document is not focused");
		expect(logged.join("\n")).toContain("items[0].contractor.name");
		expect(part(".copy").textContent).toContain("see console");
	});
});

describe("the keyboard", () => {
	test("leaves a keystroke meant for the app's own text field alone", () => {
		show(traced());
		const input = document.createElement("input");
		document.body.append(input);

		try {
			expect(press("c", input)).toBe(false);
			expect(press("2", input)).toBe(false);
		} finally {
			input.remove();
		}
	});

	test("leaves a key it has no use for to the page", () => {
		show(traced());
		expect(press("k")).toBe(false);
	});

	test("closes on escape", () => {
		show(traced());
		press("Escape");

		expect(
			document
				.querySelector('[data-camefrom="panel"]')
				?.shadowRoot?.querySelector(".panel"),
		).toBeNull();
	});
});

describe("the palette", () => {
	/**
	 * The one thing the panel cannot check by looking at its own markup: the
	 * tokens are declared in `tokens.css` on `:host`, and everything that draws
	 * with them is inside the shadow tree. Nothing about that crossing shows up
	 * in the DOM — an import left behind, or a `:host` that stopped matching,
	 * leaves every `var()` resolving to nothing and the panel drawing on whatever
	 * the page has underneath, with the whole suite still green.
	 */
	test("crosses the shadow boundary to the box that draws with it", () => {
		show(traced());
		const drawn = window.getComputedStyle(
			panel() as never,
		) as unknown as CSSStyleDeclaration;

		expect(drawn.backgroundColor).toBe("#ffffff");
		expect(drawn.color).toBe("#1f2328");
	});
});

describe("dragging by the header", () => {
	test("takes over the position from the pointer", () => {
		show(traced());
		expect(panel().style.left).toBe("");

		pointer("pointerdown", part(".head"), { clientX: 40, clientY: 40 });
		expect(part(".head").classList.contains("dragging")).toBe(true);

		pointer("pointermove", part(".head"), { clientX: 240, clientY: 160 });
		expect(panel().style.left).toMatch(/^\d+px$/);
		expect(panel().style.right).toBe("auto");

		pointer("pointerup", part(".head"));
		expect(part(".head").classList.contains("dragging")).toBe(false);
	});

	test("does not start from a button in the header", () => {
		show(traced());

		pointer("pointerdown", part(".close"), { clientX: 40, clientY: 40 });
		expect(part(".head").classList.contains("dragging")).toBe(false);

		pointer("pointermove", part(".head"), { clientX: 240, clientY: 160 });
		expect(panel().style.left).toBe("");
	});
});

describe("a press outside the panel", () => {
	/** Whether the panel is still in the page, without throwing when it is not. */
	function shown(): boolean {
		return Boolean(
			document
				.querySelector('[data-camefrom="panel"]')
				?.shadowRoot?.querySelector(".panel"),
		);
	}

	test("closes it", () => {
		show(traced());

		pointer("pointerdown", document.body, { clientX: 5, clientY: 5 });
		expect(shown()).toBe(false);
	});

	test("leaves it alone when the press lands inside", () => {
		show(traced());

		// Through the shadow boundary, the way a real press arrives at the document.
		pointer("pointerdown", part(".pane"), { clientX: 40, clientY: 40 });
		expect(shown()).toBe(true);

		// Dragging by the header is a press too, and must not close what it moves.
		pointer("pointerdown", part(".head"), { clientX: 40, clientY: 40 });
		expect(shown()).toBe(true);
	});
});

describe("a frame with no line of its own", () => {
	const captured = [
		"Error: react-stack-top-frame",
		"    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
		"    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/chunk-ABC.js:17422:20)",
	].join("\n");

	function inlined(): Provenance {
		return traced({
			tree: [{ name: "td", missing: "inlined", stack: captured, target: true }],
		});
	}

	test("says why, and keeps the evidence out of the way until asked", () => {
		show(inlined());
		part('.tab[data-pane="tree"]').click();

		expect(part(".why.link").textContent).toContain("show it");
		expect(part(".stack").hidden).toBe(true);
	});

	test("shows the stack in the panel, and puts it back", () => {
		show(inlined());
		part('.tab[data-pane="tree"]').click();

		// In the panel, because that is where the button offering it is. A reader
		// who has to go and find the console has been shown nothing.
		part(".why.link").click();
		expect(part(".stack").hidden).toBe(false);
		expect(part(".stack").textContent).toContain("react_stack_bottom_frame");
		expect(part(".why.link").textContent).toContain("hide it");

		part(".why.link").click();
		expect(part(".stack").hidden).toBe(true);
		expect(part(".why.link").textContent).toContain("show it");
	});
});

describe("the host it lives in", () => {
	test("is marked as ours, so neither path traces what the panel shows", () => {
		show(traced());

		// Asked from the document, where both paths ask it: an event inside a
		// shadow root has no composed path left once the dispatch is over.
		const asked: boolean[] = [];
		const listener = (event: Event): void => {
			asked.push(ours(event));
		};
		document.addEventListener("pointermove", listener, true);
		try {
			pointer("pointermove", part(".pane"), { clientX: 40, clientY: 40 });
			pointer("pointermove", document.body, { clientX: 5, clientY: 5 });
		} finally {
			document.removeEventListener("pointermove", listener, true);
		}

		// The page around the panel stays traceable, which is the whole point of
		// the tool and the half a marker on everything would break.
		expect(asked).toEqual([true, false]);
	});
});

describe("hide", () => {
	test("takes the panel out of the page", () => {
		show(traced());
		hide();

		expect(
			document
				.querySelector('[data-camefrom="panel"]')
				?.shadowRoot?.querySelector(".panel"),
		).toBeNull();
	});

	test("takes the keyboard with it", () => {
		show(traced());
		hide();

		expect(press("c")).toBe(false);
	});
});
