import { innermost } from "./fiber";
import { type PrintedJson, print } from "./json";
import { type Excerpt, excerpt } from "./source";
import type { Frame, Position, Provenance } from "./types";

const STYLE = `
:host { all: initial; }
.panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    width: 460px;
    max-width: calc(100vw - 32px);
    max-height: min(70vh, 620px);
    border: 1px solid var(--edge);
    border-radius: 10px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.28);
    font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;

    --bg: #ffffff;
    --fg: #1a1a1a;
    --dim: #6b6b6b;
    --edge: #e2e2e2;
    --link: #0a58ca;
    --warn: #b3450b;
    --mark: #fff3ba;
}
@media (prefers-color-scheme: dark) {
    .panel {
        --bg: #17181a;
        --fg: #ededed;
        --dim: #8f9094;
        --edge: #2c2e31;
        --link: #7aa2f7;
        --warn: #e0a35e;
        --mark: #3b3520;
    }
}
.head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--edge);
}
.value { flex: 1; font-weight: 600; overflow-wrap: anywhere; }
.close {
    all: unset;
    padding: 0 4px;
    color: var(--dim);
    cursor: pointer;
    line-height: 1;
}
.close:hover { color: var(--fg); }
.chain { padding: 8px 12px; display: flex; flex-direction: column; gap: 2px; }
.hop { display: flex; gap: 6px; }
.arrow { color: var(--dim); }
.where { all: unset; color: var(--link); cursor: pointer; text-decoration: underline; }
.broken { color: var(--warn); }
.choices { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding-left: 14px; }
.choice { all: unset; color: var(--link); cursor: pointer; }
.choice:hover, .choice.on { background: var(--mark); color: var(--fg); }
.tree { border-top: 1px solid var(--edge); padding: 8px 12px; overflow-x: auto; }
.tree:empty { display: none; }
.frame { display: flex; gap: 8px; }
.name { color: var(--dim); white-space: pre; }
.frame.on .name { color: var(--fg); font-weight: 600; }
.code { border-top: 1px solid var(--edge); padding: 8px 0; overflow-x: auto; }
.code:empty { display: none; }
.line { display: flex; gap: 10px; padding: 0 12px; white-space: pre; }
.line.on { background: var(--mark); color: var(--fg); }
.num { min-width: 2.5em; text-align: right; color: var(--dim); user-select: none; }
.body {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 8px 12px 12px;
    border-top: 1px solid var(--edge);
    overflow: auto;
    white-space: pre;
    color: var(--dim);
}
.hit { display: block; background: var(--mark); color: var(--fg); border-radius: 3px; }
`;

/** Candidate fields worth a row of their own before a count says more. */
const MAX_CHOICES = 12;

let shadow: ShadowRoot | undefined;
/** Guards against a slow excerpt landing in a panel that has moved on. */
let generation = 0;
/** The panel shows one body at a time, and printing a large one is not free. */
let printed: { source: unknown; json: PrintedJson } | undefined;

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	// Always text, never markup: a response body is untrusted input, and this
	// panel is not a place to invent an injection.
	if (text !== undefined) node.textContent = text;
	return node;
}

function mount(): ShadowRoot {
	if (shadow) return shadow;

	const host = element("div");
	host.style.setProperty("all", "initial");
	shadow = host.attachShadow({ mode: "open" });
	shadow.append(element("style", undefined, STYLE));
	document.body.append(host);

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hide();
	});

	return shadow;
}

/** How an editor is told where to go. A line of 0 means we only know the file. */
function target(at: Position): string {
	return at.line > 0 ? `${at.file}:${at.line}:${at.column}` : at.file;
}

/** Asks the dev server to open an editor. Vite answers; anything else will not. */
function openInEditor(at: Position): void {
	const where = target(at);
	void fetch(`/__open-in-editor?file=${encodeURIComponent(where)}`).catch(
		() => {
			console.log(
				`camefrom: could not open ${where}; is this a Vite dev server?`,
			);
		},
	);
}

/**
 * The candidates, when the field could not be narrowed to one.
 *
 * Listed rather than resolved, and each one selectable, because the developer
 * looking at the row knows which of them it is and the tool does not.
 */
function choicesOf(
	paths: string[],
	onPick: (path: string) => void,
): HTMLElement {
	const choices = element("div", "choices");
	const shown = paths.slice(0, MAX_CHOICES);

	for (const path of shown) {
		const choice = element("button", "choice", path);
		choice.addEventListener("click", () => {
			for (const other of Array.from(choices.children)) {
				other.className = "choice";
			}
			choice.className = "choice on";
			onPick(path);
		});
		choices.append(choice);
	}

	// Never trailing off silently: a truncated list that looks complete is how
	// a developer concludes there were only twelve.
	if (paths.length > shown.length) {
		choices.append(
			element("div", "arrow", `…${paths.length - shown.length} more`),
		);
	}
	return choices;
}

