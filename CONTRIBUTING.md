# Contributing

## Prerequisites

- Node 24 (see `.nvmrc`); the packages require at least the `engines.node` floor in `package.json`,
  `>=22.18`.
- pnpm, pinned by `packageManager` in `package.json` (currently `pnpm@11.28.2`). Enable it with
  `corepack enable` if you do not already have it. npm is not supported in this workspace - the
  packages resolve through pnpm workspace links.

## Getting set up

```sh
pnpm install
```

On Windows, `scripts/setup-windows.ps1` does all of this: it checks for Git and Node and installs
what is missing (with winget, or nvm-windows or fnm when Node is managed by one), enables pnpm
through corepack, clones the repository and runs `pnpm install`. Run it straight from GitHub in a
PowerShell prompt:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/ng-native/ng-native/main/scripts/setup-windows.ps1)))
```

It clones into `$HOME\ng-native` unless given `-Path`; `-Browser` also installs the Chromium the
browser suite needs, and `-Verify` runs `pnpm typecheck` at the end. From a checkout, run
`powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1` to set that checkout up in
place.

Nx sits on top of pnpm workspaces for task running, caching, and module-boundary enforcement, so
run these through the root scripts rather than calling the underlying tools directly:

```sh
pnpm lint          # boundaries and complexity, through Nx so the project graph exists
pnpm typecheck      # every project, against its own tsconfig
pnpm test           # the full seam against a fake Fabric, no simulator
pnpm coverage       # same, with a 95% coverage floor enforced
pnpm format         # prettier --write .
pnpm format:check   # prettier --check ., what CI runs
pnpm affected       # lint, typecheck and test for what a change can have broken
pnpm verify         # that, with the format check, the builds and the release bundle check CI runs
pnpm export         # a release bundle of every example for iOS and Android, one at a time
```

`pnpm verify` is the one to run before opening a pull request: it is every check CI makes of a
change but `pnpm coverage` and the native builds. `pnpm coverage` runs the browser suite too, which
needs Chromium once, and on Linux the system libraries it links:
`pnpm --filter @ng-native/web exec playwright install --with-deps chromium`.

Lint must go through `nx run-many -t lint` (what `pnpm lint` does): `@nx/enforce-module-boundaries`
needs the project graph and silently enforces nothing without it, so running `eslint` bare will not
catch a boundary violation.

Run `pnpm export` after changing the CSS engine, the Metro transform or an example's styles. A
release bundle compiles every component in the app, lazily loaded screens included, so it fails on
any rule the compiler refuses.

A package resolves only what it declares: there is no hoisted root that answers everything, so an
import a package forgot to declare fails here rather than on someone else's machine.
`pnpm-workspace.yaml` pins the React Native native modules with `overrides`, because a native
module has to exist exactly once in a build: a second copy of Reanimated is a second copy of its
native side, and it silently does nothing. The versions are the ones Expo SDK 57 bundles, which
`npx expo install --check` verifies.

A package with React Native among its dependencies declares `@babel/core` 7 as a devDependency,
and one with Nx or Expo declares `typescript`. pnpm installs a peer that a package leaves undeclared
at the newest version anywhere in the workspace, whatever range the peer asks for, so the next
change to the lockfile would move React Native onto the Babel 8 that `@angular/compiler-cli` brings,
and Nx and Expo onto TypeScript 7. An optional peer that pulls one of these in, such as
`@ng-native/metro`'s `@expo/metro-config`, is a devDependency too, since a peer pnpm installs for
it ignores the package's own devDependencies. `workspace-peers.test.ts` checks it.

An optional peer that no package above it depends on, with more than one version in the workspace,
is declared by the project too: `jiti` for Vite in `@ng-native/web`, beside Tailwind 3's `jiti` 1.
pnpm otherwise resolves it to whichever copy it reaches first, and adding a dependency to any
project swaps it, rewriting every lockfile entry above it. `workspace-peers.test.ts` checks this
too. `debug`'s `supports-color` gets a dependency of its own in `pnpm-workspace.yaml` instead,
since nearly every project would otherwise need to declare it.

## Running the app and the docs site

```sh
pnpm --filter canary start     # the canary, in Expo Go or a simulator
pnpm --filter documentation dev  # the documentation site, on http://localhost:5201
```

## Where tests live

- `packages/integration-tests` mounts real components through the adapter onto a fake Fabric, so it
  exercises the whole seam (renderer, CSS engine, router, forms) rather than one package in
  isolation.
- `packages/web` has its own suites: a `node:test` suite in `src/`, and a browser suite under
  Vitest (`pnpm --filter @ng-native/web test:browser`).
- `packages/testing` has tests of its own, for the fake Fabric and the Testing Library layer it
  ships to everyone else.

`packages/nx` and `packages/schematics` carry `*.test.ts` files next to the source they test, and
`packages/web-compat` does too, with the Web Platform Tests below. Every package not named here has
no tests of its own: `packages/integration-tests` covers it.

### Web Platform Tests

`packages/web-compat/wpt` runs suites of the Web Platform Tests (the list is in `pin.mjs`) against
`@ng-native/web-compat`, and keeps what each file passes in `expectations.json`, with a summary of
the pass rates in `summary.txt`. The tests are fetched at a pinned commit into a cache git ignores.

```sh
cd packages/web-compat
node wpt/fetch.mjs              # once, and after pin.mjs changes
node wpt/run.mjs --check        # every suite, against expectations.json
node wpt/run.mjs --update       # record what the change passes now
node wpt/run.mjs dom/nodes      # one suite, or any part of a test's path, while working on it
```

`--check` fails on any difference in the subtests a file passes: one that passes fewer, and one
that passes more, so a change that makes a test pass records it with `--update` in the same pull
request. How a file ended (OK or TIMEOUT) is recorded but not compared, since a file that
passes nothing lands either side of its time limit from one run to the next.

The Web Platform Tests workflow runs `--check` on the DOM, selector, CSSOM, `html/dom` and
`domparsing` suites, in about four minutes on a laptop, when what they run on changes: the package,
`packages/fabric` and `packages/platform`, the layout fixtures in `packages/integration-tests`,
`packages/testing`, the lockfile, or the workflow and its setup (the paths are in
`.github/workflows/wpt.yml`). The full run takes over eight, one process at a time, so a change to
the other suites (events, geometry, the observers, canvas, parsing) runs `node wpt/run.mjs --check`
locally before its pull request opens, and records with `--update` from a full run so `summary.txt`
stays whole.

## CSS engine changes are test-first

The CSS engine does not fail the build on what it cannot express: an unsupported declaration is
dropped with a build warning, and a regression in the engine can drop one with no warning at all.
Write the test that pins down the expected behavior before changing
`packages/fabric`'s or `packages/metro`'s CSS code, and keep coverage high there - that is what
catches a regression this engine would otherwise hide.

Every Tailwind utility is checked too. `tailwind-sweep.test.ts` builds a stylesheet from every
utility Tailwind lists (a spread of the values of a scale, all of a handful), arbitrary values, the
values of an app's own theme (`fixtures/tailwind-sweep-theme.css`), `!`, every variant, the pairs
of utilities that build one value together (found from the CSS: one sets a `--tw-*` property the
other reads, or sets again one the other sets and reads) and a shorthand beside each of its sides,
and holds each case to:

- the build does not throw, and the case either takes effect or is refused with a warning;
- what it commits is a prop React Native declares, with a keyword it takes;
- what it resolves to agrees with what Chrome computes, on iOS and on the web host (the web preset
  and `@ng-native/web`'s reset); and each variant probe agrees again on Android, in dark mode, at
  two more widths and with every state an attribute sets, with the `android:` pairs on Android;
- what a view hands down to a text inside it agrees too;
- its transform comes to the matrix Chrome's does, and its animation paints what Chrome's does at
  points through its first cycle;
- its layout, by Yoga configured as React Native configures it, lands where the web host puts it;
- the module Metro writes holds exactly the sheet checked.

A difference that is a design decision, a known gap or Yoga's own behaviour is listed in the test
with its reason, and the test fails when one stops happening. Two fixtures record what it compares
against:

```sh
cd packages/integration-tests
pnpm tailwind-oracle                                   # Chrome's answers, after a Tailwind upgrade
TAILWIND_SWEEP_UPDATE=1 node --import ./register-linker.mjs --test tailwind-sweep.test.ts
```

Read the diff of the second before committing it: each line is a utility that is refused
differently.

What the sweep reads as props, the canary's Tailwind screen draws.
`examples/canary/.maestro/ios/visual/tailwind.yaml` compares it with a screenshot (`pnpm e2e:ios` in
`examples/canary`, against a release build; `pnpm e2e:ios:record` takes a new one), and the Android
release smoke opens it in CI. `pnpm bench:tailwind` in `packages/integration-tests` times a screen
of Tailwind cards through the engine.

### Layout against Chrome

`packages/layout` holds taffy's layout fixtures with where Chrome puts each box
(`oracle/chrome.json`), and lists for each way of laying them out the fixtures it gets wrong:
`oracle/today.json` for Yoga as React Native configures it, `oracle/strict.json` for Yoga with none
of its legacy errata. Each list is pinned both ways: a fixture that starts to fail is a regression,
and one that starts to pass has to come off the list.

```sh
pnpm nx run @ng-native/layout:test                                    # against the pinned lists
LAYOUT_UPDATE=1 pnpm --filter @ng-native/layout exec node --test "src/**/*.test.ts"   # after a deliberate change
pnpm --filter @ng-native/layout record                                # Chrome's boxes, after a fixture changes
```

`pnpm layout-fuzz` in `packages/integration-tests` lays random cases out in Chrome and through the
engine with React Native's own Yoga (built with `clang++` the first time), compares every box,
shrinks each case that differs and groups them into classes. `--cases`, `--seed` and `--out` set how
many, from where and where the results go; a change to layout is checked against main on the same
seed. It also counts the
properties the compiler refused.

## Writing Markdown

[`docs/README.md`](./docs/README.md) says where a Markdown file goes (`docs/`, the documentation site
or a package README) and what a page needs: front matter, headings, links and code fences.

## Architecture rules

[`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) lists the rules the design depends on (AOT only, zoneless
only, no `@angular/platform-browser` bootstrap, the engine never importing Angular or React Native,
and more). Each one is load-bearing - breaking it does not degrade the architecture, it invalidates
it - so a change that would cross one of these needs a different approach, not an exception.

