---
title: Analog
summary: Route a native app with Analog's file-based pages, through Analog's own createRoutes.
---

# Analog

`@ng-native/analog` routes an Angular Native app the way [Analog](https://analogjs.org) routes a
web app: each screen is a file in `src/app/pages`, and the file's path is its URL. The routes come
from `createRoutes` in `@analogjs/router` itself, not a copy of it, and go to
`provideNativeRouter` like any other routes, so every page is a screen on a native stack with a
native header.

It is opt-in and separate from the rest of the framework. An app that does not install it routes
with a routes array as before.

## Setup

Install the package, Analog's router, and the native router it routes with:

```sh
npm install @ng-native/analog @analogjs/router @ng-native/router @angular/router
npx expo install react-native-screens
```

`react-native-screens` is the native side of every stack, header and tab bar; the
[Router](/packages/router) page says why a development or release build needs it listed.

Add `withAnalog` to the Metro config, after `withAngularNative`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withAnalog } = require('@ng-native/analog/metro');

module.exports = withAnalog(withAngularNative(getDefaultConfig(__dirname)));
```

It turns on `require.context`, which finds the pages, and resolves `@analogjs/router`'s import of
`@analogjs/content` to an empty module. The router imports that package for Markdown pages only,
but Metro resolves every import as it bundles, so without this no bundle builds where the package
is missing, and where it is installed the bundle carries it and its Markdown parser for nothing. An
import of `@analogjs/content` in the app's own code still resolves to the package.

`@analogjs/content` is a required peer of `@analogjs/router`, so npm and pnpm install it, with
its own required peers (`marked`, `prismjs`, `front-matter` and the `marked` plugins; its image
peers, `sharp` and `satori`, are optional and left out). It takes up space in `node_modules` and
none in the app. To keep it out of `node_modules` too, mark it optional where the package manager
allows. With pnpm, in `pnpm-workspace.yaml`:

```yaml
packageExtensions:
  '@analogjs/router':
    peerDependenciesMeta:
      '@analogjs/content':
        optional: true
```

npm has no equivalent: an optional peer declared elsewhere, `@ng-native/analog` included, does not
stop it installing a dependency's required one, and `overrides` can only swap it for another
package.

Find the pages with `require.context`, in a file of their own so a test can replace it:

```ts
// src/app/pages.ts
import type { PageContext } from '@ng-native/analog';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp, mode: 'lazy'): PageContext;
};

export const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');
```

Then give their routes to the router:

```ts
// src/app/app.config.ts
import { withComponentInputBinding } from '@angular/router';
import { pageRoutes } from '@ng-native/analog';
import { provideNativeRouter } from '@ng-native/router';
import { pages } from './pages.ts';

export const appConfig = {
  providers: [provideNativeRouter(pageRoutes(pages), withComponentInputBinding())],
};
```

`'lazy'` runs each page's code the first time it is navigated to, as Analog loads pages on the
web. Metro's dev server and a web export serve each page as a file of its own; a native release
export keeps them all in its one bundle. The app's root component holds a `<native-stack-outlet>`.

## Pages

A page is a component, exported as the file's default export:

```ts
// src/app/pages/products/[productId].page.ts
import type { RouteMeta } from '@analogjs/router';
import { Component, input } from '@angular/core';
import { Text } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

export const routeMeta: RouteMeta = { title: 'Product' };

@Component({
  imports: [NativeHeader, Text],
  template: `
    <native-header title="Product" />
    <text>{{ productId() }}</text>
  `,
})
export default class ProductPage {
  readonly productId = input.required<string>();
}
```

Analog's conventions work as they do on the web:

| File                           | Route                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `index.page.ts`                | `/`                                                                  |
| `about.page.ts`                | `/about`                                                             |
| `products/[productId].page.ts` | `/products/:productId`, an input under `withComponentInputBinding()` |
| `(account)/profile.page.ts`    | `/profile`: a group is in no URL                                     |
| `products.page.ts`             | A layout around the pages in `products/`                             |
| `[...slug].page.ts`            | A catch-all                                                          |

A layout's template holds the outlet its pages render in. On native that is a
`<native-stack-outlet>`, a stack of its own. A layout presented as a sheet is the usual place for
one: a presented screen has no navigation bar, and the stack inside it gives its pages a header,
and a back button to the page before. On Android react-native-screens draws no stack nested in a
`formSheet`, so present such a layout as a `modal` there, which it does support.

A layout can hold a `<native-tabs-outlet>` instead, with a `<native-tab>` for each page in its
folder: `tabs/index.page.ts` is the tab at `path=""`, `tabs/laps.page.ts` the tab at `path="laps"`.

`routeMeta` is a page's route config, as in Analog: `title`, `canActivate` and the other guards,
`resolve`, `data`, `providers`, and `redirectTo` for a page with no component. A `title` can be a
resolver, read in the page from `ActivatedRoute`:

```ts
import type { RouteMeta } from '@analogjs/router';
import type { ResolveFn } from '@angular/router';

const productTitle: ResolveFn<string> = (route) => route.paramMap.get('productId') ?? 'Product';

export const routeMeta: RouteMeta = { title: productTitle };
```

The native header does not read the route's title by itself: bind it, as `[title]` on
`<native-header>`.

## What does not apply on native

Analog is a full-stack framework, and the parts that run on a server or in a browser have nothing
to run on in an app:

- **Server-side rendering and prerendering.** An app renders on the device.
- **API routes** (`src/server/routes`) and **`.page.server.ts` loads.** There is no server beside
  the app. Fetch from your API with `HttpClient`, through `provideNativeHttpClient()`.
- **Markdown pages and `@analogjs/content`.** `pageRoutes` finds what the `require.context` pattern
  matches, and `/\.page\.ts$/` matches no Markdown.
- **`routeMeta.meta`**, the page's meta tags. There is no document head on a device.
- **`@analogjs/platform` and its Vite plugin.** Metro builds the app, with `@ng-native/metro`'s
  compiler.

## Testing

Vitest has no `require.context`. Replace the module that calls it with an `import.meta.glob` of the
same files, which `pageRoutes` takes as it is:

```ts
import { render, screen } from '@ng-native/testing';
import { expect, test, vi } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

vi.mock('./pages.ts', () => ({ pages: import.meta.glob('./pages/**/*.page.ts') }));

test('opens on the home page', async () => {
  await render(App, appConfig);
  expect(await screen.findByText('Analog Showroom')).toBeTruthy();
});
```

`@analogjs/router` ships partial-compiled code, which the `ngNative()` plugin links only for the
packages it is told about:

```ts
// vitest.config.mts
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ngNative({ inline: [/\/node_modules\/@analogjs\//] })],
});
```

The `examples/analog` app in the repository is a showroom of these features, each page
showing the file that makes it, with a test for each.
