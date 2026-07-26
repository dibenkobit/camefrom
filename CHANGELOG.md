# Changelog

## [0.2.0](https://github.com/dibenkobit/camefrom/compare/v0.1.0...v0.2.0) (2026-07-26)


### ⚠ BREAKING CHANGES

* **ui:** `Provenance.hops` and the `Hop` type are gone. They were the panel's own formatting kept in the trace layer — `path`, `ambiguous` and `request` carry the same facts, and the strings in `hops` are where the `·` separators lived.
* `import "camefrom"` no longer starts anything on its own. Import `install` and call it.

### Features

* **fiber:** offer the captured stack when it names no frame of your own ([0492abe](https://github.com/dibenkobit/camefrom/commit/0492abe34dd69df0e3dc48919ed5fc0433ad032e))
* **fiber:** show the render tree, with a line for every frame ([0152673](https://github.com/dibenkobit/camefrom/commit/01526732de68c2af24b661f96c9b1a228b940835))
* **hint:** trace under the pointer while alt is held ([1b88c15](https://github.com/dibenkobit/camefrom/commit/1b88c15212e5347de9004e0dfac67c75a40223e8))
* install on request, and leave nothing in production builds ([67b66d6](https://github.com/dibenkobit/camefrom/commit/67b66d649c000a1d7ec835f0433bda703dd88eb5))
* **panel:** close on a press anywhere outside it ([f732048](https://github.com/dibenkobit/camefrom/commit/f732048d0f44dea1c0745fa19e5ca9adcad54e13))
* **panel:** mark the whole element, edge to edge ([5ff934f](https://github.com/dibenkobit/camefrom/commit/5ff934f70997b7c5a510043b0638e17cf8b57f2d))
* **panel:** number the response body, and cap the excerpt above it ([48514c0](https://github.com/dibenkobit/camefrom/commit/48514c01ab2e4e648be69a624a75f3d2ffda0d2a))
* **panel:** open beside the click, drag it, copy the chain ([b6a7f4c](https://github.com/dibenkobit/camefrom/commit/b6a7f4ce7b9a44f7569f70799d0ef9b2b7eac6dd))
* **panel:** show the chain, the source line and the response body ([1e7972b](https://github.com/dibenkobit/camefrom/commit/1e7972b451d4686deaf79e58b636e6ec9b4d412c))
* **trace:** narrow ambiguous matches by what the page shows around them ([28dee9f](https://github.com/dibenkobit/camefrom/commit/28dee9f412cfc4891d588ed057c29300b4b05ecf))
* **ui:** answer with a verdict, and give the evidence room ([844a09a](https://github.com/dibenkobit/camefrom/commit/844a09a699b611e9b60d4a08373d6f37bef7ebaf))


### Bug Fixes

* **fiber:** say why a frame has no line instead of showing nothing ([a87055f](https://github.com/dibenkobit/camefrom/commit/a87055f0aec67c876c7b9e265f6de943754d3ff9))
* **fiber:** step over a dependency's line to reach one you can edit ([1b4eba5](https://github.com/dibenkobit/camefrom/commit/1b4eba5615e3d49c7ab316f35768466016f8ab99))
* never trace the tool's own UI ([4088466](https://github.com/dibenkobit/camefrom/commit/4088466b2e8ccd325c6cd0f7e9905e050207c0f4))
* **panel:** divide the height, instead of the body taking all of it ([be5e2bc](https://github.com/dibenkobit/camefrom/commit/be5e2bc2a2612a27de8a94ae1b8b208cb191522e))
* **panel:** keep a wheel over the panel out of the page behind it ([5380707](https://github.com/dibenkobit/camefrom/commit/5380707d743d40a5b15e0531221251c66a596ba8))
* **panel:** show the captured stack where the button offering it is ([3f47b7c](https://github.com/dibenkobit/camefrom/commit/3f47b7c611dab5a8af86ffc3e203f812cdc698ba))
* **resolve:** tell identical rows apart by the record, not the value ([4329a0b](https://github.com/dibenkobit/camefrom/commit/4329a0bf64f45d65e3ed12e5c0e79d15c97532f5))
* **sourcemap:** map every line back before showing it ([31ab1b6](https://github.com/dibenkobit/camefrom/commit/31ab1b6c98e82d8eb158eade3a6120078488e3ba))
* **stack:** split a frame on its separator, not on the path ([5cc1723](https://github.com/dibenkobit/camefrom/commit/5cc1723ee8956ac20df51718ff7c83cb0dd3fb46))


### Performance Improvements

* **match:** index each body instead of walking it per lookup ([e6dc46f](https://github.com/dibenkobit/camefrom/commit/e6dc46fe819a31a6566aa10bde49a5a04b37c1ca))

## [0.1.0](https://github.com/dibenkobit/camefrom/compare/v0.0.1...v0.1.0) (2026-07-26)


### Features

* answer on alt-click, and pick the row that was clicked ([49f994c](https://github.com/dibenkobit/camefrom/commit/49f994c1b146cce7db2f4722c4b2034eebe3544f))
* **intercept:** capture responses from fetch, XHR and JSON.parse ([5d2b933](https://github.com/dibenkobit/camefrom/commit/5d2b933c7fee6c13374338df825f6c88590ee969))
* **resolve:** join rendered text back to the response field ([daa3102](https://github.com/dibenkobit/camefrom/commit/daa31026a6489f87c933daef32cccb8a2d450240))
* **store:** record responses and index reads by value ([4e7c5a9](https://github.com/dibenkobit/camefrom/commit/4e7c5a937015d276e3175303c9308b3e3345d2c9))
* **taint:** track response paths through a lazy proxy ([c621872](https://github.com/dibenkobit/camefrom/commit/c621872e876c8d3320e6390f25737799280a052d))


### Bug Fixes

* **ci:** configure release-please through its manifest ([3062412](https://github.com/dibenkobit/camefrom/commit/30624124d56096004c859e1ab32a204fa5282725))
* **ci:** tag releases as v0.1.0, not camefrom-v0.1.0 ([7b70d23](https://github.com/dibenkobit/camefrom/commit/7b70d237bb4eaa5dc3bdd69296e8f55a5cb704a9))
* **intercept:** read XHR bodies from the accessor, not the load event ([5227ac7](https://github.com/dibenkobit/camefrom/commit/5227ac7db3893b9b82bddf8881ec2ebbdbd185c6))
