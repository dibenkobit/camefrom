import { expect, test } from "bun:test";

/**
 * The entry point decides what it is once, while the module is evaluated, so
 * each case needs a process of its own.
 *
 * What this pins is not the ternary — it is that a build which is not
 * development never reaches into `./devtools`, and so never patches the page.
 * That promise is the whole reason the package can be imported unconditionally,
 * and it breaks silently: in a production bundle nobody is watching.
 */
async function installUnder(
	nodeEnv: string,
): Promise<{ patched: boolean; answer: unknown }> {
	const entry = JSON.stringify(`${import.meta.dir}/index.ts`);
	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`import { install, camefrom } from ${entry};
			const before = globalThis.fetch;
			install();
			console.log(JSON.stringify({
				patched: globalThis.fetch !== before,
				answer: camefrom(null),
			}));`,
		],
		{ env: { ...process.env, NODE_ENV: nodeEnv }, stdout: "pipe" },
	);

	const out = await new Response(proc.stdout).text();
	const last = out.trim().split("\n").at(-1);
	if (!last) throw new Error(`no output from the ${nodeEnv} build`);
	return JSON.parse(last);
}

test("a development build patches fetch", async () => {
	const { patched } = await installUnder("development");
	expect(patched).toBe(true);
});

test("a production build installs nothing", async () => {
	const { patched, answer } = await installUnder("production");
	expect(patched).toBe(false);
	expect(answer).toBeNull();
});

// Anything unlabelled is treated as production, so a build that forgets to say
// what it is ships nothing rather than a tracer in front of every request.
test("an unlabelled build installs nothing", async () => {
	const { patched, answer } = await installUnder("");
	expect(patched).toBe(false);
	expect(answer).toBeNull();
});
