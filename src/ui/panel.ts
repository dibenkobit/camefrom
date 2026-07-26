import { MAX_RESPONSES, recorded } from "../capture/store";
import { innermost } from "../react/fiber";
import type { Frame, Position, Provenance } from "../shared/types";
import { type Excerpt, excerptOf } from "../source/excerpt";
import { type Mapped, written } from "../source/sourcemap";
import { type CopyItem, copy, copyItems } from "./clipboard";
import { highlight } from "./code";
import { type PrintedJson, print } from "./json";
import rules from "./panel.css" with { type: "text" };
import { own } from "./pointer";
import { MISSING, RELOAD, title } from "./report";
import palette from "./tokens.css" with { type: "text" };
import { type Pane, verdictOf } from "./verdict";

/** The shared palette, then the rules that draw with it. */
const STYLE = palette + rules;

/** Candidate fields worth a row of their own before a count says more. */
const MAX_CHOICES = 24;
/** How far the panel keeps clear of the point it was opened at. */
const GAP = 14;
/**
 * How close the panel may come to the edge of the viewport. The same inset the
 * stylesheet parks it at, and the one its `max-width` already reserves.
 */
const EDGE = 16;

const SVG = "http://www.w3.org/2000/svg";
/** Drawn rather than typed — see the note on `.icon`. */
const CROSS = "M4 4l8 8M12 4l-8 8";
const CHEVRON = "M4 6.5l4 4 4-4";

/** A point in viewport coordinates — where the pointer was, in practice. */
export interface Point {
	x: number;
	y: number;
}

/** What both highlighters hand over: a piece of text, and what it is. */
interface Piece {
	kind: string;
	text: string;
}

/** One tab, and the pane behind it. */
interface Section {
	pane: Pane;
	label: string;
	/** Shown beside the label when the number is the useful part. */
	count?: number;
	build: () => HTMLElement;
}

/**
 * What the keyboard can reach in the panel that is on screen.
 *
 * The keys are bound once, on the document, and the panel they act on is
 * whichever one is open — so the handlers are handed over here rather than
 * re-registered per panel.
 */
interface Live {
	select: (index: number) => void;
	copy: () => void;
	edit?: () => void;
}

let shadow: ShadowRoot | undefined;
/** Guards against a slow excerpt landing in a panel that has moved on. */
let generation = 0;
/** The panel shows one body at a time, and printing a large one is not free. */
let printed: { source: unknown; json: PrintedJson } | undefined;
let live: Live | undefined;

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

function icon(path: string): SVGElement {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("class", "icon");
	svg.setAttribute("aria-hidden", "true");

	const drawn = document.createElementNS(SVG, "path");
	drawn.setAttribute("d", path);
	svg.append(drawn);
	return svg;
}

/**
 * Whether a key belongs to whatever the reader is typing in.
 *
 * The panel's single-letter shortcuts are bound to the document, so the one thing
 * they must never do is eat a character out of the app's own search box.
 */
function typing(target: EventTarget | null): boolean {
	const node = target as HTMLElement | null;
	if (!node || typeof node.tagName !== "string") return false;
	if (node.isContentEditable) return true;
	return ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
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

	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") {
				hide();
				return;
			}
			// A shortcut of somebody else's, or a letter meant for a text field.
			if (!live || event.altKey || event.ctrlKey || event.metaKey) return;
			if (typing(event.target)) return;

			const acted = act(event.key);
			if (!acted) return;
			// Only now: an unhandled key belongs to the page, and a panel that
			// swallows every keystroke while it is open is worse than no shortcuts.
			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);

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

