import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { enter, inspecting, leave, watch } from "./inspect";
import { own } from "./pointer";

const window = new Window({ url: "http://localhost" });
const document = window.document as unknown as Document;

const globals = globalThis as unknown as Record<string, unknown>;
globals.window = window;
globals.document = document;

/** Every time the mode changed, and to what. */
const told: boolean[] = [];
watch((on) => {
	told.push(on);
});

afterAll(async () => {
	leave();
	await window.happyDOM.close();
	delete globals.document;
	delete globals.window;
});

beforeEach(() => {
	leave();
	told.length = 0;
});

function badge(): HTMLElement | null {
	const host = document.querySelector('[data-camefrom="inspect"]');
	return (host?.shadowRoot?.querySelector(".badge") as HTMLElement) ?? null;
}

function shown(): boolean {
	const found = badge();
	return found ? !found.hidden : false;
}

/** Whether the page is being told to draw a crosshair. */
function crosshair(): boolean {
	return Array.from(document.head.querySelectorAll("style")).some((style) =>
		(style.textContent ?? "").includes("crosshair"),
	);
}

function shortcut(over: Record<string, unknown> = {}): void {
	document.dispatchEvent(
		new window.KeyboardEvent("keydown", {
			code: "KeyC",
			shiftKey: true,
			altKey: true,
			bubbles: true,
			cancelable: true,
			...over,
		}) as unknown as Event,
	);
}

/** A click, and whether the mode took it away from the page. */
function clicked(on: EventTarget): boolean {
	const event = new window.MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		composed: true,
	}) as unknown as MouseEvent;
	on.dispatchEvent(event);
	return event.defaultPrevented;
}

describe("before it is asked for", () => {
	// First in the file: nothing has been mounted, so this can hold the mode to
	// renting no space in the page until it is wanted.
	test("nothing is in the page and nothing is inspecting", () => {
		expect(document.querySelector('[data-camefrom="inspect"]')).toBeNull();
		expect(inspecting()).toBe(false);
		expect(crosshair()).toBe(false);
	});
});

describe("the shortcut", () => {
	test("turns the mode on, and off again", () => {
		shortcut();
		expect(inspecting()).toBe(true);

		shortcut();
		expect(inspecting()).toBe(false);
		expect(told).toEqual([true, false]);
	});

	/**
	 * Read off `code`, because alt is a compose key: on macOS this combination
	 * produces `Ç`, and a check against `event.key` never fires.
	 */
	test("answers to the physical key, whatever it produced", () => {
		shortcut({ key: "Ç" });
		expect(inspecting()).toBe(true);
	});

	test("is not any of the neighbouring combinations", () => {
		shortcut({ shiftKey: false });
		shortcut({ altKey: false });
		shortcut({ metaKey: true });
		shortcut({ code: "KeyD" });

		expect(inspecting()).toBe(false);
		expect(told).toEqual([]);
	});
});

describe("while it is on", () => {
	test("says so on screen, and how to stop", () => {
		enter();

		expect(shown()).toBe(true);
		expect(badge()?.textContent).toContain("inspecting");
		expect(badge()?.textContent).toContain("stop");
		expect(crosshair()).toBe(true);
	});

	/**
	 * A click in a picker belongs to the picker. Without this, picking a value in
	 * a table follows the link under it and navigates away from the table.
	 */
	test("takes the page's clicks away from it", () => {
		enter();
		expect(clicked(document.body)).toBe(true);
	});

	test("leaves clicks on the tool's own UI alone", () => {
		enter();

		const host = document.createElement("div");
		own(host, "panel");
		document.body.append(host);
		const inside = document.createElement("button");
		host.attachShadow({ mode: "open" }).append(inside);

		try {
			// Or the copy button in the panel would stop working the moment the mode
			// that opened the panel was still on.
			expect(clicked(inside)).toBe(false);
		} finally {
			host.remove();
		}
	});

	test("stops on escape", () => {
		enter();
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			}) as unknown as Event,
		);

		expect(inspecting()).toBe(false);
	});

	test("stops when the badge is asked to stop", () => {
		enter();
		const stop = badge()?.querySelector(".stop") as HTMLElement | null;
		if (!stop) throw new Error("the badge offers no way to stop");
		stop.click();

		expect(inspecting()).toBe(false);
	});
});

describe("on the way out", () => {
	test("takes the badge, the cursor and the clicks with it", () => {
		enter();
		leave();

		expect(shown()).toBe(false);
		expect(crosshair()).toBe(false);
		expect(clicked(document.body)).toBe(false);
		expect(told.at(-1)).toBe(false);
	});

	test("leaving twice is not two changes", () => {
		enter();
		leave();
		leave();

		expect(told).toEqual([true, false]);
	});
});
