# camefrom

[![CI](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml/badge.svg)](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/camefrom)](https://www.npmjs.com/package/camefrom)

**Point at any value in your React app. See exactly where it came from.**

You see `—` where a contractor name should be. Today that means: React DevTools,
find the component, find the prop, walk up to the hook, work out which request
fed it, open the Network tab, expand the JSON, compare by eye. A minute and a
half. Dozens of times a day.

Hold alt and the answer follows the pointer. Click and it answers in full:

```
┌───────────────────────────────────────────────────────┐
│ Came from the API                        copy ⌄    ×  │
│ "ТОО Барыс"                                           │
├───────────────────────────────────────────────────────┤
│ field    items[37].contractor.name                    │
│ request  GET /api/works?status=active   200   143ms   │
│ source   src/works/works.row.tsx:12   <td>            │
├───────────────────────────────────────────────────────┤
│  Response │ Source │ Tree 4                           │
├───────────────────────────────────────────────────────┤
│   34       "contractor": {                            │
│   35         "name": "ТОО Барыс",                     │ ← marked, scrolled to
│   36         "bin": "990140000155"                    │
│   37       },                                         │
├───────────────────────────────────────────────────────┤
│ esc close   c copy the answer   1–3 panes   o open    │
└───────────────────────────────────────────────────────┘
```

**The first line is the answer.** Not the evidence for it — the answer, in the
words you would use to say whose bug it is. There are four, and only four:
_came from the API_, _built in the app_, _n fields hold this value_, and
_nothing recorded yet_, which is about this tool rather than your value and says
so. Under it, the three facts behind it: which field, which call, which line.

Then the evidence, one pane at a time and each with room to be read — the
response scrolled to the exact field, the source around the line that rendered
it, and the whole tree that got it there. Every file in the tree opens in your
editor, because the answer you want is often not the innermost component but the
column definition two frames out.

The same answer goes to the console, where the body is logged as a real object
for the inspector to browse.

The Network tab does not come into it.

## Install

```bash
bun add -d camefrom
```

```ts
// main.tsx
import { install } from "camefrom";

install();
```

That is the whole setup. No plugin, no config, no wrapper around your fetch
client, and no condition to remember around the call: outside development
`install` is an empty function, so your bundler drops it and everything behind
it. Nothing ships to your users.

Call it before any library that patches `fetch` or `XMLHttpRequest`, or the
responses it reads will not be recorded.

## Use

**Hold alt** and move the pointer. Whatever is under it is outlined, and two
lines say which field it came from and which call brought it — enough to read a
whole table by moving across it, which is the thing a click per cell makes
unbearable. Let alt go and it is gone.

**Or press ⇧⌥C** (`shift+alt+C`) to stay in it. Reading a table takes a minute of
moving, and a minute is a long time to hold a modifier that also opens your
browser's menu bar and is dropped the moment focus goes elsewhere. In the mode
there is nothing to hold: point, and click when you want the panel. A badge says
you are in it and `esc` gets you out — of the mode and the panel at once.

**Click** for the whole answer, beside the click rather than in a corner on top
of the next thing you wanted to read. Drag it by its header. `1`–`4` move between
panes, `o` opens the source in your editor, `esc` closes.

**copy** is a menu of the four things worth copying, each saying which it is: the
whole answer for a ticket, the field path, the request URL, and the call as
`curl`. The `curl` carries the headers your app sent, which is the difference
between a command the person on the other end of the ticket can run and one that
answers 401 — cookies excepted, because a browser attaches those after
JavaScript is finished with the request and never lets it read them back.

Or from the console, on whatever is selected in the elements panel — which
opens the panel beside that element as well as returning the answer:

```js
camefrom($0);
```

```ts
interface Provenance {
	value: unknown; // 42, not "42", if that is what the response held
	path?: string; // items[37].contractor.name — only when it is the only one
	ambiguous?: string[]; // every candidate, when it is not
	request?: RequestMeta; // method, url, status, duration, headers as sent
	response?: unknown; // the recorded body, ready to inspect
	tree: Frame[]; // who rendered it, outermost first, with file and line
	broken: boolean; // honest when the trail runs out
}
```

## It refuses to guess

`broken` is part of the contract. A value that passed through a transform which
built a new string — `${first} ${last}`, `.toFixed(2)`, a `.map()` into fresh
objects — cannot be traced any further, and `camefrom` says so:

```
camefrom "1 250,00 ₸"
Built in the app
None of the 12 responses camefrom recorded holds this text, so something on the
way to the screen made it — a template, a number format, a .map() into new
objects.

rendered by
  <InvoiceTotal>  src/invoice.tsx:88
```

The count is not decoration. A value missing from twelve recorded responses is a
fact about the value; the same value missing from none is a fact about whether
this tool is running at all, and the two read identically until the number is
said out loud. So the second one is a different answer, in the panel and here:

```
camefrom "—"
Nothing recorded yet
camefrom has not seen a single response. If the page already loaded its data,
install() ran too late — it has to come before anything that patches fetch or
XMLHttpRequest.
```

A tool that answers confidently and wrongly is worse than no tool. The same
reasoning decides which row you clicked. In a table of five hundred identical
statuses the text alone cannot say, so the answer comes from the record React
handed the component: which field of it equals the text, and where that record
sits in the body — placed by the fields it kept, so `{ ...row }`, an immer
draft or a `select` that renamed half of them still lands on the right row.

Plenty of tables hand a component no record at all. A cell built inline —
`rows.map(row => <Cell>{value(row)}</Cell>)` — keeps the row in the parent's own
render and passes everything below it a finished string, and then there is
nothing in the props to place. The page answers instead: the rest of what that
row shows came out of the same record, and a name in the cell next door settles
it. A row of nulls that shows nothing of its own is counted off against the rows
around it that can be placed — which reads a table that has been sorted,
filtered, paginated or virtualised just as correctly, because it never assumes
the fifth row on screen is `[4]`.

Every one of those either rules the other candidates out or leaves the list
alone; none of them weighs candidates up. Where two survive, you get both of
them, not the first:

```
camefrom "Alpyspayev Bakhtiyar"
2 fields hold this value
Nothing around the click narrowed it down. Pick one to mark it in the response.

fields   data[0].full_name
         data[1].full_name
```

In the panel they are a list to pick from, and picking one marks it in the
response body — because which of the two it is is a thing you know and this tool
does not.

## Works with

`fetch`, `XMLHttpRequest` and **axios** — which matters more than it sounds,
because axios resolves its adapters in `xhr, http, fetch` order and so never
touches `fetch` in a browser. It also parses bodies itself, so `JSON.parse` is
watched too.

Any bundler — Vite, Next.js, webpack, Rspack — because the runtime needs no
build step. The render tree and its file and line numbers come from React
itself: React 19 captures the call site of every element it creates, and
React 16 to 18 carry whatever the Babel transform recorded. No plugin to
install.

A call site React captured is a position in the module your bundler built, not
in the file you wrote — under a Vite dev server those differ by a couple of
lines near the top of a file and half a dozen further down, which is how a
line number ends up naming a closing brace. Every position is mapped back
through the module's own source map before it is shown, and the excerpt comes
out of that map too, so it no longer takes a dev server that answers `?raw`.
Where there is no map there is no line: the frame is listed without one rather
than with a wrong one. If a source inspector such as
[TanStack Devtools](https://tanstack.com/devtools) is already in the project,
its `data-tsd-source` attributes fill in anything React left out.

## Not yet

- Intermediate transforms are not named. When the answer is _built in the app_,
  it is the line that rendered the value, not the `.map()` or the formatter
  between the response and it.
- **React records the position of the first 10 000 elements only.** The counter
  is never reset, so a page that has been open for a while, or a table that has
  re-rendered a few hundred times, has spent it — and every element made after
  that carries no call site at all. The panel says so and tells you to reload,
  because that is what brings the positions back. Nothing here can fix it from
  outside React.
- A frame can come back without a position for a second reason: an engine is
  free to inline a function whose whole body is a `return` out of the stack, and
  React's own owner stacks have the same gap.
- The excerpt can belong to a frame further out than the one you pointed at,
  when that one has no position. It is headed with the frame it came from, so
  it is never mistaken for the line that rendered the value.
- `XMLHttpRequest` with `responseType: "json"` is invisible: the browser parses
  it internally and never calls `JSON.parse`.

## Frequently asked, in the words people search for

- _Where does this value come from in my React app?_
- _Which API response field rendered this text?_
- _How do I trace UI data back to the network request?_
- _Which component and which line rendered this?_

That is what this does.

## License

MIT © Nikita Snetkov
