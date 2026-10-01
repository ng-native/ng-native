---
title: Web
summary: Run the same Angular components in a browser through mount - previews, docs, demos.
---

# Web

`@ng-native/web` is a second host for the exact same components your app ships on a phone -
running in a browser instead of on Fabric. Reach for it to preview work without a
simulator, to build documentation and marketing pages that want the real thing rather than a
screenshot, or to share one component codebase between a native app and a web presence. This
documentation site is itself built on it: every interactive example on every page here is a real
component, mounted through `mount` into the page.

It is not a way to ship your native app to the browser as a second platform target. Some things -
covered in [What does not carry over](/packages/web/limits) - simply have no equivalent outside
Fabric, and an app built around them will not run here unchanged.

## Setting up a browser app

A browser app on `@ng-native/web` builds with [Vite](https://vite.dev), and `ngNativeWeb()` from
`@ng-native/web/vite` sets it up: it compiles the app's components, links the `@ng-native/*` packages
as it links any Angular library, and keeps React Native and Expo out of the bundle.

In an empty directory:

```sh
npm init -y
npm pkg set type=module
npm install @angular/core rxjs @ng-native/components @ng-native/web
npm install --save-dev vite typescript
```

`vite.config.ts`:

```ts
import { ngNativeWeb } from '@ng-native/web/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [ngNativeWeb()],
});
```

`ngNativeWeb()` is three things: `@oxc-angular/vite`'s Angular compiler for the app's own
components, the same compiler for the decorated `@ng-native/*` source under `node_modules`, which
`@oxc-angular/vite` leaves alone, and the resolution a browser build needs. `react-native` and
`expo`, which the packages only `require` on a device, resolve to an empty module, in the bundle
and in Vite's dependency pre-bundling alike, including in a workspace that has React Native
installed for its native app. It sets no `build.rolldownOptions.external`, so it combines with a tool that sets
its own, such as Storybook. It takes
`@oxc-angular/vite`'s options and passes them on, over `zoneless: true` and
`emitClassMetadata: false`.

`index.html`, which Vite serves as the page:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts` and `src/app.ts`:

```ts
import { mount } from '@ng-native/web';
import { App } from './app.ts';

mount(document.getElementById('root')!, App);
```

```ts
import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Pressable, Text, View],
  styles: `
    .card {
      margin: 24px;
      padding: 16px;
      gap: 12px;
      border-radius: 12px;
      background-color: rgb(238, 242, 255);
    }
  `,
  template: `
    <view class="card">
      <text>Hello from Angular Native</text>
      <pressable accessibilityRole="button" (press)="increment()">
        <text>Pressed {{ count() }} times</text>
      </pressable>
    </view>
  `,
})
export class App {
  protected readonly count = signal(0);

