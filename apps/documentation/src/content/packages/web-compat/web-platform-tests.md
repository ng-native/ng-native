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
A file the runner cannot read is skipped and counted with its reason, among them an XML document, a
manual test, a reftest, a crash test, a worker-only test, a reference or print page with no test
harness, and a test that needs a server or input automation from `testdriver`.

## The recorded pass rates

`wpt/expectations.json` holds the subtests each file passes, and
[`wpt/summary.txt`](https://github.com/ng-native/ng-native/blob/main/packages/web-compat/wpt/summary.txt)
the pass rate of each suite, how each file ended (OK, ERROR, TIMEOUT or CRASH) and what was
skipped and why. The summary is the measure of where the package stands against each specification.

## Running them

From a checkout of the repository, after `pnpm install`:

```sh
cd packages/web-compat
node wpt/fetch.mjs              # once, and after pin.mjs changes
node wpt/run.mjs --check        # every suite, against expectations.json
node wpt/run.mjs --update       # record what the change passes now
node wpt/run.mjs dom/nodes      # one suite, or any part of a test's path, while working on it
```

`run.mjs` refuses to run without the stamp `fetch.mjs` leaves when a fetch finishes. The stamp names
the pinned commit and the suites asked for, so a cache fetched at another commit or for fewer suites
is refused, as is one without the test harness.

`--check` fails on any difference in the subtests a file passes: a file that passes fewer, one
that was expected and not run, and as much one that passes more, so a change that makes a test pass
records it with `--update` in the same pull request. How a file ended is recorded but not compared,
since a file that passes nothing lands either side of its time limit from one run to the next.

Continuous integration runs `--check` on the DOM, selector, CSSOM, `html/dom` and `domparsing`
suites when `packages/web-compat`, the engine's CSS, the layout the tests are laid out with,
`packages/testing`, the lockfile or the workflow itself changes. The full run takes over eight
minutes, one process at a time, so a change to the other suites (events, geometry, the observers,
canvas, HTML parsing) runs `node wpt/run.mjs --check` locally before its pull request opens, and
records with `--update` from a full run so `summary.txt` stays whole.
[CONTRIBUTING.md](https://github.com/ng-native/ng-native/blob/main/CONTRIBUTING.md#web-platform-tests)
has the same steps.
