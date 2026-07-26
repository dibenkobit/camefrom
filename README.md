# camefrom

**Point at any value in your UI. See exactly where it came from.**

You see `—` where a contractor name should be. Today that means: React DevTools, find the
component, find the prop, walk up to the hook, work out which request fed it, open the Network
tab, expand the JSON, compare by eye. A minute and a half. Dozens of times a day.

`camefrom` answers it in one keystroke:

```
"ТОО Барыс"
 ← items[3].contractor.name
 ← GET /api/works?status=active   14:02:11
 ← formatContractor()             utils.ts:22
 ← <WorkRow>                      works.table-columns.tsx:41
```

Alt-click any text and you get the chain, the request that produced it, and the response body
right there — no trip to the Network tab.

## Status

Early development. The public API below is in place; the recording engine is being built.
Not published to npm yet.

## Install

```bash
bun add -d camefrom
```

```ts
// main.tsx
import 'camefrom';
```

That is the whole setup. No plugin, no config. The package compiles to a no-op in production
builds via the `development` export condition, so nothing ships to your users.

## Usage

Alt-click any text in the page, or from the console:

```js
camefrom($0);
```

```ts
interface Provenance {
    value: unknown;
    path?: string; // items[3].contractor.name
    request?: RequestMeta;
    response?: unknown;
    hops: Hop[];
    broken: boolean;
}
```

`broken` is part of the contract on purpose. A value that passed through a transform which
created a new primitive cannot be traced further, and `camefrom` says so instead of guessing.
A tool that lies confidently is worse than no tool.

## Why not just use React DevTools?

React DevTools shows you the component tree. The Network tab shows you responses. Neither
connects the two — **data loses its origin the moment it enters React**, and we have all
accepted that as a law of nature. It isn't. In development the browser knows the whole chain;
nobody had wired it together.

## Frequently asked, in the words people search for

- *Where does this value come from in my React app?*
- *Which API response field rendered this text?*
- *How do I trace UI data back to the network request?*
- *Which component and which line rendered this?*

That is what this does.

## Works with

fetch, `XMLHttpRequest` and axios. Any bundler — Vite, Next.js, webpack, Rspack — because the
runtime needs no build integration. On Vite it additionally shows the source line inline and
can open your editor, using the dev server's built-in endpoints.

## License

MIT © Nikita Snetkov
