---
name: verify-release
description: Check a release of the packages the way a new user meets it - wait for it on npm, then follow every setup route's documentation literally in fresh projects (the Expo template, the manual setup guide, the Angular CLI, Nx in both presets), run the generators and schematics, upgrade projects made on the previous release, run the results on an iOS simulator and an Android emulator, and file what breaks or what the docs get wrong. Also runs before a release against a local registry. Use when a release has just been published, when asked to check a release or the setup guides, or before cutting one.
---

# Verify a release

The question is whether someone setting up a new app today has a bad time. Before release,
`scripts/verify-publish.mjs` (run by `release.yml`, and weekly by `latest.yml`) already installs
each route from a local registry and checks it: the template, `ng add` with `ng generate component`
and `ng run native:typecheck`, `nx add` with the `@ng-native/nx` library, component and Tailwind
generators, and the manual setup guide followed from its code blocks through `expo prebuild`, each
failing on a second copy of `@angular/core`, `react`, `react-native` or `expo`. Start by reading
that job's result for the release. This skill checks what it cannot: **the published packages from
npm, the docs as a person reads them, upgrades from the previous release, and devices.**

Read [AGENTS.md](../../../AGENTS.md) and the device notes in
[fix-issue/devices.md](../fix-issue/devices.md) first. Keep a record as you go: each route, the
versions it resolved, every command, its result, and each deviation from the docs.

## Rules

- **Follow the page, not your memory.** Copy commands and files out of the docs' code blocks
  (`apps/documentation/src/content/**`, or the live site once it has deployed). Anything you have to
  change, add or skip to make a route work is a finding, even if the fix is obvious.
- **A warning is a finding until explained.** Metro warnings, `ERESOLVE`, peer warnings, a second copy
  of a package and a deprecation notice from our code have each been real bugs before.
- **Scratch work lives outside the repo**, in `~/ngn-verify-<version>/`. It reaches several GB.
- **Limits:** one native build at a time, at most one simulator and one emulator. Metro on side ports
  (8130 and up) so another session's 8081 is untouched.
- **Report, don't fix,** unless asked. Fixes go through the `fix-issue` skill afterwards.

## 0. Pick the mode

- **Published** (the default): the release is on npm. Wait for it (step 1).
- **Pre-release:** nothing published yet. Start Verdaccio as in [CONTRIBUTING.md](../../../CONTRIBUTING.md),
  publish with `node scripts/verify-publish.mjs`, and put `registry=http://localhost:4873/` in each
  scratch project's `.npmrc` before installing. Remove the `~/.npmrc` token line and stop Verdaccio
  when done; check it is yours (`lsof -iTCP:4873`) before stopping one already running.

## 1. Wait for the release, and make the upgrade baselines

The version is the one in `packages/platform/package.json` on the release tag, or `npm view
@ng-native/platform version`. Every package without `"private": true` must resolve at exactly that
version (`npm view @ng-native/<name>@<version> version`); `integration-tests` and `layout` are private
and never appear. npm's CDN lags a few minutes per package. Past ten minutes, read the release job's
log before deciding a package is missing.

While waiting, make the **upgrade baselines** on the previous version, so step 4 has something to
upgrade: an Angular CLI workspace with `ng add @ng-native/schematics@<previous>`, an Nx
`--preset=ts` workspace with `nx add @ng-native/nx@<previous>` plus an app and a library, and a
template app pinned to the previous version. Commit each, so the upgrade's diff is readable.

## 2. Record today's versions

