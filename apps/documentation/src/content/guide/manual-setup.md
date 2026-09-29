---
title: Adding it to an existing app
summary: Wiring the framework into an Expo app you already have, one file at a time.
---

# Adding it to an existing app

The [Getting started](/guide/getting-started) template is the shorter route, verified end to end
before each release. For manual setup in a blank or existing Expo app, complete every step below.
Each step includes troubleshooting notes.

Angular CLI and Nx generators perform this setup and integrate workspace commands: use
`ng add @ng-native/schematics` ([Angular CLI](/packages/schematics)) or `nx g @ng-native/nx:app`
([Nx](/packages/nx)).

## Start the project

**Create a blank project:**

```sh
npx create-expo-app my-app --template blank-typescript
cd my-app
rm App.tsx
```

**For an existing app:** remove its entry point, `App.tsx` or `index.js`. The `src/main.ts` below
replaces it. Keep the dependencies, native configuration and assets.

For either route, install the framework, configure Metro and write the two app files below.

## Install the framework packages

```sh
npm install @angular/core @angular/common \
  @ng-native/platform @ng-native/fabric \
  @ng-native/components @ng-native/device @ng-native/metro
```

`<safe-area-view>` and `<safe-area-provider>` use `react-native-safe-area-context` native views.
Install it if you use them, as most apps do to clear the notch:

```sh
npx expo install react-native-safe-area-context
```

Expo Go bundles it, hiding a missing installation until a development or release build renders
`Unimplemented component: <RNCSafeAreaView>`.

Add `@ng-native/router`, `@ng-native/expo` and `@ng-native/icons` as needed. Expo modules are
optional peers, so `@ng-native/expo` installs no native code. Install individual modules such as
`expo-haptics` for the capabilities you need.

## Configure Metro

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');

module.exports = withAngularNative(getDefaultConfig(__dirname));
```

`withAngularNative` registers Angular's ahead-of-time transformer, compiles component CSS into
engine sheets, and adds source extensions to invalidate external templates. It installs `ngDevMode`
and `animate.enter`/`animate.leave` polyfills before `@angular/core` loads. Pass `{ workspaceRoot }`
in a monorepo where framework packages sit outside the app's `node_modules`.

Add the package's config plugin to `app.json` as well:

```json
{
  "expo": {
    "plugins": ["@ng-native/metro"]
  }
}
```

An app built with the iOS 27 SDK has to adopt the UIKit scene life cycle or it exits at launch, and
the `AppDelegate.swift` that `expo prebuild` writes does not. The plugin starts React Native from a
scene delegate instead, passing on the links the app is opened with.

## Configure TypeScript

```json
// tsconfig.json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "allowImportingTsExtensions": true
  }
}
```

`allowImportingTsExtensions` is required. These packages ship TypeScript with `.ts` imports so
Metro's Angular compiler processes library and app components together. Without this setting,
`tsc` reports errors for files in `node_modules`.

### Checking templates

`tsc` checks TypeScript only: a template that binds an input a component does not have, such as
`<switch [value]="on">` where the input is `checked`, compiles, bundles and does nothing. Angular's
own compiler checks templates. With `@angular/compiler-cli` installed as a development dependency,
add its options to the same `tsconfig.json` and type-check with `ngc` instead of `tsc`:

```json
{
  "angularCompilerOptions": {
    "strictTemplates": true,
    "typeCheckHostBindings": false,
    "strictDomEventTypes": false
  }
}
```

```sh
ngc -p tsconfig.json --noEmit
```

`typeCheckHostBindings` is off because the components' own host bindings name native props that
Angular's DOM schema does not know. `strictDomEventTypes` is off because a native event such as
`(scroll)` is an element event, not an output, so under the DOM schema its `$event` would be typed as
a DOM `Event`. A view registered by name, such as `registerExpoView('expo-image', 'ExpoImage')`, is
used through a component whose inputs are its props, so the template is checked against them:
`@ng-native/expo` has `ExpoImage` and the `Ui*` SwiftUI components, and a view with none yet gets a
small one of the same shape. Leave `CUSTOM_ELEMENTS_SCHEMA` and `NO_ERRORS_SCHEMA` out: either
turns template checking off for the whole component.

## Write the entry point

```ts
// src/main.ts
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { currentConditions, deviceTokens, watchConditions } from '@ng-native/device';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { App } from './app/app.ts';

registerPlatformComponents(Platform.OS);

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const app = mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    conditions: currentConditions(),
    tokens: deviceTokens(),
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
  });

  watchConditions(app.engine);
});
```

The entry point configures colors, assets and device-dependent styles before rendering:

- **`conditions`** supplies `@media` values. `watchConditions` updates them on rotation or theme
  changes, making `dark:` follow the system.
- **`tokens`** supplies device values such as hairline width. Without it, `1px` produces a thick
  divider instead of a third of a point on a 3x screen.
- **`resolveAssetSource`** converts `require('./x.png')` to a native-loadable asset; without it,
  images stay blank.
- **`processColor`** converts colors to platform integers.

## Write the root component

```ts
// src/app/app.ts
import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

@Component({
  imports: [Pressable, Text, View],
  selector: 'app-root',
  template: `
    <view class="box">
      <text>tapped {{ count() }} times</text>
      <pressable (touchEnd)="bump()"><text>tap me</text></pressable>
    </view>
  `,
  styles: `
    .box {
      flex: 1;
      justify-content: center;
      padding: 24px;
    }
  `,
})
export class App {
  protected readonly count = signal(0);

  protected bump(): void {
    this.count.update((n) => n + 1);
  }
}
```

Import each element's component, for example `imports: [View, Text]`. Missing imports render
plain views and trigger development warnings.

Use lowercase element names. Angular silently compiles uppercase names as unknown components with
empty templates; the Metro transform catches this as a build failure.

Run `npx expo start`, then scan the QR code with Expo Go or press `i` or `a` for a simulator.
Check that each press increments the counter.

## Add Tailwind

Skip Tailwind if you use plain `[style]` objects.

```sh
npm install @ng-native/tailwind tailwindcss @tailwindcss/cli
```

```css
/* src/styles.css */
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/native.css';
```

```js
// metro.config.js
const { withTailwind } = require('@ng-native/tailwind/config.cjs');

module.exports = withTailwind(withAngularNative(getDefaultConfig(__dirname)), {
  input: './src/styles.css',
});
```

```ts
// src/main.ts
import tailwind from '../.angular-native/app.tailwind.js';

// ...and in the mount options, beside processColor:
  globalStyles: tailwind,
```

Expo's transform worker returns empty native modules for `.css` files, so the generated sheet
uses `.js`. `withTailwind` runs and watches the Tailwind CLI, updating the sheet when template
classes change without restarting. Metro generates the sheet and its `.d.ts` in `.angular-native/`
on startup. Start Metro before the first typecheck, and add `.angular-native/` to `.gitignore`
since it is rebuilt on every start.

See [Theming and Tailwind](/guide/theming) for how classes work without a browser.

## The dev loop

Template and style edits hot-swap on the device, preserving component state. Class bodies,
selectors, imports and dependencies require a full reload; the console logs why.

## Where to go next

Continue with [Build a form](/guide/forms), [Working offline](/guide/offline), then
[Deployment](/guide/deployment).
