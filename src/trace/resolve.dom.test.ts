import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { recordResponse, reset } from "../capture/store";
import { taint } from "../capture/taint";
import { resolve, textOf } from "./resolve";

const window = new Window({ url: "http://localhost" });
// happy-dom nodes are structurally what resolve() needs; it only ever touches
// instance members, never a DOM global.
const document = window.document as unknown as Document;

const meta = {
	method: "GET",
	url: "/api/works",
	status: 200,
	startedAt: 0,
	durationMs: 12,
};

afterAll(async () => {
	await window.happyDOM.close();
});

beforeEach(() => {
	reset();
	document.body.innerHTML = "";
});

function seed<T extends Record<string, unknown>>(body: T): T {
	const recorded = recordResponse(meta, body);
	// Reading through the proxy is what registers the paths.
	const tainted = taint(body, recorded.id);
	JSON.stringify(tainted);
	return tainted;
}

/**
 * Cells are written as divs on purpose: a bare `<td>` outside a table is
 * dropped by the parser, in happy-dom and in a real browser alike.
 */
function render(html: string): Element {
	document.body.innerHTML = html;
	const element = document.body.firstElementChild;
	if (!element) throw new Error("nothing rendered");
	return element;
}

function attachFiber(element: Element, fiber: object): Element {
	(element as unknown as Record<string, unknown>)["__reactFiber$test"] = fiber;
	return element;
}

describe("telling identical values apart", () => {
	const rows = () => ({
		items: [
			{ status: "Активен" },
			{ status: "Активен" },
			{ status: "Активен" },
		],
	});

	/** Two documents whose names are identical. The ids are the difference. */
	const documents = () => ({
		data: [
			{ id: 59, full_name: "Alpyspayev Bakhtiyar" },
			{ id: 60, full_name: "Alpyspayev Bakhtiyar" },
		],
	});

	/** A cell with the row object React handed the component around it. */
	function cellHolding(row: unknown, text = "Alpyspayev Bakhtiyar"): Element {
		return attachFiber(render(`<div>${text}</div>`), {
			type: "div",
			return: {
				type: function DocumentRow() {},
				memoizedProps: { row },
				return: null,
			},
		});
	}

	test("uses the row object the component was handed", () => {
		const body = seed(rows());
		expect(resolve(cellHolding(body.items[2], "Активен"))?.path).toBe(
			"items[2].status",
		);
	});

	/**
	 * The tool was wrong here for as long as it required the proxy itself, and
	 * it was wrong in the way that costs most: confidently, always naming the
	 * first row. Every shape below is one an ordinary app produces.
	 */
	describe("after the row was copied on its way down", () => {
		const copies: Array<[string, (rows: unknown[]) => unknown[]]> = [
			["spread", (all) => all.map((row) => ({ ...(row as object) }))],
			[
				"frozen by immer or Redux Toolkit",
				(all) => all.map((row) => Object.freeze({ ...(row as object) })),
			],
			[
				"narrowed by a query select",
				(all) =>
					all.map((row) => {
						const { id, full_name } = row as {
							id: number;
							full_name: string;
						};
						return { id, full_name };
					}),
			],
			[
				"remapped to another shape",
				(all) =>
					all.map((row) => {
						const source = row as { id: number; full_name: string };
						return { id: source.id, label: source.full_name };
					}),
			],
		];

		for (const [shape, copy] of copies) {
			test(`still names the right row when ${shape}`, () => {
				const body = seed(documents());
				const handed = copy(body.data as unknown[]);

				expect(resolve(cellHolding(handed[0]))?.path).toBe("data[0].full_name");
				expect(resolve(cellHolding(handed[1]))?.path).toBe("data[1].full_name");
			});
		}
	});

	test("names every candidate when nothing narrows it down", () => {
		seed(rows());

		const found = resolve(render("<div>Активен</div>"));
		expect(found?.path).toBeUndefined();
		expect(found?.ambiguous).toEqual([
			"items[0].status",
			"items[1].status",
			"items[2].status",
		]);
		expect(found?.hops[0]?.label).toBe("3 fields hold this value");
	});

	test("narrows the value index by a record it can place", () => {
		const body = seed(documents());
		const source = (body.data as unknown[])[1] as { id: number };
		// A model object keeping the name behind a getter. A click must not run
		// someone else's accessor, so the record cannot answer which field holds
		// the text — but its `id` still says which record it is, and that is
		// enough to throw away every read belonging to another row.
		const row = {
			id: source.id,
			get full_name(): string {
				return "Alpyspayev Bakhtiyar";
			},
		};

		expect(resolve(cellHolding(row))?.path).toBe("data[1].full_name");
	});

	test("reaches the record through a wrapper a table library added", () => {
		const body = seed(documents());
		// What a TanStack Table cell is handed: the record is on `.original`.
		const row = { original: { ...((body.data as unknown[])[1] as object) } };

		expect(resolve(cellHolding(row))?.path).toBe("data[1].full_name");
	});
});