  protected increment(): void {
    this.count.update((count) => count + 1);
  }
}
```

`npx vite` serves it with live reload, `npx vite build` writes the production build to `dist`, and
`npx vite preview` serves that build.

Vite does not type-check. For `tsc` and an editor, a `tsconfig.json` like this one checks the app
and the packages' source together:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`allowImportingTsExtensions` is required: the packages import their own files as `./x.ts`.

### With Tailwind

`@ng-native/tailwind`'s web preset gives a browser the same variants and utilities a phone gets,
so a class string written for native means the same thing here:

```sh
npm install --save-dev tailwindcss @tailwindcss/vite @ng-native/tailwind
```

Add `tailwindcss()` after `ngNativeWeb()` in `vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import { ngNativeWeb } from '@ng-native/web/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [ngNativeWeb(), tailwindcss()],
});
```

Then a stylesheet, `src/styles.css`, imported from `src/main.ts` with `import './styles.css';`:

```css
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/web.css';
```

A class such as `rounded-lg bg-blue-600 px-4 py-2` on a `<pressable>` then styles it. `mount` puts
`platform-web` on the root, which is what the preset's `web:` variant matches, and keeps `dark` on
it while `ColorScheme` is dark, which is what `dark:` and a theme's `.dark` block match: the
system's `prefers-color-scheme`, or the scheme `inject(ColorScheme).set()` chose over it. An app
that puts `dark` on a view of its own passes `darkClass: false`.
[Variants](/packages/tailwind/variants) covers the rest.

### With Tailwind 3

A Tailwind 3 app builds its web stylesheet with `web-preset.cjs`, the Tailwind 3 counterpart of
`web.css`: `hover:` and `focus-visible:` are the browser's own, the safe area and the hairline come
from the browser, and `font-mono` keeps Tailwind's stack. The device build keeps `preset.cjs`, so
the web build gets a config of its own that takes everything else from the app's:

```sh
npm install --save-dev tailwindcss@3 @ng-native/tailwind
```

```js
// tailwind.web.config.js
module.exports = {
  ...require('./tailwind.config.js'),
  presets: [require('@ng-native/tailwind/web-preset.cjs')],
};
```

An app that lists a preset of its own beside `preset.cjs` lists it here too, in the same order.
Vite runs Tailwind 3 as a PostCSS plugin, from a PostCSS config beside `vite.config.ts`, which
needs nothing more than `ngNativeWeb()`:

```js
// postcss.config.js
module.exports = {
  plugins: { tailwindcss: { config: './tailwind.web.config.js' } },
};
```

`src/styles.css` is the one the device build reads:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

With a `prefix`, the platform and dark variants still match the `platform-web` and `dark` classes
`mount` keeps on the root, so `web:tw-p-2` and `dark:tw-bg-black` work with `darkClass` as they do
on a device.

### The Angular CLI

The Angular CLI's builders do not build `@ng-native/*`. Their compiler checks every host binding
against the browser's DOM schema, and the components bind React Native's props, such as
`accessibilityState` and `trackColorForTrue`, on elements that are not HTML, so the build fails
inside the packages. An Angular web app that hosts [islands](/packages/web/islands) builds with Vite
and `ngNativeWeb()` instead, which compiles an ordinary Angular app, `bootstrapApplication` from
`@angular/platform-browser` and all.

## Mounting

```ts
import { provideRouter } from '@angular/router';
import { mount } from '@ng-native/web';
import { routes } from './app/app.routes.ts';
import { App } from './app/app.ts';

const root = document.getElementById('app-root')!;
mount(root, App, { providers: [provideRouter(routes)] });
```

`mount` is the browser counterpart to `@ng-native/platform`'s `mount()`, over the same
`HostEngine` seam - `@ng-native/components` makes exactly these calls of a renderer and nothing
else, so `BrowserEngine` satisfies the same interface Fabric's `Engine` does, with no cast. The
differences are the whole of what a browser page does not need: a real `Element` instead of a
numeric root tag, the real `document`, and no Fabric UI manager at all.

`mount` also wires `Screen`, `ColorScheme` and `Direction` from `@ng-native/device` to real browser
sources - window resize events, `matchMedia('(prefers-color-scheme: dark)')`, `document.dir` - so a
component that reads `inject(Screen).compact()` or reacts to dark mode behaves the same whether it
is running on a phone or in this browser tab. It also injects `reset.css` into `document.head` on
first use, in Tailwind's `base` layer and first in the head, so that layer comes before any layer
the page declares and every utility wins over it, which closes the gap between Yoga's flex defaults
and a browser's: an unstyled native view starts at `display: flex; flex-direction: column;
align-items: stretch; flex-shrink: 0`, and an unstyled DOM element does not, so a shared class
string would otherwise disagree between the two hosts.

## Inside an app you already have

An existing Angular web app can host Angular Native components in any of its templates with
`<ng-native-island>`, or from code with `mount(element, component, { injector })`. The island joins
the app: it uses the app's services and is checked by its change detection, while rendering
`<view>`, `<text>` and `<pressable>` through this package. The app builds with Vite and
`ngNativeWeb()`, as above. [Islands](/packages/web/islands) covers both, and what an island shares
with the app and what it keeps.

## The other way round

This package also has the web half of the opposite arrangement: an Angular component rendered by a
browser, in a web view inside a native screen. `mountInWebView` (from `@ng-native/web/web-view`) mounts a component in the page
a native web view loaded, and `<dom-component>` from `@ng-native/expo` shows it.
[DOM components](/packages/expo/dom-components) covers both halves.

From here, [Islands](/packages/web/islands) covers placing components in an existing app and
mounting more than one app into one page, and
[What does not carry over](/packages/web/limits) covers the native-only pieces - the router, worklet
animation and gesture handling - that a web build has to route around.
