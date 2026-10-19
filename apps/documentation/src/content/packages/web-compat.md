---
title: Web compatibility
summary: DOM members on the engine's nodes, so a component library written for a browser renders.
---

# Web compatibility

`@ng-native/web-compat` is for component libraries written for a browser: Angular Material and
the CDK, Spartan UI, PrimeNG and Optimus UI, and chart libraries that draw with SVG or a canvas.
Such a library reaches for the DOM on the elements it renders: `getAttribute`, `classList`,
`addEventListener`, `querySelector`, `getBoundingClientRect`. This package gives the engine's nodes
those members, each going through the engine's own mutation API, so the library's components
render as native views.

The package is experimental and partial. [Supported API](/packages/web-compat/supported-api)
lists what it has and the gaps it knows of, area by area, and the
[Web Platform Tests](/packages/web-compat/web-platform-tests) measure it against the specifications.
A library uses its own part of the DOM, so whether one works is a question of what that library
calls.

Nothing in an app changes until it adds the provider, and everything the provider adds is taken
away again when the last app that asked for it is destroyed. Components written for native, the
`@ng-native/components` elements and the app's own, stay the native views they are.

## Installing

```sh
npm install @ng-native/web-compat @ng-native/icons
npx expo install react-native-svg
```

| Package                | Needed                 | What it enables                                                                |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `@ng-native/icons`     | Yes, a peer dependency | `<svg>` and `<canvas>`, drawn with the views `@ng-native/icons` draws with     |
| `react-native-svg`     | For anything drawn     | The native views. Without it a drawing shows nothing, as an icon does          |
| `react-native-webview` | Optional, `>=13.16.1`  | An `<iframe>` as a native web view. Without it a frame is an emulated document |
| `expo-document-picker` | Optional, `^57.0.0`    | A file input's `click()` opening the system's file picker                      |

react-native-svg's JavaScript is never imported: the package commits its native views directly,
as `@ng-native/icons` does. An app with an `<iframe>` installs the web view:

```sh
npx expo install react-native-webview
```

## Providing it

`provideWebCompat()` goes in the providers `mount` is given. It gives Angular's `Location` a
platform to stand on in an app with no router. In an app with the native router, `Location` is the
router's, in whichever order the two are listed.

```ts
import { AppRegistry } from 'react-native';
import { mount } from '@ng-native/platform';
import { getFabricUIManager } from '@ng-native/fabric';
import { provideNativeRouter } from '@ng-native/router';
import { provideWebCompat } from '@ng-native/web-compat';
import { routes } from './app/app.routes.ts';
import { App } from './app/app.ts';

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  mount(Number(rootTag), App, getFabricUIManager(), {
    providers: [provideWebCompat(), provideNativeRouter(routes)],
  });
});
```

`provideWebCompat(options)` takes:

| Option      | Default                               | What it sets                                                             |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `url`       | The URL Expo opens the app with       | The page's address, which `document.URL` and `window.location` say       |
| `frames`    | `'webview'`                           | How an `<iframe>` is shown: a native web view, or `'emulated'` documents |
| `loadFrame` | `fetch`, for an `http` or `https` URL | What reads the URL an emulated frame's `src` names                       |

[The page's address and frames](/packages/web-compat/address-and-frames) covers all three.

## The Metro side

A library's stylesheets are read as a browser reads them only for the packages the build is told
about: there, a flex container is a row, as in a browser, where in the rest of the app it is a
column. `withWebCompat` from `@ng-native/web-compat/metro` names them, and wraps the Metro config
last:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withWebCompat } = require('@ng-native/web-compat/metro');

module.exports = withWebCompat(withAngularNative(getDefaultConfig(__dirname)), {
  libraries: ['@angular/cdk', '@angular/material'],
  // Components a library's CLI copies into the app, as Spartan UI's styled layer is.
  sources: ['./src/app/ui'],
});
```

`libraries` are npm packages, and at least one is required. `sources` are directories of the app's
own sources, relative to the project. A library written for native is left out of both, and keeps
its columns. The transformer's cache version changes with both lists, so a file transformed before
a list changed is transformed again.

The same options go to Vitest, as a Vite plugin beside `ngNative()`:

```ts
import { ngNative } from '@ng-native/testing/vitest';
import { webCompat } from '@ng-native/web-compat/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ngNative(), webCompat({ libraries: ['@angular/cdk', '@angular/material'] })],
});
```

## A library that asks whether it is in a browser

Angular's `PLATFORM_ID` is `native` on a device, and some libraries open an overlay or measure only
where it is `browser`. `provideBrowserPlatformId()` gives the component or the route of such a
library's page a browser's id. The rest of the app keeps reading `native`.

```ts
import { Component } from '@angular/core';
import { provideBrowserPlatformId } from '@ng-native/web-compat';

@Component({
  selector: 'app-settings',
  providers: [provideBrowserPlatformId()],
  template: '',
})
export class SettingsPage {}
```

From here, [Supported API](/packages/web-compat/supported-api) lists the DOM this package has,
[The page's address and frames](/packages/web-compat/address-and-frames) covers `location` and
`<iframe>`, and [Web Platform Tests](/packages/web-compat/web-platform-tests) covers the
conformance suite and how to run it.
