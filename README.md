# camefrom

[![CI](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml/badge.svg)](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/camefrom)](https://www.npmjs.com/package/camefrom)

**Point at any value in your React app. See exactly where it came from.**

You see `—` where a contractor name should be. Today that means: React DevTools,
find the component, find the prop, walk up to the hook, work out which request
fed it, open the Network tab, expand the JSON, compare by eye. A minute and a
half. Dozens of times a day.

Hold alt and the answer follows the pointer, a line at a time. Alt-click and a
panel answers in full:

```
┌ "ТОО Барыс"                                    ✕ ┐
│ ← items[37].contractor.name                      │
│ ← GET /api/works?status=active · 200 · 143ms     │
│ ← rendered by                                    │
│     <WorksPage>    src/works.page.tsx:18         │
│       <WorksTable> src/works.tsx:64              │
│         <WorkRow>  src/works.table-columns.tsx:41│
│           <td>     src/works.row.tsx:12          │  ← highlighted
├──────────────────────────────────────────────────┤
│  11   return (                                   │
│  12     <td>{formatContractor(contractor)}</td>  │  ← highlighted
│  13   )                                          │
├──────────────────────────────────────────────────┤
│  "contractor": {                                 │
│     "name": "ТОО Барыс"                          │  ← highlighted, scrolled to
│  }                                               │
└──────────────────────────────────────────────────┘
```

Four things at once: the chain, the whole tree that rendered it, the source
around the line, and the response body scrolled to the exact field. Every frame
of the tree is a link — the answer you want is often not the innermost
component but the column definition two frames out. Escape closes the panel.
The same chain also goes to the console, where the body is logged as a real
object for the inspector to browse.

The Network tab does not come into it.

## Install

```bash
bun add -d camefrom
```

```ts
// main.tsx
import "camefrom";
```

That is the whole setup. No plugin, no config, no wrapper around your fetch
client. In production builds the package resolves to a no-op through the
`development` export condition, so nothing ships to your users.

## Use

**Hold alt** and move the pointer. Whatever is under it is outlined and a single
line says where it came from — enough to read a whole table by moving across it,
which is the thing a click per cell makes unbearable. Let alt go and it is gone.

**Alt-click** for the whole answer. The panel opens beside the click, not in a
corner on top of the next thing you wanted to read. Drag it by its header,
**copy** puts the chain on the clipboard for a ticket, Escape closes it.

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
	request?: RequestMeta; // method, url, status, duration
	response?: unknown; // the recorded body, ready to inspect
	hops: Hop[]; // the chain, nearest step first
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
  ← <InvoiceTotal> · src/invoice.tsx:88
  ✗ not read from any recorded response
```

A tool that answers confidently and wrongly is worse than no tool. The same
reasoning decides which row you clicked. In a table of five hundred identical
statuses the text alone cannot say, so the answer comes from the record React
handed the component: which field of it equals the text, and where that record
sits in the body — placed by the fields it kept, so `{ ...row }`, an immer
draft or a `select` that renamed half of them still lands on the right row.
When even that leaves two candidates, you get both of them, not the first:

```
camefrom "Alpyspayev Bakhtiyar"
  ← 2 fields hold this value
      ? data[0].full_name
      ? data[1].full_name
```

## Works with

`fetch`, `XMLHttpRequest` and **axios** — which matters more than it sounds,
because axios resolves its adapters in `xhr, http, fetch` order and so never
touches `fetch` in a browser. It also parses bodies itself, so `JSON.parse` is
watched too.

Any bundler — Vite, Next.js, webpack, Rspack — because the runtime needs no
build step. The render tree and its file and line numbers come from React
itself: React 19 captures the call site of every element it creates, and
React 16 to 18 carry whatever the Babel transform recorded. No plugin to
install. If a source inspector such as
[TanStack Devtools](https://tanstack.com/devtools) is already in the project,
its `data-tsd-source` attributes fill in anything React left out.

## Not yet

- Intermediate transforms are not named — the chain jumps from the read to the
  component that rendered it.
- A frame can come back without a position. An engine is free to inline a
  function whose whole body is a `return` out of the stack, and React's own
  owner stacks have the same gap. The frame is still listed, without a link.
- The source excerpt needs a dev server that answers `?raw`, which today means
  Vite. Elsewhere the panel simply leaves that part out.
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
