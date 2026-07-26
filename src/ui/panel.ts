import { innermost } from "../react/fiber";
import type { Frame, Position, Provenance } from "../shared/types";
import { type Excerpt, excerptOf } from "../source/excerpt";
import { written } from "../source/sourcemap";
import { type PrintedJson, print } from "./json";
import rules from "./panel.css" with { type: "text" };
import { own } from "./pointer";
import { format, title } from "./report";
import tokens from "./tokens.css" with { type: "text" };

/** The shared palette, then the rules that draw with it. */
const STYLE = tokens + rules;

/** Candidate fields worth a row of their own before a count says more. */
const MAX_CHOICES = 12;
/**
 * Why a frame has no line. Short, because it sits on the row itself, and each
 * one names what would change it rather than only what went wrong.
 */
const MISSING: Record<NonNullable<Frame["missing"]>, string> = {
	untracked: "React stopped recording · reload",
	inlined: "no frame for it in the stack",
	unmapped: "no source map for this module",
	unrecorded: "this build records no positions",
};

/** The one cause worth spelling out, because reloading actually fixes it. */
const RELOAD =
	"React records the call site of the first 10 000 elements only, and never starts again · reload the page to get them back";
/** How far the panel keeps clear of the point it was opened at. */
const GAP = 14;
/**
 * How close the panel may come to the edge of the viewport. The same inset the
 * stylesheet parks it at, and the one its `max-width` already reserves.
 */
const EDGE = 16;
/** The copy button at rest, restored once it has said how the copy went. */
const COPY = "copy";

/** A point in viewport coordinates — where the pointer was, in practice. */
export interface Point {
	x: number;
	y: number;
}

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
	if (shadow) {
		// An app that replaces the whole body takes the host with it, and a panel
		// that appends into a detached shadow root cannot be told apart from a
		// tool that never loaded. Putting it back costs one property read.
		const host = shadow.host;
		if (!host.isConnected) document.body.append(host);
		return shadow;
	}

	const host = element("div");
	own(host, "panel");
	host.style.setProperty("all", "initial");
	shadow = host.attachShadow({ mode: "open" });
	shadow.append(element("style", undefined, STYLE));
	document.body.append(host);

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hide();
	});

	// A press anywhere else is the reader moving on. On `pointerdown` rather than
	// `click`, so the alt-click that opens the next panel closes this one first,
	// and captured, so an app that swallows clicks cannot hold the panel open.
	document.addEventListener(
		"pointerdown",
		(event) => {
			// The composed path, not the target: a press inside the shadow root is
			// retargeted to the host on its way out, and the path says so outright.
			if (!event.composedPath().includes(host)) hide();
		},
		true,
	);

	return shadow;
}

/** How an editor is told where to go. A line of 0 means we only know the file. */
function target(at: Position): string {
	return at.line > 0 ? `${at.file}:${at.line}:${at.column}` : at.file;
}

/**
 * One axis clamped to the viewport.
 *
 * A panel bigger than the viewport pins its near edge instead: losing the tail
 * of a long response body beats losing the header the whole panel is read from.
 *
 * Exported, with `beside`, because this arithmetic is the part that can be
 * wrong and a headless DOM has no layout to catch it through.
 */
export function within(start: number, size: number, view: number): number {
	return Math.max(EDGE, Math.min(start, view - size - EDGE));
}

/** Where a box of `size` starts on one axis so that it sits beside `point`. */
export function beside(point: number, size: number, view: number): number {
	const after = point + GAP;
	// Flip to the near side of the point rather than overflow, which is what
	// keeps a click near the right or the bottom edge readable.
	const start = after + size + EDGE <= view ? after : point - GAP - size;
	return within(start, size, view);
}

/** The box a `position: fixed` panel lives in, scrollbars excluded. */
function viewport(): { width: number; height: number } {
	const root = document.documentElement;
	return { width: root.clientWidth, height: root.clientHeight };
}

function moveTo(panel: HTMLElement, left: number, top: number): void {
	// Whole pixels: a fraction blurs monospace text on a non-retina screen.
	panel.style.left = `${Math.round(left)}px`;
	panel.style.top = `${Math.round(top)}px`;
	// The stylesheet parks the panel in the bottom-right corner. Once it is
	// placed by hand those two have to let go, or the box is over-constrained.
	panel.style.right = "auto";
	panel.style.bottom = "auto";
}

/**
 * Put the panel beside the point that opened it.
 *
 * Measured after appending rather than assumed: `max-height` is a share of the
 * viewport, so the real height depends on how much response body there is.
 */
function placeBeside(panel: HTMLElement, at: Point): void {
	const size = panel.getBoundingClientRect();
	const view = viewport();
	moveTo(
		panel,
		beside(at.x, size.width, view.width),
		beside(at.y, size.height, view.height),
	);
}

/** Pull a placed panel back inside the viewport after it changed size. */
function keepInside(panel: HTMLElement): void {
	const size = panel.getBoundingClientRect();
	const view = viewport();
	moveTo(
		panel,
		within(size.left, size.width, view.width),
		within(size.top, size.height, view.height),
	);
}