describe("textOf", () => {
	test("takes only the text a node shows itself", () => {
		expect(textOf(render("<div>Барыс<span>ещё что-то</span></div>"))).toBe(
			"Барыс",
		);
	});

	test("falls back to nested text when a node has none of its own", () => {
		expect(textOf(render("<div><span>Барыс</span></div>"))).toBe("Барыс");
	});

	test("a text node yields its own data", () => {
		const cell = render("<div>Барыс</div>");
		expect(textOf(cell.firstChild as Node)).toBe("Барыс");
	});
});

describe("resolve", () => {
	test("traces a cell back to the field it was rendered from", () => {
		seed({ items: [{ contractor: { name: "ТОО Барыс" } }] });

		const found = resolve(render("<div>ТОО Барыс</div>"));
		expect(found?.broken).toBe(false);
		expect(found?.path).toBe("items[0].contractor.name");
		expect(found?.request?.url).toBe("/api/works");
	});

	test("works from the text node a click actually lands on", () => {
		seed({ name: "Барыс" });

		const cell = render("<div>Барыс</div>");
		expect(resolve(cell.firstChild)?.path).toBe("name");
	});

	test("returns nothing for an empty target", () => {
		expect(resolve(null)).toBeNull();
		expect(resolve(render("<div>   </div>"))).toBeNull();
	});
});

describe("the render tree", () => {
	test("reads outermost first, with the pointed-at frame marked", () => {
		seed({ name: "Барыс" });

		const cell = attachFiber(render("<div>Барыс</div>"), {
			// React hangs fibers off host elements, so the component that wrote
			// the element is its owner rather than the node itself.
			type: "div",
			_debugOwner: {
				type: function WorkRow() {},
				_debugOwner: { type: function WorksTable() {}, _debugOwner: null },
			},
		});

		expect(resolve(cell)?.tree).toEqual([
			// No debug stack on these, so why they have no line is unknown rather
			// than blamed on React's budget.
			{
				name: "WorksTable",
				at: undefined,
				missing: "unrecorded",
				target: false,
			},
			{ name: "WorkRow", at: undefined, missing: "unrecorded", target: false },
			{ name: "div", at: undefined, missing: "unrecorded", target: true },
		]);
	});

	test("falls back to the parent chain without React's debug fields", () => {
		seed({ name: "Барыс" });

		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			return: { type: function WorkRow() {}, return: null },
		});

		expect(resolve(cell)?.tree.map((frame) => frame.name)).toEqual([
			"WorkRow",
			"div",
		]);
	});

	test("unwraps memo and forwardRef to the name underneath", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: { displayName: "MemoWorkRow" },
			return: null,
		});
		const forwarded = attachFiber(render("<div>Астана</div>"), {
			type: { render: function Field() {} },
			return: null,
		});

		expect(resolve(cell)?.tree.at(0)?.name).toBe("MemoWorkRow");
		expect(resolve(forwarded)?.tree.at(0)?.name).toBe("Field");
	});

	test("takes the position out of the stack React captured", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			_debugStack: {
				stack: [
					"Error: react-stack-top-frame",
					"    at jsxDEV (http://localhost/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
					"    at WorkRow (http://localhost/src/works.tsx:41:9)",
				].join("\n"),
			},
			_debugOwner: null,
		});

		// Reported as the stack gave it, in the module the browser loaded. What
		// the panel shows is this mapped back through that module's source map.
		expect(resolve(cell)?.tree.at(-1)?.at).toEqual({
			file: "/src/works.tsx",
			line: 41,
			column: 9,
			bundle: "http://localhost/src/works.tsx",
		});
	});

	test("prefers what the Babel transform recorded, where it ran", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			_debugSource: { fileName: "src/works.tsx", lineNumber: 41 },
			_debugOwner: null,
		});

		expect(resolve(cell)?.tree.at(-1)?.at).toEqual({
			file: "src/works.tsx",
			line: 41,
			column: 0,
		});
	});

	test("is still reported when the text is a static label", () => {
		const label = attachFiber(render("<label>Подрядчик</label>"), {
			type: function WorkForm() {},
			return: null,
		});

		const found = resolve(label);
		expect(found?.broken).toBe(true);
		expect(found?.hops).toEqual([]);
		expect(found?.tree.at(-1)?.name).toBe("WorkForm");
	});
});

