---
title: Web Platform Tests
summary: The conformance suites web-compat is measured against, its pass rates, and running them.
---

# Web Platform Tests

The [Web Platform Tests](https://web-platform-tests.org) are the browsers' shared conformance
suite. `packages/web-compat/wpt` in the repository runs suites of them against
`@ng-native/web-compat` in Node, and records which subtests each file passes.

## What is run

The suites, listed in `wpt/pin.mjs`, are:

- The DOM: `dom/nodes`, `dom/events`, `dom/collections` and `dom/traversal`.
- HTML: `html/dom`, `html/editing/the-hidden-attribute`, the `tabindex` part of
  `html/interaction/focus`, and `html/canvas/element`.
- Parsing and serializing: `domparsing`, `html/syntax/parsing`,
  `html/syntax/parsing-html-fragments` and `html/syntax/serializing-html-fragments`.
- CSS: `css/selectors`, `css/cssom` and `css/cssom-view`.
- Events and observers: `uievents`, `resize-observer` and `intersection-observer`.

The tests are fetched at a pinned commit of `web-platform-tests/wpt`, into a cache git ignores.
A file the runner cannot read is skipped and counted with its reason: an XML document, a reference
or print page with no test harness, a crash test, a test that needs a server or input automation
from `testdriver`.

## The recorded pass rates

`wpt/expectations.json` holds the subtests each file passes, and
[`wpt/summary.txt`](https://github.com/ng-native/ng-native/blob/main/packages/web-compat/wpt/summary.txt)
the pass rate of each suite, how each file ended (OK, ERROR or TIMEOUT) and what was skipped and
why. The summary is the measure of where the package stands against each specification.

## Running them

From a checkout of the repository, after `pnpm install`:

```sh
cd packages/web-compat
node wpt/fetch.mjs              # once, and after pin.mjs changes
node wpt/run.mjs --check        # every suite, against expectations.json
node wpt/run.mjs --update       # record what the change passes now
node wpt/run.mjs dom/nodes      # one suite, or any part of a test's path, while working on it
```

`run.mjs` refuses to run from a cache that is not the pinned commit, whole.

`--check` fails on any difference in the subtests a file passes: one that passes fewer, and as
much one that passes more, so a change that makes a test pass records it with `--update` in the
same pull request. How a file ended is recorded but not compared, since a file that passes nothing
lands either side of its time limit from one run to the next.

Continuous integration runs `--check` on the DOM, selector and CSSOM suites when
`packages/web-compat` or the engine's CSS changes. The full run takes over eight minutes, one
process at a time, so a change to the other suites (events, geometry, the observers, canvas,
parsing) runs `node wpt/run.mjs --check` locally before its pull request opens, and records with
`--update` from a full run so `summary.txt` stays whole.
[CONTRIBUTING.md](https://github.com/ng-native/ng-native/blob/main/CONTRIBUTING.md#web-platform-tests)
has the same steps.
