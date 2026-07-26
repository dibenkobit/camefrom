import { describe, expect, test } from "bun:test";
import { callSite, fileOf, untracked } from "./stack";

/**
 * The stacks below are real, not invented: captured from React 19.2.8 and
 * written out in each engine's own format. Getting a frame wrong points the
 * editor at somebody else's file, so the shapes are worth pinning down.
 */

const chrome = [
	"Error: react-stack-top-frame",
	"    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
	"    at WorkRow (http://localhost:5173/src/works.table-columns.tsx?t=1753500000000:41:9)",
	"    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/chunk-ABC.js:17422:20)",
	"    at WorksTable (http://localhost:5173/src/works.tsx:12:3)",
].join("\n");

const firefox = [
	"jsxDEV@http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23",
	"WorkRow@http://localhost:5173/src/works.table-columns.tsx:41:9",
	"react_stack_bottom_frame@http://localhost:5173/node_modules/.vite/deps/chunk-ABC.js:17422:20",
].join("\n");

describe("callSite", () => {
	test("names the frame of the app that wrote the element", () => {
		expect(callSite(chrome)).toEqual({
			file: "/src/works.table-columns.tsx",
			line: 41,
			column: 9,
			// The module as loaded, query and all: a position off a stack is a
			// position in a bundler's output, and this is where its map lives.
			bundle:
				"http://localhost:5173/src/works.table-columns.tsx?t=1753500000000",
		});
	});

	test("reads the shape Firefox and Safari write", () => {
		expect(callSite(firefox)).toMatchObject({
			file: "/src/works.table-columns.tsx",
			line: 41,
			column: 9,
		});
	});

	test("stops where React stops, and does not reach past it", () => {
		// `WorksTable` sits below the bottom frame: it is React calling the app,
		// not the app writing this element, and claiming it would be a lie.
		const beyond = callSite(chrome);
		expect(beyond?.file).not.toBe("/src/works.tsx");
	});

	test("says nothing when the engine left only React frames", () => {
		// A component whose body is a single `return` can be tail-called away,
		// and React's own owner stack comes back empty here too.
		const inlined = [
			"Error: react-stack-top-frame",
			"    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
			"    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/chunk-ABC.js:17422:20)",
		].join("\n");

		expect(callSite(inlined)).toBeUndefined();
	});

	test("skips a runtime frame the bundler happened to add", () => {
		const doubled = [
			"Error: react-stack-top-frame",
			"    at jsxDEVImpl (http://localhost:5173/node_modules/react/cjs/react-jsx-dev-runtime.development.js:333:13)",
			"    at jsxDEV (http://localhost:5173/node_modules/react/cjs/react-jsx-dev-runtime.development.js:490:9)",
			"    at Cell (http://localhost:5173/src/cell.tsx:8:5)",
		].join("\n");

		expect(callSite(doubled)?.file).toBe("/src/cell.tsx");
	});

	test("reads a path with brackets of its own in it", () => {
		// A route group — `(table)`, `(layout)` — is a directory name, and the
		// bracket it is spelled with sits inside the brackets V8 wraps the
		// location in. The component that wrote the element lives in one of
		// these in every project that groups routes that way.
		const grouped = [
			"Error: react-stack-top-frame",
			"    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
			"    at SitesTable (http://localhost:5173/src/app/sites/(table)/sites.table.tsx?t=1753500000000:12:17)",
			"    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/chunk-ABC.js:17422:20)",
		].join("\n");

		expect(callSite(grouped)).toEqual({
			file: "/src/app/sites/(table)/sites.table.tsx",
			line: 12,
			column: 17,
			bundle:
				"http://localhost:5173/src/app/sites/(table)/sites.table.tsx?t=1753500000000",
		});
	});

	test("splits a Firefox frame on the separator, not on the path", () => {
		// `/@fs/` is how Vite serves a file from outside the project root, so the
		// `@` that separates the name from the URL is not the only one in the line.
		const outside = [
			"jsxDEV@http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23",
			"Cell@http://localhost:5173/@fs/Users/me/lib/table.tsx:8:5",
		].join("\n");

		expect(callSite(outside)).toMatchObject({
			file: "/Users/me/lib/table.tsx",
			line: 8,
			column: 5,
		});
	});

	test("ignores a frame with no position to give", () => {
		const anonymous = [
			"Error: react-stack-top-frame",
			"    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:23)",
			"    at <anonymous>",
			"    at Cell (http://localhost:5173/src/cell.tsx:8:5)",
		].join("\n");

		expect(callSite(anonymous)?.file).toBe("/src/cell.tsx");
	});

	test("an empty stack is not an answer", () => {
		expect(callSite("")).toBeUndefined();
	});
});

describe("untracked", () => {
	/**
	 * What React hands out once the budget is spent: one shared stack, created
	 * through `UnknownOwner` rather than at the element's own call site. Every
	 * element after the ten thousandth gets this one, and the counter never
	 * resets, so a long-lived page is mostly this.
	 */
	const shared = [
		"Error: react-stack-top-frame",
		"    at UnknownOwner (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:118:14)",
		"    at Object.react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:311:44)",
	].join("\n");

	test("recognises the stack React shares once it has stopped recording", () => {
		expect(untracked(shared)).toBe(true);
		expect(callSite(shared)).toBeUndefined();
	});

	test("a real call site is not that", () => {
		expect(untracked(chrome)).toBe(false);
	});
});

describe("fileOf", () => {
	test("keeps the path a dev server can be asked for", () => {
		expect(fileOf("http://localhost:5173/src/works.tsx")).toBe(
			"/src/works.tsx",
		);
	});

	test("drops the query Vite uses to bust its own cache", () => {
		expect(fileOf("http://localhost:5173/src/works.tsx?t=1753500000000")).toBe(
			"/src/works.tsx",
		);
	});

	test("unwraps a file served from outside the project root", () => {
		expect(fileOf("http://localhost:5173/@fs/Users/me/lib/table.tsx")).toBe(
			"/Users/me/lib/table.tsx",
		);
	});

	test("refuses what is not a file at all", () => {
		// Safari writes these for built-ins, and `native:1:11` parses as a
		// position perfectly well while naming nothing that can be opened.
		expect(fileOf("native")).toBeUndefined();
		expect(fileOf("[native code]")).toBeUndefined();
		expect(fileOf("eval")).toBeUndefined();
	});
});
