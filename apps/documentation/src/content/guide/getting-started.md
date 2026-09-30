---
title: Getting started
summary: Create an Expo app, render your first Angular component as native views, and run its test.
---

# Getting started

Angular Native is in alpha. Every effort has gone into making it stable and accurate, but you may
still hit bugs. If you do, please [open an issue](https://github.com/ng-native/ng-native/issues/new/choose).

## Create the app

```sh
npx create-expo-app@latest my-app --template @ng-native/template
cd my-app
npx expo start
```

`create-expo-app` installs the template's framework packages and Angular, with the Metro preset
configured in `metro.config.js`. No manual installation is needed. For an existing Expo app, see
[Adding it to an existing app](/guide/manual-setup).

In an Angular CLI or Nx workspace, add the same app as a project with
`ng add @ng-native/schematics` (see [Angular CLI](/packages/schematics)), or `nx add @ng-native/nx`
then `nx g @ng-native/nx:app apps/mobile` (see [Nx](/packages/nx)).

Scan the QR code with [Expo Go](https://expo.dev/go), or press `i` or `a` for a simulator. The
Angular component renders native views: `<view>` becomes a `UIView` on iOS or an
`android.view.View` on Android, with a press handler and no React in the render path.

Before each release, checks publish every package to a registry, generate a template app with the
command above, install dependencies by version, typecheck, test and bundle it. Any failure blocks
the release.

## Edit `app.ts` and check the counter

Import each element as an Angular component and use lowercase names. The template generates this
`src/app/app.ts`:

```ts
import { Component, signal } from '@angular/core';
import { Pressable, SafeAreaProvider, SafeAreaView, Text, View } from '@ng-native/components';

@Component({
  imports: [Pressable, SafeAreaProvider, SafeAreaView, Text, View],
  selector: 'app-root',
  template: `
    <safe-area-provider>
      <safe-area-view class="screen">
        <view class="body">
          <text class="title">Angular, natively</text>
          <text class="hint">Real native views. React is never in the render path.</text>

          <pressable accessibilityRole="button" class="button" (press)="count.set(count() + 1)">
            <text class="label">Tapped {{ count() }} times</text>
          </pressable>
        </view>
      </safe-area-view>
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
    .screen {
      flex: 1;
      background-color: #101014;
    }
    .body {
      flex: 1;
      justify-content: center;
      gap: 12px;
      padding: 24px;
    }
    .title {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
    }
    .hint {
      color: #8b8b96;
      font-size: 15px;
    }
    .button {
      align-items: center;
      margin-top: 8px;
      padding: 14px;
      border-radius: 10px;
      background-color: #3b6ef5;
    }
    .label {
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
    }
  `,
})
export class App {
  protected readonly count = signal(0);
}
```

Edit the `title` text and save to see it update on the device. Press the button to increment
`count`: its label reads "Tapped 1 times", "Tapped 2 times", and so on.

Use lowercase names such as `<view>` and `<text>`. Angular treats uppercase names as unknown
components and silently emits an empty template; the Metro transform catches this as a build
failure. An element used without its import renders a plain view and logs a development warning.

## Run `app.test.ts`

```sh
npm test
```

`app.test.ts` checks that pressing the button increments the counter. It runs in Node in well under
a second, without a simulator, rendering against a fake native host and querying what native would
receive.

```ts
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';

test('counts taps', async () => {
  await render(App);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Tapped 0 times' }));

  expect(screen.getByText('Tapped 1 times')).toBeTruthy();
});
```

[Testing](/packages/testing) explains what these tests prove and their limits.
[Writing a test](/packages/testing/writing-a-test) covers forms, services and routing.

## Style a control

`<pressable>` handles presses without built-in styling; there is no styled component library to
adopt. Bind Tailwind classes to state after [setting up Tailwind](/packages/tailwind):

```ts
import { Component, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Pressable, Text],
  template: `
    <pressable
      (press)="wifi.set(!wifi())"
      class="h-6 w-10 rounded-full bg-gray-300"
      [class.bg-blue-500]="wifi()"
    >
      <text>Wi-Fi</text>
    </pressable>
  `,
})
export class App {
  protected readonly wifi = signal(true);
}
```

[Theming and Tailwind](/guide/theming) covers what a class string means on a platform with no
browser.

## Update templates and styles

Template and stylesheet edits preserve component state through Angular's `ɵɵreplaceMetadata`,
which the Metro transform embeds in the module. No Angular dev server is involved. Selector, input,
method and import changes require a full reload; the console logs why.

## Expo Go or a development build

`npx expo start` supports both. Expo Go covers most development. For a native module or dependency
patch absent from Expo Go, create a development build with `npx expo run:ios`,
`npx expo run:android` or EAS. For distribution, create a release build. Scanning the `expo start`
QR code opens Expo Go on a physical device; `--dev-client` opens an installed development build.

## Building for release

`npx expo run:ios --configuration Release` and `npx expo run:android --variant release` build
standalone apps. [EAS Build](https://docs.expo.dev/build/introduction/) (`eas build`) builds on
Expo's machines. Follow Expo's instructions for configuration and signing. The Metro preset sets
Angular's production mode, replacing `ngDevMode` with `false` when `__DEV__` is false to remove
dev-mode assertions and performance counters. See [Metro](/packages/metro).

## Where to go next

[Theming and Tailwind](/guide/theming) covers styling,
[Screens and navigation](/packages/router/screens) adds screens, and
[Writing a test](/packages/testing/writing-a-test) extends the template's test.
[Components](/packages/components) lists the available elements.

For manual setup in an existing Expo project, see [Adding it to an existing
app](/guide/manual-setup). Read [Architecture](/guide/architecture) to understand how Angular drives
native views, [Known limitations](/guide/limitations) for alpha gaps, and
[Angular Native compared](/guide/comparison) for comparisons with React Native, NativeScript, Ionic
and Flutter.