/** Runs what a key means, and says whether it meant anything. */
function act(key: string): boolean {
	if (!live) return false;

	if (key === "c") {
		live.copy();
		return true;
	}
	if (key === "o") {
		if (!live.edit) return false;
		live.edit();
		return true;
	}
	if (key >= "1" && key <= "9") {
		live.select(Number(key) - 1);
		return true;
	}
	return false;
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
 * viewport, so the real height depends on how much there is to show.
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

/** Asks the dev server to open an editor. Vite answers; anything else will not. */
function openInEditor(at: Mapped): void {
	const where = target(at);
	void fetch(`/__open-in-editor?file=${encodeURIComponent(where)}`).catch(
		() => {
			console.log(
				`camefrom: could not open ${where}; is this a Vite dev server?`,
			);
		},
	);
}

/** `works.row.tsx:12`, or just the file when no line was recorded. */
function place(at: Mapped): string {
	return at.line > 0 ? `${at.file}:${at.line}` : at.file;
}

/**
 * The source behind the answer: the innermost frame that knows where it is, and
 * where that is in the file somebody wrote.
 *
 * One lookup for both readers of it — the `source` row of the answer and the
 * excerpt in the pane — because it costs a fetch for the module's source map and
 * the two must not disagree about which frame they are describing.
 */
async function sourceOf(
	tree: readonly Frame[],
): Promise<{ frame: Frame; at: Mapped } | undefined> {
	const frame = innermost(tree);
	if (!frame?.at) return undefined;

	const at = await written(frame.at);
	return at && { frame, at };
}

/** Why there is no source to show, in the words the tree rows use. */
function noSource(tree: readonly Frame[]): string {
	if (tree.length === 0)
		return "nothing in this page's React tree rendered it, so there is no line to name";

	const missing = tree.at(-1)?.missing;
	return missing ? MISSING[missing] : "no source map for this module";
}

/** One numbered, optionally marked row of code or JSON. */
function lineOf(number: number, pieces: Piece[], marked: boolean): HTMLElement {
	const row = element("div", marked ? "line on" : "line");
	// The pieces go in one box of their own. The row is a flex line, and a gap
	// wide enough to separate the number from the code would otherwise be pushed
	// in between every coloured piece as well — which is how `"items": [` comes
	// out as `"items"  :  [`.
	const text = element("span", "text");
	for (const piece of pieces) {
		text.append(element("span", `t-${piece.kind}`, piece.text));
	}
	row.append(element("span", "num", String(number)), text);
	return row;
}

function printedOf(source: unknown): PrintedJson {
	// Compared against `undefined` explicitly: `printed?.source === source` also
	// holds when nothing has been printed and the body itself is undefined.
	if (printed !== undefined && printed.source === source) return printed.json;

	const json = print(source);
	printed = { source, json };
	return json;
}

/** The response, numbered, coloured, and marked at `path`. */
function responsePane(source: unknown, path: string | undefined): HTMLElement {
	const json = printedOf(source);
	// A line index, as `print` counts them from zero; the number shown is the
	// human one.
	const hit = path === undefined ? undefined : json.lineOfPath.get(path);

	const rows = element("div", "rows");
	json.lines.forEach((pieces, index) => {
		rows.append(lineOf(index + 1, pieces, index === hit));
	});
	return rows;
}

function excerptPane(found: Excerpt, frame: Frame, at: Mapped): HTMLElement {
	const pane = element("div");

	// Said out loud, because this is regularly not the frame that was pointed at:
	// React stops recording call sites after ten thousand elements, and an excerpt
	// from a component two frames out shown as the line that rendered the text is
	// a wrong answer wearing the face of a right one.
	const origin = element("div", "origin");
	origin.append(
		element("span", "file", place(at)),
		element("span", undefined, ` rendered <${frame.name}>`),
	);

	const rows = element("div", "rows");
	const coloured = highlight(found.lines);
	found.lines.forEach((_, index) => {
		const number = found.first + index;
		rows.append(
			lineOf(
				number,
				coloured[index] ?? [],
				number >= found.target.from && number <= found.target.to,
			),
		);
	});

	// An element too long to show says where it ends instead. Without this the
	// mark reaching the last row is the same picture as an element closing on it,
	// and the excerpt would be passing a cut off as an ending.
	if (found.closes !== undefined) {
		rows.append(element("div", "rest", `…runs on to line ${found.closes}`));
	}

	pane.append(origin, rows);
	return pane;
}

/**
 * Why a frame has no line, and — where the reason is one nobody can act on — the
 * stack it was concluded from.
 *
 * Offered rather than asserted: "the engine left no frame for it" is a claim
 * about somebody else's optimiser, and the only way to be sure of it is to read
 * what React actually captured. Under the row it was offered on, rather than in
 * the console: a button that puts its whole answer in another window has, from
 * where the reader is sitting, done nothing at all.
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
		why.textContent = `${MISSING[missing]} — ${stack.hidden ? "show it" : "hide it"}`;
	};

	why.addEventListener("click", () => {
		stack.hidden = !stack.hidden;
		say();
		if (!stack.hidden) stack.scrollIntoView({ block: "nearest" });
	});
	say();
	return why;
}

/**
 * Who rendered it, outermost first.
 *
 * Every frame is a link: the answer to "where did this come from" is usually not
 * the innermost component but the column or the mapper two frames out, and that
 * is only useful if it opens.
 */
function treePane(frames: readonly Frame[]): HTMLElement {
	const tree = element("div", "rows");

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
			// No map, or nothing mapped. The recorded line is a line in a bundle and
			// printing it would name whatever happens to sit there in the file, so
			// the row says that instead of showing it.
			if (!original) {
				where.className = "why";
				where.textContent = MISSING.unmapped;
				return;
			}
			where.textContent = place(original);
			where.addEventListener("click", () => openInEditor(original));
		});
	});

	// Spelled out under the tree as well as on the row, because this is the one
	// cause a reader can act on, and acting on it brings every line back.
	if (frames.some((frame) => frame.missing === "untracked")) {
		tree.append(element("div", "reload", RELOAD));
	}
	return tree;
}