describe("source attributes", () => {
	test("are read from whichever inspector left them", () => {
		const cell = render(
			'<div data-tsd-source="src/works.table-columns.tsx:41:9">Барыс</div>',
		);

		expect(resolve(cell)?.tree.at(-1)?.at).toEqual({
			file: "src/works.table-columns.tsx",
			line: 41,
			column: 9,
		});
	});

	test("ours wins when both are present", () => {
		const cell = render(
			'<div data-camefrom-source="ours.tsx:1:1" data-tsd-source="theirs.tsx:2:2">Барыс</div>',
		);

		expect(resolve(cell)?.tree.at(-1)?.at?.file).toBe("ours.tsx");
	});

	test("are found on an ancestor, not just the node itself", () => {
		render(
			'<div data-tsd-source="src/works.row.tsx:10:2"><span>Барыс</span></div>',
		);
		const cell = document.querySelector("span");

		expect(resolve(cell)?.tree.at(-1)?.at?.line).toBe(10);
	});

	test("degrade to a bare file when there is no position", () => {
		const cell = render('<div data-tsd-source="src/works.tsx">Барыс</div>');

		expect(resolve(cell)?.tree.at(-1)?.at).toEqual({
			file: "src/works.tsx",
			line: 0,
			column: 0,
		});
	});

	test("fill in a position React did not record for the frame", () => {
		const cell = attachFiber(
			render('<div data-tsd-source="src/works.tsx:41:9">Барыс</div>'),
			{ type: "div", _debugOwner: null },
		);

		expect(resolve(cell)?.tree).toEqual([
			{
				name: "div",
				at: { file: "src/works.tsx", line: 41, column: 9 },
				target: true,
			},
		]);
	});
});

describe("when React has stopped recording positions", () => {
	test("the frame says so, instead of simply having no link", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			// The one stack React shares out after the ten thousandth element.
			_debugStack: {
				stack: [
					"Error: react-stack-top-frame",
					"    at UnknownOwner (http://localhost/node_modules/react/jsx-dev-runtime.js:118:14)",
					"    at Object.react_stack_bottom_frame (http://localhost/node_modules/react/jsx-dev-runtime.js:311:44)",
				].join("\n"),
			},
			_debugOwner: null,
		});

		expect(resolve(cell)?.tree.at(-1)).toEqual({
			name: "div",
			at: undefined,
			missing: "untracked",
			target: true,
		});
	});

	test("a build without the debug fields is not blamed for it", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			return: null,
		});

		// Nothing recorded it, which is not the same as a budget having run out —
		// telling somebody to reload would waste their time.
		expect(resolve(cell)?.tree.at(-1)?.missing).toBe("unrecorded");
	});

	test("a stack with no frame of the app's own says exactly that", () => {
		const cell = attachFiber(render("<div>Барыс</div>"), {
			type: "div",
			_debugStack: {
				stack: [
					"Error: react-stack-top-frame",
					"    at jsxDEV (http://localhost/node_modules/react/jsx-dev-runtime.js:250:23)",
					"    at react_stack_bottom_frame (http://localhost/node_modules/react-dom/client.js:174:20)",
				].join("\n"),
			},
			_debugOwner: null,
		});

		const frame = resolve(cell)?.tree.at(-1);
		expect(frame?.missing).toBe("inlined");
		// Carried through, because "the engine left the frame out" is a claim
		// about somebody else's optimiser and the only proof is what was captured.
		expect(frame?.stack).toContain("react_stack_bottom_frame");
	});
});
