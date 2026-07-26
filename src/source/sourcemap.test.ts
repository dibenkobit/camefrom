import { afterEach, describe, expect, test } from "bun:test";
import { mapped } from "./sourcemap";

/**
 * The map below is real: emitted by Vite 7 with `@vitejs/plugin-react` for the
 * file quoted underneath it. The offsets it corrects are not a rounding error —
 * line 2 of the source is reported as line 4 by a stack trace, and line 8 as
 * line 14 — so the numbers here are the whole point of the module.
 */
const MAPPINGS =
	";;AAAA,OAAO,MAAM,mBAAmB;CAC9B,OAAO,wBAAC,MAAD,YAAI,gBAAiB;;;;;AAC9B;;AAEA,OAAO,MAAM,kBAAkB;CAC7B,OACE,wBAAC,OAAD;EAAK,WAAU;YACb,wBAAC,YAAD,CAAa;;;;;CACV;;;;;AAET";

/**
 * 1 export const SitesTable = () => {
 * 2   return <h1>Список сайтов</h1>;
 * 3 };
 * 4
 * 5 export const SitesList = () => {
 * 6   return (
 * 7     <div className='pb-8'>
 * 8       <SitesTable />
 * 9     </div>
 * 10  );
 * 11 };
 */
const SOURCE = [
	"export const SitesTable = () => {",
	"  return <h1>Список сайтов</h1>;",
	"};",
	"",
	"export const SitesList = () => {",
	"  return (",
	"    <div className='pb-8'>",
	"      <SitesTable />",
	"    </div>",
	"  );",
	"};",
].join("\n");

const MODULE = "http://localhost:5199/src/sites.tsx";

function serve(body: string, ok = true): void {
	globalThis.fetch = (async () => ({
		ok,
		text: async () => body,
		json: async () => JSON.parse(body) as unknown,
	})) as unknown as typeof fetch;
}

/** A module as a dev server serves it: the code, then the map after it. */
function withMap(
	map: Record<string, unknown>,
	code = "const x = 1;\n",
): string {
	const json = JSON.stringify({ version: 3, ...map });
	return `${code}//# sourceMappingURL=data:application/json;base64,${btoa(
		unescape(encodeURIComponent(json)),
	)}`;
}

const real = withMap({
	sources: ["sites.tsx"],
	sourcesContent: [SOURCE],
	mappings: MAPPINGS,
});

const original = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = original;
});

describe("mapped", () => {
	test("recovers the line the JSX was written on", async () => {
		serve(real);
		// Where the stack puts the `<h1>` element: line 4 of the module Vite built.
		expect(await mapped(`${MODULE}?a`, 4, 25)).toMatchObject({
			file: "/src/sites.tsx",
			line: 2,
		});
	});

	test("corrects an offset that differs further down the same file", async () => {
		serve(real);
		// Line 14 of the module, and the offset here is six lines rather than two:
		// one constant correction would have been wrong for one of the two.
		expect(await mapped(`${MODULE}?b`, 14, 29)).toMatchObject({
			file: "/src/sites.tsx",
			line: 8,
		});
	});

	test("carries the file's own text when the map has it", async () => {
		serve(real);
		const found = await mapped(`${MODULE}?c`, 4, 25);
		expect(found?.source).toBe(SOURCE);
	});

	test("says nothing when the module carries no map", async () => {
		serve("const x = 1;\n");
		expect(await mapped(`${MODULE}?d`, 4, 25)).toBeUndefined();
	});

	test("says nothing about a line the map does not cover", async () => {
		serve(real);
		expect(await mapped(`${MODULE}?e`, 900, 1)).toBeUndefined();
	});

	test("says nothing rather than decode an index map wrongly", async () => {
		serve(withMap({ sections: [] }));
		expect(await mapped(`${MODULE}?f`, 1, 1)).toBeUndefined();
	});

	test("a module the server will not serve is not an answer", async () => {
		serve("", false);
		expect(await mapped(`${MODULE}?g`, 1, 1)).toBeUndefined();
	});

	test("reads a map given as plain rather than base64 JSON", async () => {
		const json = JSON.stringify({
			version: 3,
			sources: ["sites.tsx"],
			mappings: MAPPINGS,
		});
		serve(
			`const x = 1;\n//# sourceMappingURL=data:application/json,${encodeURIComponent(json)}`,
		);
		expect(await mapped(`${MODULE}?h`, 4, 25)).toMatchObject({ line: 2 });
	});
});
