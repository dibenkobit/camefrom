---
description: How work is done here, and using Bun instead of Node.js, npm or pnpm.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

# Working principles

**Effort is not an argument against something useful.** Never drop a feature
because it looks like a lot of work, and never dress that decision up as
avoiding overengineering. The test is usefulness, not size: build what is
needed, delete what is speculative. If the cost genuinely changes the plan, say
the cost out loud and let it be decided, rather than quietly scoping it out or
filing it under future work.

**Silence is the worst possible answer.** Anything that can come back empty has
to say so. A tool that stays quiet cannot be told apart from a tool that never
loaded, and the difference is paid for in wasted minutes. This holds for the
work itself too: name what was skipped and why.

**Existing code is not a standard.** Do not carry conventions over from another
project because they are familiar — they may be years out of date. Take the
current defaults of the tool at hand and change only what has a stated reason.

**A claim without evidence does not count.** Measure it, read the source, check
the live version. Never recommend, diagnose or reject from memory. One timing
run or one look inside `node_modules` settles what would otherwise cost
paragraphs of argument — and is just as good at killing an idea early.

**The bar is done well, not it works.** Working is the floor. Naming, comments,
commit history, error messages and defaults are part of the product, not
decoration on top of it.

# Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
