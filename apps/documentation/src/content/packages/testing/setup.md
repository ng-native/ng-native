---
title: Setup
summary: Vitest or node:test, what the compile step does, and what to do when a test will not load.
---

# Setup

An app generated from the template is set up already: it has `vitest.config.mts`, a `test` script
and an example test, `app.test.ts`, and `npm test` runs it. The rest of this page is for adding the
same to an app that does not have it, and for when a test will not load.

## Vitest

Install the package and Vitest as development dependencies:

```sh
npm install --save-dev @ng-native/testing vitest
```

Add `ngNative()` to a `vitest.config.mts` at the root of the app - `.mts` because an Expo app's
`package.json` is not `"type": "module"`, and Vite warns on every run about an ESM config it has to
load as CommonJS. This is the template's, verbatim:

```ts
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

// Compiles Angular for the tests the way Metro compiles it for the app. Tests run in Node against
// a fake of the native side: no simulator, no device.
export default defineConfig({
  plugins: [ngNative()],
});
```

And a script in `package.json`:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

Vitest's default `include` finds `*.test.ts` and `*.spec.ts` anywhere in the app. The environment
is Vitest's default, `node`. Do not switch it to `jsdom`: there is no DOM to emulate, and giving
Angular a `document` only invites it to reach for one.

`ngNative()` takes two options. `inline` is for an Angular library of your own choosing that
ships partial-compiled (see [under the hood](#under-the-hood)):

```ts
ngNative({ inline: [/\/node_modules\/@my-org\//] });
```

`libraryStyles` is the list the Metro preset takes by the same name: the npm packages whose
components' own stylesheets are compiled. Without it a library's components draw with no styles
in a test, whatever the app's Metro config says:

```ts
ngNative({ inline: [/\/node_modules\/@my-org\//], libraryStyles: ['@my-org/ui'] });
```

## node:test

Node's own runner needs nothing but the package, and a flag that loads its module hook before any
test file:

```sh
npm install --save-dev @ng-native/testing
```

```json
{
  "scripts": {
    "test": "node --import @ng-native/testing/register --test \"**/*.test.ts\""
  }
}
```

The test is written with `node:test` and `node:assert` instead of Vitest's `test` and `expect`,
and everything from `@ng-native/testing` is the same:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Component, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { render, screen, userEvent } from '@ng-native/testing';

@Component({
  selector: 'app-counter',
  imports: [Pressable, Text],
  template: `
    <pressable accessibilityRole="button" (press)="count.set(count() + 1)">
      <text>Count {{ count() }}</text>
    </pressable>
  `,
})
class Counter {
  protected readonly count = signal(0);
}

test('counts a press', async () => {
  await render(Counter);

  await userEvent.press(screen.getByRole('button', { name: 'Count 0' }));

  assert.ok(screen.getByText('Count 1'));
});
```

Node 22.18 or later runs TypeScript test files directly. Node prints an `ExperimentalWarning` for
`stripTypeScriptTypes` once per run; it is Node's type stripping, which the hook calls, and it is
harmless. `node:test` has no global `afterEach`, so add `afterEach(cleanup)` to a file that wants
each test to unmount the one before it.

## Under the hood

Neither Node nor Vite can run an Angular Native component as written, for three separate reasons,
and the Vitest plugin and the Node hook each fix all three the same way:

- **Decorators.** Both runners strip TypeScript types and nothing else, and a decorator is syntax
  neither accepts. Every `.ts` file with an Angular decorator is compiled ahead of time by
  `@ng-native/metro`'s transform first, the one Metro uses for the app bundle. That covers your
  components and a test file that declares one inline.
- **Partial compilation.** `@angular/common`, `@angular/router`, `@angular/forms`, the
  `@ng-native/*` packages and most Angular libraries on npm ship `ɵɵngDeclare*` declarations that
  have to be linked before they can run. The Angular linker runs over every file that has them, as
  it does in Metro.
- **`node_modules`.** Vitest normally hands a dependency straight to Node, which would bypass both
  steps above, so `ngNative()` tells it to process `@angular/*`, `@ng-native/*` and `@ng-icons/*`
  itself. Node refuses to strip types from any `.ts` file under `node_modules`, so the Node hook
  strips them itself for every `.ts` file there, decorated or not.

Both also install the globals the Metro preset installs as polyfills, before `@angular/core` is
first evaluated: the animation globals Angular looks for to decide whether `animate.enter` and
`animate.leave` do anything. `ngDevMode` is left undefined, which Angular reads as development, the
same as a Metro development build. The Vitest plugin also turns off Vitest's `injectCjsGlobals`, and
on Vitest 4, which passes a `require` regardless, shadows it in every ES module it processes,
installed `@ng-native/*` packages included, so a module sees no `require` in Vitest just as it sees
none under Node. The packages read a `require` as the sign they are running in a Metro bundle, and
would otherwise try to load React Native itself.

Without a `require`, an image referenced the React Native way, `require('./logo.png')`, would throw
as its module is evaluated, and a lazily loaded screen that uses one would never appear. The Vitest
plugin and the Node hook both replace each such call in your own source with
`{ testUri: './logo.png' }`, as React Native's Jest preset does, so the component renders and a test
can still see which image it was given.

A font a stylesheet declares with `@font-face { src: url('./brand.ttf') }` is a `require` too, one
the compiler writes, and gets the same stand-in whatever kind of file it names: the component loads,
and the font file is not read.

A `.md` file is imported as Metro imports it, `{ attributes, content, tokens }`, by the same
transform: see [Importing .md files](/packages/components/markdown#importing-md-files). A test sees
the front matter and tokens the bundle has. Under Vitest, an import with a query, such as
`./post.md?raw`, is left to Vite.

## Troubleshooting

### "needs to be compiled using the JIT compiler"

```text
Error: The service 'BrowserXhr' needs to be compiled using the JIT compiler, but '@angular/compiler' is not available.
The service is part of a library that has been partially compiled.
However, the Angular Linker has not processed the library such that JIT compilation is used as fallback.
```

A partial-compiled library reached the runtime without being linked. Under Vitest, that means the
package is not one Vitest processes itself: add it to `ngNative({ inline: [...] })`. Under
`node:test`, it means the hook is not loaded, so check that `--import @ng-native/testing/register`
is in the script and comes before `--test`.

### A syntax error at a decorator

```text
SyntaxError: Invalid or unexpected token
```

with nothing more to go on, from a file that has a `@Component` or `@Injectable` in it, means the
file reached the runtime uncompiled. Under Vitest, `ngNative()` is missing from the `plugins` of
the config Vitest actually loaded; `vitest --config` picks a different file from the default one.
Under `node:test`, the `--import` flag is missing.

### `SyntaxError: Unexpected token 'typeof'` in a component with gestures or animations

A file that imports React Native's own source, which is Flow and which Node cannot parse, fails
to load with a syntax error and no file or line. `ngNative()` stands in for the gesture entry
points, `@ng-native/components/gestures` and `react-native-gesture-handler`, so a component with
a `<gesture-root>` or a `[gesture]` tests as it is; see
[Gestures](/packages/components/gestures#testing-a-component-with-gestures).

It stands in for the animation entry points too: `@ng-native/components/reanimated`,
`react-native-reanimated` and `react-native-worklets`. A shared value is a signal, a
`[workletStyle]` writes what its worklet returns onto its view and again when a value it read
changes, and a `[workletScroll]` runs for each scroll event, so a test reads the style an
animation lands on. Every animation (`withTiming`, `withSpring` and the rest) finishes the moment
it is assigned and calls its callback with `true`, and `scheduleOnRN` calls its function at once.
Another library that reaches React Native source needs a `vi.mock` of its own.

### `NG0201: No provider found for TouchableBase`

```text
NG0201: No provider found for `TouchableBase`.
```

usually beside a run of `NG0912: Component ID generation collision detected` warnings. Two copies
of `@ng-native/components` are loaded, and the directive injecting `TouchableBase` sees the other
copy's class from the one the `<pressable>` is an instance of. One cause is importing a package
by file path rather than by name: a path into a copy of the source other than the installed one,
such as a checkout of this repository beside the app's `node_modules`, loads a second set of
classes beside the installed ones. Import `@ng-native/components` by package name, everywhere.
The other cause is two installed versions, which `npm ls @ng-native/components` shows.

### An assertion runs before the tree has changed

A query returns what was there before the interaction, and the test fails on the old value.
Change detection is zoneless: a signal set or an event handled schedules a pass on a later task,
and the commit happens after that pass. Await everything that changes state: `render()`, every
`fireEvent` and `userEvent` call, `rerender()` and `detectChanges()`. For a change that happens on
a timer or a promise of the app's own, use `await screen.findBy...()` or `waitFor()`, which retry
until the tree catches up.

A node held in a variable is a snapshot of the commit it was found in, and does not change when
the tree does. Query again after an interaction rather than reading `props` off a node found
before it.