/**
 * Drag the panel by its header.
 *
 * Pointer capture, not a listener on the document: the pointer keeps reporting
 * to the header even over an iframe or a canvas, or outside the window, all of
 * which cut a document-level drag off halfway.
 */
function draggable(panel: HTMLElement, head: HTMLElement): void {
	head.addEventListener("pointerdown", (event) => {
		// The buttons in the header are not somewhere to grab the panel by.
		if (
			event.button !== 0 ||
			(event.target as Element | null)?.closest("button")
		)
			return;

		// Held, not accumulated: when the panel stops at an edge and the pointer
		// runs on, this is what lets it pick up exactly where it was let go.
		const start = panel.getBoundingClientRect();
		const holdX = event.clientX - start.left;
		const holdY = event.clientY - start.top;

		const drag = (moved: PointerEvent): void => {
			const size = panel.getBoundingClientRect();
			const view = viewport();
			moveTo(
				panel,
				within(moved.clientX - holdX, size.width, view.width),
				within(moved.clientY - holdY, size.height, view.height),
			);
		};

		const drop = (): void => {
			head.classList.remove("dragging");
			head.removeEventListener("pointermove", drag);
			head.removeEventListener("pointerup", drop);
			head.removeEventListener("pointercancel", drop);
		};

		head.setPointerCapture(event.pointerId);
		head.classList.add("dragging");
		head.addEventListener("pointermove", drag);
		head.addEventListener("pointerup", drop);
		head.addEventListener("pointercancel", drop);
		// Without this the header text starts a selection instead of a drag.
		event.preventDefault();
	});
}

/** The chain as something to paste into a ticket or a chat. */
function asText(provenance: Provenance): string {
	const lines = [`camefrom ${title(provenance.value)}`, ...format(provenance)];
	// The chain says which field; the request line is what the colleague on the
	// other end of the ticket needs to fetch it themselves.
	if (provenance.request) {
		lines.push(
			`request: ${provenance.request.method} ${provenance.request.url}`,
		);
	}
	return lines.join("\n");
}

/** Say the outcome in the button, then go back to being a copy button. */
function says(button: HTMLElement, word: string): void {
	button.textContent = word;
	setTimeout(() => {
		button.textContent = COPY;
	}, 1000);
}

/**
 * Put the chain on the clipboard, and say where it went.
 *
 * `navigator.clipboard` is missing on a plain http origin in Chrome and Safari,
 * and rejects when the document is not focused, so the console keeps a copy
 * either way: a copy button that quietly does nothing is worse than no button.
 */