function chainOf(
	provenance: Provenance,
	onPick: (path: string) => void,
): HTMLElement {
	const chain = element("div", "chain");

	for (const hop of provenance.hops) {
		const row = element("div", "hop");
		row.append(
			element("span", "arrow", "←"),
			element("span", undefined, hop.label),
		);
		chain.append(row);

		if (hop.kind === "read" && provenance.ambiguous) {
			chain.append(choicesOf(provenance.ambiguous, onPick));
		}
	}

	if (provenance.broken) {
		chain.append(
			element("div", "broken", "✗ not read from any recorded response"),
		);
	}
	return chain;
}

/**
 * Who rendered it, as a tree, outermost first.
 *
 * Every frame is a link: the answer to "where did this come from" is usually
 * not the innermost component but the column or the mapper two frames out, and
 * that is only useful if it opens.
 */
function treeView(frames: readonly Frame[]): HTMLElement {
	const tree = element("div", "tree");

	frames.forEach((frame, depth) => {
		const row = element("div", frame.target ? "frame on" : "frame");
		row.append(element("span", "name", `${"  ".repeat(depth)}<${frame.name}>`));

		const at = frame.at;
		if (at) {
			const where = element(
				"button",
				"where",
				at.line > 0 ? `${at.file}:${at.line}` : at.file,
			);
			where.addEventListener("click", () => openInEditor(at));
			row.append(where);
		}
		tree.append(row);
	});

	return tree;
}

function codeOf(found: Excerpt): DocumentFragment {
	const fragment = document.createDocumentFragment();

	found.lines.forEach((text, index) => {
		const number = found.first + index;
		const row = element("div", number === found.target ? "line on" : "line");
		row.append(
			element("span", "num", String(number)),
			element("span", undefined, text),
		);
		fragment.append(row);
	});

	return fragment;
}

function printedOf(source: unknown): PrintedJson {
	// Compared against `undefined` explicitly: `printed?.source === source` also
	// holds when nothing has been printed and the body itself is undefined.
	if (printed !== undefined && printed.source === source) return printed.json;

	const json = print(source);
	printed = { source, json };
	return json;
}

/** Writes the response into `body`, marked and scrolled to `path`. */
function fillBody(body: HTMLElement, source: unknown, path?: string): void {
	const json = printedOf(source);
	const hit = path === undefined ? undefined : json.lineOfPath.get(path);
	body.textContent = "";

	if (hit === undefined) {
		body.textContent = json.text;
		return;
	}

	// Split around the matched line so it can be marked and scrolled to.
	const lines = json.text.split("\n");
	const marked = element("mark", "hit", lines[hit] ?? "");
	body.append(
		document.createTextNode(`${lines.slice(0, hit).join("\n")}\n`),
		marked,
		document.createTextNode(`\n${lines.slice(hit + 1).join("\n")}`),
	);

	requestAnimationFrame(() => {
		marked.scrollIntoView({ block: "center" });
	});
}

async function fillCode(
	code: HTMLElement,
	provenance: Provenance,
	mine: number,
): Promise<void> {
	// The innermost frame we could locate: the closest line to the value itself.
	const at = innermost(provenance.tree);
	if (!at) return;

	const found = await excerpt(at.file, at.line);
	if (!found || mine !== generation) return;

	code.append(codeOf(found));
}

export function show(provenance: Provenance): void {
	const root = mount();
	root.querySelector(".panel")?.remove();
	const mine = ++generation;

	const panel = element("div", "panel");

	const head = element("div", "head");
	const value =
		typeof provenance.value === "string"
			? `"${provenance.value}"`
			: String(provenance.value);
	head.append(element("div", "value", value));

	const close = element("button", "close", "✕");
	close.addEventListener("click", hide);
	head.append(close);

	const source = provenance.response;
	const body = source === undefined ? undefined : element("pre", "body");
	if (body) fillBody(body, source, provenance.path);

	// Stays empty, and hidden by `.code:empty`, unless a dev server answers.
	const code = element("div", "code");
	panel.append(
		head,
		chainOf(provenance, (path) => {
			if (body) fillBody(body, source, path);
		}),
		treeView(provenance.tree),
		code,
	);
	if (body) panel.append(body);

	root.append(panel);
	void fillCode(code, provenance, mine);
}

export function hide(): void {
	shadow?.querySelector(".panel")?.remove();
}
