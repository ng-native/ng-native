# Threat model

## What this project does and where untrusted input enters

Angular Native renders Angular components as native iOS and Android views on React Native's Fabric
renderer, and as DOM through `@ng-native/web`. It is a framework: the app author's templates, CSS,
build configuration and workspace are trusted. Untrusted input reaches it at run time, inside a
shipped app, through:

- Markdown and HTML text an app renders with the Markdown components (`packages/components/src/markdown*.ts`,
  `html-entities.ts`), including text streamed from a network or a language model.
- HTTP responses through `provideNativeHttpClient()` (`packages/platform/src/http.ts`).
- Deep links and URLs handed to the router (`packages/device`, `packages/router`).
- Content files read by `@ng-native/analog` (`packages/analog/src/content.ts`) when they come from
  outside the app.
- Anything the web host (`packages/web`) writes into the DOM from those sources.

## Components that matter most / least

- Most: the Markdown and HTML handling, the HTTP client, router and deep-link parsing, and the web
  host's DOM writes.
- Less: the CSS engine (`packages/fabric`), which reads the author's own stylesheets. A crash or hang
  from a hostile stylesheet is low unless that stylesheet can come from untrusted input.
- Build time only, trusted input: `packages/metro`, `packages/nx`, `packages/schematics`,
  `packages/migrate`. Report command or path injection from a crafted workspace only where it
  crosses a boundary a developer would not expect (for example a published package's metadata).
- Out of scope: `examples/`, `apps/documentation`, `template/` content beyond what it generates, and
  third-party dependencies unless this project's use of them is the bug.

## How to exercise it

- `pnpm nx run @ng-native/integration-tests:test` renders components against a fake Fabric in Node.
- `pnpm --filter @ng-native/web test` and `pnpm --filter @ng-native/web test:browser` (Chromium) for
  the web host.
- `@ng-native/testing` mounts a component in Node with Testing Library queries; a reproducer is
  easiest written as a test in `packages/integration-tests`.

## How you rate severity

- Critical: script or code execution in a shipped app from untrusted content (for example Markdown
  or a deep link that injects script into the web host, or reaches `eval`).
- High: untrusted content that reads or sends app data it should not, or navigates the router to a
  screen or URL scheme the app did not allow.
- Medium: denial of service from untrusted content (a hang, unbounded memory, or a crash of the app).
- Low: anything that needs the app author's own trusted code, CSS or build configuration to be
  hostile.

## Anything to leave alone

- Development-only paths (hot reload, the dev loading view, Metro's dev server) are not shipped in a
  release bundle.
- Missing native modules are expected: Expo Go, Node tests and the web host run without them.