async function toClipboard(
	provenance: Provenance,
	button: HTMLElement,
): Promise<void> {
	const text = asText(provenance);
	try {
		await navigator.clipboard.writeText(text);
		says(button, "copied");
	} catch (error) {
		console.log(
			`camefrom: no clipboard here (${String(error)}). The chain, to copy by hand:\n${text}`,
		);
		says(button, "see console");
	}
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
/**
 * Why a frame has no line, and — where the reason is one nobody can act on —
 * the stack it was concluded from.
 *
 * Offered rather than asserted: "the engine left no frame for it" is a claim
 * about somebody else's optimiser, and the only way to be sure of it is to read
 * what React actually captured.
 *
 * Under the row it was offered on, rather than in the console: a button that
 * puts its whole answer in another window has, from where the reader is sitting,
 * done nothing at all.
 */
function reasonFor(frame: Frame, into: HTMLElement): HTMLElement {
	const missing = frame.missing;
	if (!missing) return element("span", "why");
	if (!frame.stack) return element("span", "why", MISSING[missing]);

	const stack = element("div", "stack", frame.stack);
	stack.hidden = true;
	into.append(stack);

	const why = element("button", "why link");
	const say = (): void => {
		why.textContent = `${MISSING[missing]} · ${stack.hidden ? "show it" : "hide it"}`;
	};

	why.addEventListener("click", () => {
		stack.hidden = !stack.hidden;
		say();
		// The tree it lands in is only seven rows tall, and a stack revealed
		// below the fold of one is a button that did nothing.
		if (!stack.hidden) stack.scrollIntoView({ block: "nearest" });
	});
	say();
	return why;
}

function treeView(frames: readonly Frame[]): HTMLElement {
	const tree = element("div", "tree");

	frames.forEach((frame, depth) => {
		const row = element("div", frame.target ? "frame on" : "frame");
		row.append(element("span", "name", `${"  ".repeat(depth)}<${frame.name}>`));

		const at = frame.at;
		if (!at) {
			tree.append(row);
			// A row with a name and nothing else reads as the tool having failed.
			// The reason goes on the row, and what it was read off underneath it.
			if (frame.missing) row.append(reasonFor(frame, tree));
			return;
		}

		// A position off a stack points into the module a bundler built, and the
		// line it names in the file somebody wrote is a different one. Mapping it
		// back needs the map, which needs a request, so the row says it is asking.
		const where = element("button", "where", "…");
		row.append(where);
		tree.append(row);

		void written(at).then((original) => {
			// No map, or nothing mapped. The recorded line is a line in a bundle
			// and printing it would name whatever happens to sit there in the
			// file, so the row says that instead of showing it.
			if (!original) {
				where.className = "why";
				where.textContent = MISSING.unmapped;
				return;
			}
			where.textContent =
				original.line > 0 ? `${original.file}:${original.line}` : original.file;
			where.addEventListener("click", () => openInEditor(original));
		});
	});

	// Spelled out under the tree as well as on the row, because this is the one
	// cause a reader can act on, and acting on it brings every line back.
	if (frames.some((frame) => frame.missing === "untracked")) {
		tree.append(element("div", "note", RELOAD));
	}
	return tree;
}

/**
 * One numbered row.
 *
 * Shared by the excerpt and the response body so the two read as one thing: a
 * line the panel is pointing at is numbered and marked the same way whether it
 * came out of a source file or out of JSON.
 */
function lineOf(number: number, text: string, marked: boolean): HTMLElement {
	const row = element("div", marked ? "line on" : "line");
	row.append(
		element("span", "num", String(number)),
		element("span", undefined, text),
	);
	return row;
}

function codeOf(found: Excerpt): HTMLElement {
	const rows = element("div", "rows");

	found.lines.forEach((text, index) => {
		const number = found.first + index;
		rows.append(
			lineOf(
				number,
				text,
				number >= found.target.from && number <= found.target.to,
			),
		);
	});

	// An element too long to show says where it ends instead. Without this the
	// mark reaching the last row is the same picture as an element closing on
	// it, and the excerpt would be passing a cut off as an ending.
	if (found.closes !== undefined) {
		rows.append(element("div", "rest", `…runs on to line ${found.closes}`));
	}

	return rows;
}

function printedOf(source: unknown): PrintedJson {
	// Compared against `undefined` explicitly: `printed?.source === source` also
	// holds when nothing has been printed and the body itself is undefined.
	if (printed !== undefined && printed.source === source) return printed.json;

	const json = print(source);
	printed = { source, json };
	return json;
}

/** Writes the response into `body`, numbered, marked and scrolled to `path`. */
function fillBody(body: HTMLElement, source: unknown, path?: string): void {
	const json = printedOf(source);
	// A line index, as `print` counts them from zero; the number shown is the
	// human one.
	const hit = path === undefined ? undefined : json.lineOfPath.get(path);

	const rows = element("div", "rows");
	json.text.split("\n").forEach((text, index) => {
		rows.append(lineOf(index + 1, text, index === hit));
	});
	body.replaceChildren(rows);

	// After the rows are in the document, or there is nothing yet to scroll.
	if (hit !== undefined) {
		requestAnimationFrame(() => {
			rows.children[hit]?.scrollIntoView({ block: "center" });
		});
	}
}

async function fillCode(
	code: HTMLElement,
	provenance: Provenance,
	mine: number,
): Promise<void> {
	const frame = innermost(provenance.tree);
	if (!frame?.at) return;

	const where = await written(frame.at);
	if (!where || mine !== generation) return;

	const found = await excerptOf(where);
	if (!found || mine !== generation) return;

	// Said out loud, because this is regularly not the frame that was pointed
	// at: an excerpt from a component two frames out, shown as the line that
	// rendered the text, is a wrong answer wearing the face of a right one.
	code.append(
		element("div", "origin", `${where.file}:${where.line} · <${frame.name}>`),
		codeOf(found),
	);
}

/**
 * Show the chain, beside `at` when the caller knows where the click landed.
 *
 * Without a point the panel keeps the stylesheet's corner: better a known place
 * than a guessed one. Each call places the panel afresh, so a panel dragged out
 * of the way stays where it was put only for as long as it is that panel.
 */
export function show(provenance: Provenance, at?: Point): void {
	const root = mount();
	root.querySelector(".panel")?.remove();
	const mine = ++generation;

	const panel = element("div", "panel");

	const head = element("div", "head");
	head.append(element("div", "value", title(provenance.value)));

	const copy = element("button", "act copy", COPY);
	copy.addEventListener("click", () => {
		void toClipboard(provenance, copy);
	});

	const close = element("button", "act close", "✕");
	close.addEventListener("click", hide);
	head.append(copy, close);

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
	// A tree taller than its seven rows opens on the outermost frames — the
	// router and the providers, which is nobody's question. The row that was
	// pointed at is the innermost, and the frames worth reading are around it.
	panel.querySelector(".frame.on")?.scrollIntoView({ block: "nearest" });
	draggable(panel, head);
	if (at) placeBeside(panel, at);

	void fillCode(code, provenance, mine).then(() => {
		// The excerpt arrives after the panel was placed and makes it taller;
		// without this a panel opened low on the page would grow off the bottom.
		if (at && mine === generation) keepInside(panel);
	});
}

export function hide(): void {
	shadow?.querySelector(".panel")?.remove();
}
