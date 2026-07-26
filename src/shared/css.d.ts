/**
 * A stylesheet is imported for its text.
 *
 * Both surfaces live in a shadow root, which is fed a string and has nowhere to
 * put a stylesheet link — so the CSS has to reach the code as text either way.
 * Read from a `.css` file rather than typed into a template literal, it is a
 * file the formatter and the linter can both see, which a string is not.
 *
 * The bundler inlines it at build time: the import costs a template literal in
 * the output and no request at runtime.
 */
declare module "*.css" {
	const css: string;
	export default css;
}