`npm view` the latest `create-expo-app`, `expo`, `@angular/cli`, `create-nx-workspace` and `nx`, and
the Expo SDK the packages support (the template's `expo` range). **A new Expo SDK, Angular major or Nx
minor since the last release is the most likely cause of a break**, because `create-expo-app` and
`create-nx-workspace` take the newest. Say so at the top of the report.

## 3. The routes

Scaffold them in parallel in the background (each logging to `<name>.log`), then work through each.
For every route, the **common checks** are:

- its test, typecheck (which runs `ngc`, so templates too) and `expo export --platform all` pass;
- the scaffold's `AGENTS.md` and README commands all run as written;
- one copy each of `@angular/core`, `react`, `react-native`, `expo` and every `expo-*` module
  (`npm ls <name>` or `pnpm why <name>`), all on the SDK the template pins;
- the Metro log has no warning that names one of our packages or a React Native private path;
- the files the docs show (`app.ts`, `main.ts`, configs) match what was generated. The docs show
  them as what the reader gets, so a difference is a docs bug.

| Route                  | Page                       | How                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expo template          | `guide/getting-started.md` | `npx create-expo-app@latest my-app --template @ng-native/template`, then every step on the page in order: the `app.ts` edit, `npm test`, the styling step.                                                                                                                                                                                                               |
| Manual setup           | `guide/manual-setup.md`    | Twice: with the SDK the page pins, and with plain `--template blank-typescript` (today's newest SDK), since readers adding to an existing app have that. Write each file from the page's block for it (the blocks start with a `// path` comment), then add Tailwind as the page says. Run `CI=1 npx expo prebuild --no-install` too: the config plugin only runs there. |
| Angular CLI            | `packages/schematics.md`   | `npx @angular/cli@latest new ng-ws --defaults --skip-git`, `ng add @ng-native/schematics`. Every target in the page's table (`serve`, `build`, `test`, `typecheck`), the web app still builds, and `ng generate component` from both the project and the workspace root writes where the page says.                                                                      |
| Nx, `angular-monorepo` | `packages/nx.md`           | `npx create-nx-workspace@latest nx-ng --preset=angular-monorepo --appName=web --bundler=esbuild --style=css --e2eTestRunner=none --unitTestRunner=vitest --ssr=false --nxCloud=skip --packageManager=pnpm --no-interactive`, then `nx add`, `nx g @ng-native/nx:app`, `:library`, `:component` and `:tailwind` as the page gives them. Every target in its table.        |
| Nx, TypeScript preset  | `packages/nx.md`           | `npx create-nx-workspace@latest nx-ts --preset=ts --nxCloud=skip --packageManager=pnpm --no-interactive`, then the same. Projects get scoped names here (`@org/ui`); the page must say which form to use. A new library's own `typecheck` must pass before any edit.                                                                                                     |

Then the **options** each generator page lists, at least `--linter=eslint` on `ng add` and
`nx g @ng-native/nx:app` (`packages/eslint-plugin.md`): lint passes on the generated app, and fails on
a `<View>` or `(click)` you add.

Then a **small sample app** on the Nx `angular-monorepo` workspace, the way someone would build their
first screen: a library component used by the app, Tailwind in both, a text field, a button that adds
to a list, and a test for it. It finds what a counter does not.

The docs' own component samples are checked by `packages/integration-tests/docs-samples.test.ts` on
every PR. Run it on the release tag only if docs changed a lot this release.

The web host page (`packages/web.md`) and the Storybook recipe are checked by
`verify-publish.mjs --web` and `--storybook`. Look at those jobs' results rather than redoing them,
unless their pages changed this release. Nothing automated follows `packages/analog.md`: when it
or `@ng-native/analog` changed this release, follow its Setup section in the template app and open
a page on the simulator.

## 4. Upgrades

On each baseline from step 1, run the command `guide/updating.md` gives for it
(`npx @ng-native/migrate@latest`, `ng update @ng-native/schematics`,
`nx migrate @ng-native/nx@latest` then `--run-migrations`), then install and run the common checks.
Read the diff: each migration in this release should have changed what its version plan says, and
nothing else. A migration that does not run, or a project that needs a hand edit the page does not
mention, is a finding.

## 5. Devices

Every route that passed step 3 runs on the **iOS simulator** in Expo Go of the SDK it is on (download
it from `https://api.expo.dev/v2/versions/latest`, `data.sdkVersions['<sdk>.0.0'].iosClientUrl`, if
the installed one differs), opened with `xcrun simctl openurl <udid> exp://127.0.0.1:<port>`. Use a
private simulator and idb, as `devices.md` describes. On each:

- it renders with no red box, and the Metro log has no error;
- the interaction the guide describes works (the counter goes up; on the sample, typing a name and
  pressing the button adds it);
- after pressing the counter, editing its template and a stylesheet while Metro runs updates the app
  and keeps the count, as Getting started's "Update templates and styles" promises;
- a screenshot, kept for the report.

Expo Go hides config plugin and native module problems, so also:

- **One development build per platform,** from the template app: `npx expo run:ios`, and
  `npx expo run:android` on an emulator. Android is not optional; a crash at launch on Android only
  has shipped before. Interact as above.
- If the manual route was run on a newer SDK than the template's, a development build of that one
  too, since that is where a config plugin breaks.

## 6. Report and file

Before filing, search for duplicates: `gh issue list -R ng-native/ng-native --state all --search
"<keywords>"`. File each confirmed problem as its own issue with the route, the versions from step 2,
the exact commands, what happened, and what the docs say should happen. Prefix the title with the
package or `docs:`, and label it (`bug`, `documentation`, `pkg: <name>`).

Then report to Ashley: a table of routes (works / works with a deviation / broken, with the issue
numbers), the upgrade results, which devices and platforms each route ran on and which it did not,
and the version drift from step 2. Say plainly what was not checked.

## 7. Clean up

Stop every Metro and `idb_companion` you started, shut down the simulator and emulator, stop your
Verdaccio and remove its `~/.npmrc` line, and delete `~/ngn-verify-<version>`. Say how much disk it
freed. Keep the screenshots in `/tmp` until the report is read.