/**
 * The candidates, when the field could not be narrowed to one.
 *
 * Listed rather than resolved, and each one selectable, because the developer
 * looking at the row knows which of them it is and the tool does not.
 */
function choicesPane(
	paths: readonly string[],
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

	// Never trailing off silently: a truncated list that looks complete is how a
	// developer concludes there were only twenty-four.
	if (paths.length > shown.length) {
		choices.append(
			element("div", "empty", `…and ${paths.length - shown.length} more`),
		);
	}
	return choices;
}

/** Nothing to show, why, and what would change it. */
function emptyPane(says: string, fix?: string): HTMLElement {
	const empty = element("div", "empty", says);
	if (fix) empty.append(element("span", "fix", fix));
	return empty;
}

/**
 * The status, and how much of a problem it is.
 *
 * A 500 beside the field it produced answers the question before the reader has
 * to ask it, and `200` in the same grey as everything else is a character nobody
 * reads. A status of 0 is XHR that never got one — a request that failed outright,
 * which is worth saying rather than printing as a number.
 */
function statusOf(status: number): { text: string; className: string } {
	const tone =
		status === 0 || (status >= 300 && status < 400)
			? ""
			: status < 300
				? " good"
				: status < 500
					? " warn"
					: " bad";
	return {
		text: status === 0 ? "no status" : String(status),
		className: `status${tone}`,
	};
}

/** One labelled row of the answer. Returns the box the value goes in. */
function factRow(
	into: HTMLElement,
	label: string,
	absent = false,
): HTMLElement {
	const data = element("div", absent ? "data absent" : "data");
	into.append(element("div", "label", label), data);
	return data;
}

/** The copy menu: four things somebody actually wants, each saying which it is. */
function menuOf(
	items: readonly CopyItem[],
	said: (word: string) => void,
): HTMLElement {
	const menu = element("div", "menu");
	menu.hidden = true;
	menu.setAttribute("role", "menu");

	for (const item of items) {
		const entry = element("button", "item");
		entry.setAttribute("role", "menuitem");
		entry.append(element("span", "what", item.label));
		if (item.note) entry.append(element("span", "note", item.note));

		if (item.text === undefined) {
			entry.disabled = true;
		} else {
			const text = item.text;
			entry.addEventListener("click", () => {
				void copy(text).then((how) => {
					said(how === "copied" ? "copied" : "see console");
					menu.hidden = true;
				});
			});
		}
		menu.append(entry);
	}
	return menu;
}

/**
 * Show the answer, beside `at` when the caller knows where the click landed.
 *
 * Without a point the panel keeps the stylesheet's corner: better a known place
 * than a guessed one. Each call places the panel afresh, so a panel dragged out
 * of the way stays where it was put only for as long as it is that panel.
 */
