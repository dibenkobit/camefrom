import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { beside, hide, show, within } from "./panel";
import { format } from "./report";
import type { Provenance } from "./types";

const window = new Window({ url: "http://localhost" });

// The panel reaches for the ambient document the way it will in a browser, so
// the globals have to be in place before it is ever called. happy-dom's
// document is structurally what it needs.
globalThis.document = window.document as unknown as Document;
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
	Number(setTimeout(() => callback(0), 0))) as typeof requestAnimationFrame;

afterAll(async () => {
	await window.happyDOM.close();
	// Other suites share this process and should not inherit a DOM.
	delete (globalThis as { document?: Document }).document;
	delete (globalThis as { requestAnimationFrame?: unknown })
		.requestAnimationFrame;
});

beforeEach(() => {
	// Not `document.body.innerHTML = ""`: the module keeps the host it mounted,
	// and a fresh body would leave it appending panels to a detached shadow root.
	hide();
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
			durationMs: 12,
		},
		response: { items: [{ contractor: { name: "ТОО Барыс" } }] },
		hops: [
			{ kind: "read", label: "items[0].contractor.name" },
			{ kind: "response", label: "GET /api/works · 200 · 12ms" },
		],
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
	const found = document.body.lastElementChild?.shadowRoot?.querySelector(
		".panel",
	) as HTMLElement | null | undefined;
	if (!found) throw new Error("no panel in the page");
	return found;
}

function part(selector: string): HTMLElement {
	const found = panel().querySelector(selector) as HTMLElement | null;
	if (!found) throw new Error(`no ${selector} in the panel`);
	return found;
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

/** Lets the copy button's promise settle. */
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
		expect(beside(100, 460, 1200)).toBe(114);
	});

	test("flips to the near side rather than overflow", () => {
		// 1180 + 14 + 460 runs off the right edge, so the panel goes left of the
		// point instead of being clamped into it.
		expect(beside(1180, 460, 1200)).toBe(706);
	});

	test("stays inside the viewport wherever the click lands", () => {
		for (const point of [0, 1, 600, 1199, 1200]) {
			const start = beside(point, 460, 1200);
			expect(start).toBeGreaterThanOrEqual(16);
			expect(start + 460).toBeLessThanOrEqual(1200 - 16);
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

	test("titles the panel with the value, quoted the way report does", () => {
		show(traced({ value: 42 }));
		expect(part(".value").textContent).toBe("42");

		show(traced());
		expect(part(".value").textContent).toBe('"ТОО Барыс"');
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

describe("the copy button", () => {
	test("puts the value, the chain and the request on the clipboard", async () => {
		const written: string[] = [];
		stubClipboard(async (text) => {
			written.push(text);
		});
		const provenance = traced();

		show(provenance);
		part(".copy").click();
		await settle();

		const text = written[0] ?? "";
		expect(written).toHaveLength(1);
		expect(text.startsWith('camefrom "ТОО Барыс"\n')).toBe(true);
		// Reused, not reworded: the panel must say what the console says.
		for (const line of format(provenance)) expect(text).toContain(line);
		expect(text).toContain("request: GET /api/works");
		expect(part(".copy").textContent).toBe("copied");
	});

	test("leaves the request line out when there is no request", async () => {
		const written: string[] = [];
		stubClipboard(async (text) => {
			written.push(text);
		});

		show(traced({ request: undefined, response: undefined, broken: true }));
		part(".copy").click();
		await settle();

		expect(written[0]).not.toContain("request:");
		expect(written[0]).toContain("✗ not read from any recorded response");
	});

	test("logs the chain and says so when the clipboard rejects", async () => {
		stubClipboard(() => Promise.reject(new Error("Document is not focused")));
		const logged: string[] = [];
		const spoke = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};

		try {
			show(traced());
			part(".copy").click();
			await settle();
		} finally {
			console.log = spoke;
		}

		expect(logged.join("\n")).toContain("Document is not focused");
		expect(logged.join("\n")).toContain("items[0].contractor.name");
		expect(part(".copy").textContent).toBe("see console");
	});

	test("logs the chain and says so when there is no clipboard at all", async () => {
		// What an http origin looks like in Chrome and Safari.
		delete (navigator as { clipboard?: unknown }).clipboard;
		const logged: string[] = [];
		const spoke = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};

		try {
			show(traced());
			part(".copy").click();
			await settle();
		} finally {
			console.log = spoke;
		}

		expect(logged.join("\n")).toContain("items[0].contractor.name");
		expect(part(".copy").textContent).toBe("see console");
	});
});

describe("a press outside the panel", () => {
	/** Whether the panel is still in the page, without throwing when it is not. */
	function shown(): boolean {
		return Boolean(
			document.body.lastElementChild?.shadowRoot?.querySelector(".panel"),
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
		pointer("pointerdown", part(".body"), { clientX: 40, clientY: 40 });
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

		expect(part(".why.link").textContent).toContain("show it");
		expect(part(".stack").hidden).toBe(true);
	});

	test("shows the stack in the panel, and puts it back", () => {
		show(inlined());

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

describe("hide", () => {
	test("takes the panel out of the page", () => {
		show(traced());
		hide();

		expect(
			document.body.lastElementChild?.shadowRoot?.querySelector(".panel"),
		).toBeNull();
	});
});