## Checking distribution locally

Before a change that touches packaging, exports, or the release workflow, verify publishing works
end to end without touching npmjs.com:

```sh
npx verdaccio --config verdaccio.yaml   # a local registry, in one terminal
npm adduser --registry http://localhost:4873   # once: publishing needs a user, any name will do
node scripts/verify-publish.mjs         # publish, generate an app, bundle it
```

It publishes every package and the starter template to that registry, runs
`create-expo-app --template @ng-native/template`, installs from the registry so the packages
find each other **by version** rather than through workspace links, then typechecks and bundles the
result. Nothing reaches npmjs, and the registry has no uplink for `@ng-native/*` so a package
that failed to publish cannot be quietly satisfied by the real one.

See [RELEASING.md](./docs/RELEASING.md) for how an actual release goes out.

## Pull requests

- CI must be green.
- Describe why the change is needed, not just what changed - the diff already says what.
- A change someone using the packages would notice comes with a version plan in
  `.nx/version-plans/` - `npx nx release plan` writes one. The release's `CHANGELOG.md` entry is
  made from them; see [RELEASING.md](./docs/RELEASING.md#describing-changes).
- Commit messages here are sentence-case summaries of the change, often followed by a body
  explaining why (see `git log --oneline -20` for the style); there is no conventional-commits
  prefix convention (`feat:`, `fix:`, and so on) in use.

### Checking a change against main

`node scripts/pr-gate.mjs` runs what a pull request is checked for against `origin/main`, and prints
a report for its description:

- formatting, then lint, typecheck and tests of every project the change can reach;
- the existing tests the change edits or deletes, which the description explains;
- a version plan, where a package's code changed;
- what every canary screen sends native, on main and on the change, and each view and prop that
  differs (`scripts/native-output.mjs`);
- `pnpm bench`, `bench:tailwind` and `bench:screens` in `packages/integration-tests`, run in turn
  on each side. A measure fails where it is more than 3% slower and every round of the change was
  slower than every round of main; one past 3% whose rounds overlap is marked, to be run again with
  more rounds.

`--base <ref>`, `--rounds <n>`, `--limit <percent>` and `--out <file>` change what it compares with
and how, and `--skip-bench` leaves the benchmarks out. It exits 1 where a check failed.

What the native output cannot show is how native draws it. For a change that draws, the
`screens-check` skill (`.claude/skills/screens-check`) opens each screen whose native output changed
on a simulator, in main's bundle and the change's, and compares the two screenshots.

For maintainers cutting a release, see [RELEASING.md](./docs/RELEASING.md).