export function show(provenance: Provenance, at?: Point): void {
	const root = mount();
	root.querySelector(".panel")?.remove();
	const mine = ++generation;

	const verdict = verdictOf(provenance, {
		count: recorded().length,
		limit: MAX_RESPONSES,
	});
	const panel = element("div", "panel");
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", `camefrom ${title(provenance.value)}`);

	// The headline, and the value it is about.
	const head = element("div", "head");
	const said = element("div", "said");
	said.append(
		element("div", `verdict ${verdict.answer}`, verdict.says),
		element("div", "value", title(provenance.value)),
	);

	const copyButton = element("button", "act copy");
	copyButton.append(document.createTextNode("copy"), icon(CHEVRON));
	copyButton.setAttribute("aria-expanded", "false");

	const close = element("button", "act close");
	close.setAttribute("aria-label", "Close");
	close.title = "Close (esc)";
	close.append(icon(CROSS));
	close.addEventListener("click", hide);

	const acts = element("div", "acts");
	acts.append(copyButton, close);
	head.append(said, acts);
	panel.append(head);

	if (verdict.advice) {
		panel.append(
			element(
				"div",
				verdict.answer === "quiet" ? "advice quiet" : "advice",
				verdict.advice,
			),
		);
	}

	const items = copyItems(provenance, verdict);
	const menu = menuOf(items, (word) => {
		copyButton.replaceChildren(document.createTextNode(word), icon(CHEVRON));
		setTimeout(() => {
			copyButton.replaceChildren(
				document.createTextNode("copy"),
				icon(CHEVRON),
			);
		}, 1200);
	});
	copyButton.addEventListener("click", () => {
		menu.hidden = !menu.hidden;
		copyButton.setAttribute("aria-expanded", String(!menu.hidden));
		// The menu opens downward and pushes the panes along, so a panel already
		// near the bottom edge has to come back up.
		if (at) keepInside(panel);
	});
	panel.append(menu);

	// The answer, in three rows at most: which field, which call, which line.
	const facts = element("div", "facts");
	panel.append(facts);

	const sections: Section[] = [];
	const panes = new Map<Pane, HTMLElement>();
	const pane = element("div", "pane");
	pane.setAttribute("role", "tabpanel");
	const tabs = element("div", "tabs");
	tabs.setAttribute("role", "tablist");

	const body = provenance.response;
	/** Which field the response pane is marked at; a choice changes it. */
	let marked = provenance.path;
	/** Which pane is on screen, so a late arrival knows whether to redraw it. */
	let current: Pane | undefined;

	/**
	 * Show a pane, building it the first time it is asked for.
	 *
	 * Lazily, because printing a ten-thousand-line response body is the most
	 * expensive thing the panel does and the reader may never open that tab.
	 */
	const select = (name: Pane): void => {
		// A verdict can prefer a pane this answer does not have — `response` with
		// nothing recorded behind it. Whatever is first is better than a blank box
		// and no tab selected.
		const found =
			sections.find((section) => section.pane === name) ?? sections[0];
		if (!found) return;
		current = found.pane;

		for (const tab of Array.from(tabs.children)) {
			tab.setAttribute(
				"aria-selected",
				String(tab.getAttribute("data-pane") === current),
			);
		}

		let content = panes.get(current);
		if (!content) {
			content = found.build();
			panes.set(current, content);
		}
		pane.replaceChildren(content);
		// The row the answer points at, brought to the middle rather than left for
		// the reader to find in ten thousand lines.
		pane.querySelector(".line.on, .frame.on")?.scrollIntoView({
			block: current === "tree" ? "nearest" : "center",
		});
	};

	/** Put a rebuilt pane on screen, but only if that is the one being read. */
	const replace = (name: Pane, content: HTMLElement): void => {
		panes.set(name, content);
		if (current === name) select(name);
	};

	if (body !== undefined) {
		sections.push({
			pane: "response",
			label: "Response",
			build: () => responsePane(body, marked),
		});
	}
	sections.push({
		pane: "source",
		label: "Source",
		// Replaced once the map answers; until then it says it is asking.
		build: () => emptyPane("Looking for the line that rendered it…"),
	});
	if (provenance.tree.length > 0) {
		sections.push({
			pane: "tree",
			label: "Tree",
			count: provenance.tree.length,
			build: () => treePane(provenance.tree),
		});
	}
	const candidates = provenance.ambiguous;
	if (candidates) {
		sections.push({
			pane: "choices",
			label: "Candidates",
			count: candidates.length,
			build: () =>
				choicesPane(candidates, (path) => {
					marked = path;
					// Marked where it can be seen: a choice that silently re-renders a
					// pane the reader is not looking at is a click that did nothing.
					panes.delete("response");
					if (body !== undefined) select("response");
				}),
		});
	}

	sections.forEach((section, index) => {
		const tab = element("button", "tab");
		tab.setAttribute("role", "tab");
		tab.setAttribute("data-pane", section.pane);
		tab.title = `${section.label} (${index + 1})`;
		tab.append(document.createTextNode(section.label));
		if (section.count !== undefined) {
			tab.append(element("span", "count", String(section.count)));
		}
		tab.addEventListener("click", () => select(section.pane));
		tabs.append(tab);
	});
	panel.append(tabs, pane);

	// What the panel can do, said where it is being done. A tool nobody can use
	// without the README is a tool with one user.
	const foot = element("div", "foot");
	const hint = (key: string, what: string): HTMLElement => {
		const row = element("div");
		row.append(
			element("kbd", undefined, key),
			document.createTextNode(` ${what}`),
		);
		return row;
	};
	foot.append(
		hint("esc", "close"),
		hint("c", "copy the answer"),
		hint(sections.length > 1 ? `1–${sections.length}` : "1", "panes"),
	);
	panel.append(foot);

	root.append(panel);
	draggable(panel, head);

	// Which field, listed only when there is one to list: a count of candidates is
	// already the headline, and repeating it here would be the panel saying the
	// same thing twice before it says anything new.
	if (provenance.path !== undefined) {
		const data = factRow(facts, "field");
		if (body === undefined) {
			data.append(element("span", undefined, provenance.path));
		} else {
			const jump = element("button", "where", provenance.path);
			jump.title = "Show it in the response";
			jump.addEventListener("click", () => select("response"));
			data.append(jump);
		}
	}

	const request = provenance.request;
	if (request) {
		const data = factRow(facts, "request");
		const status = statusOf(request.status);
		data.append(
			element("span", undefined, `${request.method} ${request.url}`),
			element("span", status.className, status.text),
			element("span", "took", `${request.durationMs}ms`),
		);
	}

	const source = factRow(facts, "source");
	source.append(element("span", undefined, "…"));

	live = {
		select: (index) => {
			const section = sections[index];
			if (section) select(section.pane);
		},
		copy: () => {
			const answer = items[0];
			if (answer?.text) void copy(answer.text);
		},
	};

	select(verdict.opens);
	if (at) placeBeside(panel, at);

	// The line is two requests away — the module's source map, then the file it
	// names — so the row and the pane both start by saying they are asking, and
	// are written into once there is an answer or a reason there is none.
	void sourceOf(provenance.tree).then(async (found) => {
		if (mine !== generation) return;

		if (!found) {
			const why = noSource(provenance.tree);
			source.className = "data absent";
			source.replaceChildren(element("span", undefined, why));
			replace(
				"source",
				emptyPane(
					why,
					provenance.tree.some((frame) => frame.missing === "untracked")
						? RELOAD
						: undefined,
				),
			);
			return;
		}

		// The line, as a link to the editor, and the component it belongs to.
		const open = element("button", "where", place(found.at));
		open.title = "Open in your editor (o)";
		open.addEventListener("click", () => openInEditor(found.at));
		source.replaceChildren(
			open,
			element("span", "took", `<${found.frame.name}>`),
		);
		if (live) live.edit = () => openInEditor(found.at);
		foot.append(hint("o", "open the source"));

		const excerpt = await excerptOf(found.at);
		if (mine !== generation) return;

		replace(
			"source",
			excerpt
				? excerptPane(excerpt, found.frame, found.at)
				: emptyPane(
						`Found the line — ${place(found.at)} — but not the file it is in.`,
						"The module's source map carried no content, and nothing answered for the file itself.",
					),
		);
		// The excerpt can make the panel taller than the placement assumed.
		if (at) keepInside(panel);
	});
}

export function hide(): void {
	live = undefined;
	shadow?.querySelector(".panel")?.remove();
}
