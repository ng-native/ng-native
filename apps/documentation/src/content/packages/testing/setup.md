---
title: Setup
summary: Vitest or node:test, what the compile step does, and what to do when a test will not load.
---

# Setup

An app generated from the template is set up already: it has `vitest.config.mts`, a `test` script
and an example test, `app.test.ts`, and `npm test` runs it. It is set up for
[tests inside the running app](/packages/testing/in-app-tests) too, with an example,
`app.device.ts`, that `npx vitest --project ios` runs on a simulator. The rest of this page is for
adding the Node tests to an app that does not have them, and for when a test will not load.

## Vitest

Install the package and Vitest as development dependencies:

```sh
npm install --save-dev @ng-native/testing vitest
```

Add `ngNative()` to a `vitest.config.mts` at the root of the app - `.mts` because an Expo app's
`package.json` is not `"type": "module"`, and Vite warns on every run about an ESM config it has to
load as CommonJS. This is the template's Node project, on its own:

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

`ngNative()` takes three options. `inline` is for an Angular library whose `package.json` does not
list `@angular/core` as a dependency or a peer: one that does is processed already (see
[under the hood](#under-the-hood)). Your patterns are added to those and to any
`test.server.deps.inline` list in the config, and `test.server.deps.inline: true` still inlines
every package:

```ts
ngNative({ inline: [/\/node_modules\/@my-org\//] });
```

A library's own stylesheets are compiled in a test as the Metro preset compiles them: every
library's, with nothing to configure. `libraryStyles` is the option the preset takes by the same
name, a list of the only npm packages to compile or `false` for none, beside the `@ng-native/*`
packages', which are always compiled. Give it what the app's Metro config has, so a test draws what
the app draws:

```ts
ngNative({ inline: [/\/node_modules\/@my-org\//], libraryStyles: ['@my-org/ui'] });
```

### `Intl`

Tests remove the `Intl` classes Hermes lacks, so code that builds one throws a `TypeError` in its
test, as it does on a device: `Intl.DisplayNames`, `Intl.DurationFormat`, `Intl.ListFormat`,
`Intl.Locale`, `Intl.PluralRules`, `Intl.RelativeTimeFormat` and `Intl.Segmenter`. Both `ngNative()`
and `@ng-native/testing/register` remove them. An app that polyfills them imports its polyfill in a
Vitest setup file, or after `@ng-native/testing/register` under `node --import`. To keep Node's
full `Intl` in Vitest, pass `intl: 'node'`:

```ts
ngNative({ intl: 'node' });
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

The Vitest plugin and the Node hook compile every `.ts` file with an Angular decorator with the
transform Metro uses, run the Angular linker over partially compiled libraries, and process
`@angular/*`, `@ng-native/*`, `@ng-icons/*` and every package that depends on `@angular/core`
rather than hand them to Node, so there is one copy of `@angular/core`. They install the globals the
Metro preset installs, and leave `ngDevMode` undefined, as in a development build. A module sees
no `require`, as under Node.

An image referenced as `require('./logo.png')` in your own source becomes
`{ testUri: './logo.png' }`, so the component renders and a test can see which image it was given.
A font a stylesheet declares with `@font-face` gets the same stand-in, and is not read. A `.md`
file is imported as Metro imports it, `{ attributes, content, tokens }`; see
[Importing .md files](/packages/components/markdown#importing-md-files).

## Troubleshooting

### "needs to be compiled using the JIT compiler"

```text
Error: The service 'BrowserXhr' needs to be compiled using the JIT compiler, but '@angular/compiler' is not available.
The service is part of a library that has been partially compiled.
However, the Angular Linker has not processed the library such that JIT compilation is used as fallback.
```

A partial-compiled library reached the runtime without being linked. Under Vitest, that means the
package is not one Vitest processes itself, because its `package.json` does not list
`@angular/core`: add it to `ngNative({ inline: [...] })`. An `NG0203` error from a library's
`inject()` call, in a test that does set up an injection context, has the same cause and fix. Under
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
[Gestures](/packages/components/gestures#in-a-test).

It stands in for the animation entry points too: `@ng-native/components/reanimated`,
`react-native-reanimated` and `react-native-worklets`. A shared value is a signal, a
`[workletStyle]` writes what its worklet returns onto its view and again when a value it read
changes, and a `[workletScroll]` runs for each scroll event, so a test reads the style an
animation lands on. Every animation (`withTiming`, `withSpring` and the rest) finishes the moment
it is assigned and calls its callback with `true`, and `scheduleOnRN` calls its function at once.
`@ng-native/components/animations` is stood in for as well: `Animated` and `AnimatedStyle` load, and
`Animated.timing`, `Animated.spring` and `Animated.delay` finish as soon as they start, with the
element's style at the value the animation ends on and the callback called with
`{ finished: true }`. `Animated.sequence` and `Animated.parallel` compose them as they do on a
device, so a test sees where an animation lands, not the frames between.
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
