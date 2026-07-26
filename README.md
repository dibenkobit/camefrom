# camefrom

[![CI](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml/badge.svg)](https://github.com/dibenkobit/camefrom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/camefrom)](https://www.npmjs.com/package/camefrom)

**Point at any value in your React app. See exactly where it came from.**

You see `—` where a contractor name should be. Today that means: React DevTools,
find the component, find the prop, walk up to the hook, work out which request
fed it, open the Network tab, expand the JSON, compare by eye. A minute and a
half. Dozens of times a day.

Alt-click it instead:

```
camefrom "ТОО Барыс"
  ← items[37].contractor.name
  ← GET /api/works?status=active · 200 · 143ms
  ← <WorkRow> · src/works.table-columns.tsx:41
  response ▸ { items: [ … ] }
```

The response body is logged as an object, so your console's own inspector
browses it. You do not open the Network tab at all.

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

**Alt-click** any text in the page.

Or from the console, on whatever is selected in the elements panel:

```js
camefrom($0);
```

```ts
interface Provenance {
	value: unknown; // 42, not "42", if that is what the response held
	path?: string; // items[37].contractor.name
	request?: RequestMeta; // method, url, status, duration
	response?: unknown; // the recorded body, ready to inspect
	hops: Hop[]; // the chain, nearest step first
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
reasoning decides which row you clicked: in a table of five hundred identical
statuses the text alone is ambiguous, so the row object React handed the
component breaks the tie, because that object still remembers where in the body
it came from.

## Works with

`fetch`, `XMLHttpRequest` and **axios** — which matters more than it sounds,
because axios resolves its adapters in `xhr, http, fetch` order and so never
touches `fetch` in a browser. It also parses bodies itself, so `JSON.parse` is
watched too.

Any bundler — Vite, Next.js, webpack, Rspack — because the runtime needs no
build step. If a source inspector such as
[TanStack Devtools](https://tanstack.com/devtools) is already in the project,
its `data-tsd-source` attributes are picked up for exact file and line numbers.

## Not yet

- No panel. The console is the whole interface for now.
- Intermediate transforms are not named — the chain jumps from the read to the
  component.
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
