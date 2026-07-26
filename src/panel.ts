import { print } from "./json";
import { type Excerpt, excerpt } from "./source";
import type { Hop, Provenance } from "./types";

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

let shadow: ShadowRoot | undefined;
/** Guards against a slow excerpt landing in a panel that has moved on. */
let generation = 0;

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

function at(hop: Hop): string {
	return [hop.file, hop.line, hop.column]
		.filter((part) => part !== undefined)
		.join(":");
}

/** Asks the dev server to open an editor. Vite answers; anything else will not. */
function openInEditor(hop: Hop): void {
	void fetch(`/__open-in-editor?file=${encodeURIComponent(at(hop))}`).catch(
		() => {
			console.log(
				`camefrom: could not open ${at(hop)}; is this a Vite dev server?`,
			);
		},
	);
}

function chainOf(provenance: Provenance): HTMLElement {
	const chain = element("div", "chain");

	for (const hop of provenance.hops) {
		const row = element("div", "hop");
		row.append(
			element("span", "arrow", "←"),
			element("span", undefined, hop.label),
		);

		if (hop.file) {
			const where = element(
				"button",
				"where",
				hop.line ? `${hop.file}:${hop.line}` : hop.file,
			);
			where.addEventListener("click", () => openInEditor(hop));
			row.append(where);
		}
		chain.append(row);
	}

	if (provenance.broken) {
		chain.append(
			element("div", "broken", "✗ not read from any recorded response"),
		);
	}
	return chain;
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

function bodyOf(provenance: Provenance): HTMLElement | undefined {
	if (provenance.response === undefined) return undefined;

	const printed = print(provenance.response);
	const body = element("pre", "body");
	const hit =
		provenance.path === undefined
			? undefined
			: printed.lineOfPath.get(provenance.path);

	if (hit === undefined) {
		body.textContent = printed.text;
		return body;
	}

	// Split around the matched line so it can be marked and scrolled to.
	const lines = printed.text.split("\n");
	const marked = element("mark", "hit", lines[hit] ?? "");
	body.append(
		document.createTextNode(`${lines.slice(0, hit).join("\n")}\n`),
		marked,
		document.createTextNode(`\n${lines.slice(hit + 1).join("\n")}`),
	);

	requestAnimationFrame(() => {
		marked.scrollIntoView({ block: "center" });
	});
	return body;
}

async function fillCode(
	target: HTMLElement,
	provenance: Provenance,
	mine: number,
): Promise<void> {
	const hop = provenance.hops.find(
		(candidate) => candidate.file && candidate.line,
	);
	if (!hop?.file || !hop.line) return;

	const found = await excerpt(hop.file, hop.line);
	if (!found || mine !== generation) return;

	target.append(codeOf(found));
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

	// Stays empty, and hidden by `.code:empty`, unless a dev server answers.
	const code = element("div", "code");
	panel.append(head, chainOf(provenance), code);

	const body = bodyOf(provenance);
	if (body) panel.append(body);

	root.append(panel);
	void fillCode(code, provenance, mine);
}

export function hide(): void {
	shadow?.querySelector(".panel")?.remove();
}
