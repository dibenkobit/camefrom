import { expect, test } from "bun:test";
import * as real from "./index";
import * as noop from "./noop";

/**
 * Production builds resolve to noop through the `development` export
 * condition. An export added here and forgotten there would break only the
 * production bundle, where nobody is watching.
 */
test("the production no-op exports exactly what the real module does", () => {
	expect(Object.keys(noop).sort()).toEqual(Object.keys(real).sort());
});
