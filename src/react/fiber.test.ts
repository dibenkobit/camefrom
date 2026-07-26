import { describe, expect, test } from "bun:test";
import type { Frame } from "../shared/types";
import { innermost } from "./fiber";

function frame(name: string, file?: string, line = 10): Frame {
	return {
		name,
		at: file ? { file, line, column: 1 } : undefined,
		target: false,
	};
}

describe("innermost", () => {
	test("takes the deepest frame that knows where it is", () => {
		expect(
			innermost([
				frame("Layout", "/src/layout.tsx"),
				frame("Breadcrumbs", "/src/breadcrumbs.tsx"),
				frame("span"),
			])?.name,
		).toBe("Breadcrumbs");
	});

	/**
	 * The case this exists for: React Router writes the `<a>` behind every
	 * `<Link>`, so the deepest recorded line in a breadcrumb is a line in
	 * `node_modules` — precise, true, and no use to anybody reading it.
	 */
	test("steps over a line inside a dependency to reach the project's own", () => {
		const found = innermost([
			frame("Breadcrumbs", "/src/app/breadcrumbs.tsx"),
			frame("Link", "/src/app/ui/breadcrumb.tsx", 45),
			frame("a", "/node_modules/react-router/dist/development/lib/dom/lib.js"),
		]);

		expect(found?.name).toBe("Link");
		expect(found?.at?.line).toBe(45);
	});

	test("keeps a dependency's line when there is nothing else", () => {
		// Better a line somebody cannot edit than an empty box: the excerpt names
		// the file it came from, so nobody is left thinking it is theirs. Still the
		// innermost of them, which is the rule the rest of the time too.
		const radix = "/node_modules/@radix-ui/react-tooltip/dist/index.mjs";
		expect(
			innermost([frame("Tooltip", radix, 200), frame("div", radix, 214)])?.at
				?.line,
		).toBe(214);
	});

	test("a frame with only a file to give is not a line to show", () => {
		// What an inspector's attribute leaves behind when it named no line.
		expect(innermost([frame("td", "/src/works.tsx", 0)])).toBeUndefined();
	});

	test("nothing recorded anywhere is not an answer", () => {
		expect(innermost([frame("WorkRow"), frame("td")])).toBeUndefined();
		expect(innermost([])).toBeUndefined();
	});
});
