---
title: File routes
summary: Routes made from the files in src/app/pages, named as Analog names them.
---

# File routes

`fileRoutes` from `@ng-native/router` makes an app's routes from its files: each page is a file in
`src/app/pages`, and the file's path there is its URL. The file names are the ones
[Analog](https://analogjs.org) uses, so a page moves between an app routed this way and one routed
by [@ng-native/analog](/packages/analog) without being renamed. Nothing else is installed: the
routes are plain `@angular/router` routes, made by the router package, and go to
`provideNativeRouter` like any others.

## Setting it up

Find the pages with Metro's `require.context`, in a file of their own so a test can replace it:

```ts
// src/app/pages.ts
import type { PageContext } from '@ng-native/router';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp, mode?: 'lazy'): PageContext;
};

export const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');
```

Then give their routes to the router:

```ts
// src/app/app.config.ts
import { withComponentInputBinding } from '@angular/router';
import { fileRoutes, provideNativeRouter } from '@ng-native/router';
import { pages } from './pages.ts';

export const appConfig = {
  providers: [provideNativeRouter(fileRoutes(pages), withComponentInputBinding())],
};
```

Expo's Metro config allows `require.context`. A config that does not start from Expo's turns it
on with `config.transformer.unstable_allowRequireContext = true`. The app's root component holds a
`<native-stack-outlet>`, as with any routes.

`'lazy'` runs each page's code the first time it is navigated to. Metro's dev server and a web
export serve each page as a file of its own; a native release export keeps them all in its one
bundle. A context without `'lazy'` works too, and its pages are routed the same way.

## Pages

A page is a component, exported as its file's default export:

```ts
// src/app/pages/users/[id].page.ts
import { Component, input } from '@angular/core';
import { Text } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';

@Component({
  imports: [NativeHeader, Text],
  template: `
    <native-header title="User" />
    <text>{{ id() }}</text>
  `,
})
export default class UserPage {
  readonly id = input.required<string>();
}
```

| File                     | Route                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `index.page.ts`          | `/`, and in a folder, the folder's own URL                   |
| `about.page.ts`          | `/about`                                                     |
| `users/[id].page.ts`     | `/users/:id`, an input under `withComponentInputBinding()`   |
| `docs/[...slug].page.ts` | Everything under `/docs`, with the rest of the URL as `slug` |
| `(auth)/login.page.ts`   | `/login`: a group is in no URL                               |
| `blog.[slug].page.ts`    | `/blog/:slug`, without a `blog` folder                       |
| `products.page.ts`       | A layout around the pages in `products/`                     |
| `products/index.page.ts` | `/products`, inside that layout                              |
| `[...missing].page.ts`   | Any URL no other page has: a not-found page                  |

At each level a static path is tried first, then a group's layout, then a path with a parameter,
then a catch-all, so `users/new.page.ts` wins over `users/[id].page.ts` for `/users/new`, whatever
order the files are listed in. A catch-all takes `/docs` itself too, with `slug` as `''`, when
there is no `docs/index.page.ts`.

## Layouts

A page beside a folder of the same name is a layout: its template holds the outlet the folder's
pages render in. On native that is a `<native-stack-outlet>`, a stack of its own, or a
`<native-tabs-outlet>` with a `<native-tab>` for each page in the folder:

```ts
// src/app/pages/(tabs).page.ts
import { Component } from '@angular/core';
import { NativeTab, NativeTabsOutlet } from '@ng-native/router';

@Component({
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="" title="Home" sfSymbol="house" />
      <native-tab path="schedule" title="Schedule" sfSymbol="calendar" />
    </native-tabs-outlet>
  `,
})
export default class TabsLayout {}
```

`(tabs)/index.page.ts` is the tab at `path=""`, and `(tabs)/schedule.page.ts` the tab at
`path="schedule"`. A group is in no URL, so the bar is at `/` and its tabs at `/` and `/schedule`;
a `tabs.page.ts` beside a `tabs/` folder puts them at `/tabs` and `/tabs/schedule` instead. See
[Tabs](/packages/router/tabs) for the bar itself.

## routeMeta

A page's `routeMeta` is its route config, as in Analog:

```ts
// src/app/pages/admin.page.ts
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Text } from '@ng-native/components';
import type { RouteMeta } from '@ng-native/router';

const user = signal<string | null>(null);
const signedIn = () => user() !== null || inject(Router).createUrlTree(['/login']);

export const routeMeta: RouteMeta = {
  title: 'Admin',
  canActivate: [signedIn],
  data: { section: 'admin' },
};

@Component({ imports: [Text], template: `<text>Admin</text>` })
export default class AdminPage {}
```

It takes `title` (a string or a resolver), `canActivate`, `canActivateChild`, `canDeactivate`,
`canMatch`, `resolve`, `data`, `providers` and `runGuardsAndResolvers`. What the file's place sets
(`path`, `matcher`, `component`, `children` and the rest) throws if `routeMeta` sets it too.

- **`canMatch`** passes the page over, to the next route that matches: a `false` on
  `secret.page.ts` sends `/secret` on to `[...missing].page.ts`. A lazy page loads to run it.
- **`redirectTo`**, with no default export, makes the page a redirect:
  `export const routeMeta: RouteMeta = { redirectTo: '/about' }`. Its `pathMatch` is `'full'`
  unless it says otherwise. A page that redirects cannot be a layout.
- **`runGuardsAndResolvers`** is `'paramsOrQueryParamsChange'` unless the page says otherwise, as in
  Analog, so a resolver runs again when the query changes.
- **`meta`**, a page's HTML meta tags in Analog, is accepted and left out: there is no document
  head on a device.

The native header does not read the route's title by itself: bind it, as `[title]` on
`<native-header>`.

## Markdown pages

A `.md` file in `src/app/pages` is a page too: `pages/about.md` is at `/about`, and its front
matter `title` is the route's title. Metro reads the front matter and lexes the Markdown as it
bundles (see [Importing .md files](/packages/components/markdown#importing-md-files)), so install
`marked`, and let the context find the files:

```ts
export const pages = require.context('./pages', true, /\.(page\.ts|md)$/, 'lazy');
```

The router draws no Markdown, so the app gives `fileRoutes` the component that does. It reads its
file with `injectMarkdownPage()` and draws the tokens with `<markdown>`:

```ts
// src/app/markdown-page.ts
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScrollView } from '@ng-native/components';
import { Markdown } from '@ng-native/components/markdown';
import { NativeHeader, injectMarkdownPage } from '@ng-native/router';

@Component({
  imports: [Markdown, NativeHeader, ScrollView],
  template: `
    <native-header [title]="title" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <markdown [tokens]="page.tokens" />
    </scroll-view>
  `,
})
export class MarkdownPage {
  protected readonly page = injectMarkdownPage();
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? '';
}
```

```ts
// src/app/app.config.ts
provideNativeRouter(fileRoutes(pages, { markdownPage: MarkdownPage }), withComponentInputBinding());
```

`injectMarkdownPage()` returns `filename` (the path from the pages folder, `about.md`), `slug`,
`attributes`, `content` and `tokens`. `pageRoutes` from [`@ng-native/analog`](/packages/analog)
routes a `.md` page with the same file, so one `markdownPage` component serves both.

## Mistakes it catches

`fileRoutes` throws as the app starts, naming the files, for:

- two files that are the same page: `about.page.ts` and `about.md`, `index.page.ts` and
  `(home)/index.page.ts`, or `[id].page.ts` and `[slug].page.ts` in one folder;
- a name with brackets that is not `[id]`, `[...slug]` or `[[...slug]]`, such as `[id`,
  `[..slug]` or `user-[id]`, and a catch-all with a path after it;
- a `.md` page with no `markdownPage` to draw it, and a file that is not a page at all;
- a page with no default export, and a `routeMeta` that sets `path` or `component`. A lazy page is
  only read as it loads, so for one of those it is the navigation that fails, with the same
  message.

## Testing

Vitest has no `require.context`. Replace the module that calls it with an `import.meta.glob` of
the same files, which `fileRoutes` takes as it is:

```ts
import { render, screen } from '@ng-native/testing';
import { expect, test, vi } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

vi.mock('./pages.ts', () => ({
  pages: import.meta.glob(['./pages/**/*.page.ts', './pages/**/*.md']),
}));

test('opens on the home page', async () => {
  await render(App, appConfig);
  expect(await screen.findByText('Home')).toBeTruthy();
});
```

A glob's keys are read from the first `pages/` in them, so `/src/app/pages/about.page.ts` and
`./pages/about.page.ts` are both `/about`. A glob that loads each file routes its pages lazily, and
an eager one (`{ eager: true }`) routes them as they are. `"types": ["vite/client"]` in the app's
`tsconfig.json`, with `vite` among its dev dependencies, types `import.meta.glob`.

## fileRoutes or @ng-native/analog: which one

Both route the same files, with the same names, to native stacks and tabs.

- **`fileRoutes`** is part of the router: no other package, no Metro plugin, and routes made by
  the router itself, which checks them as the app starts. Start here for an app that is only an
  app.
- **[`@ng-native/analog`](/packages/analog)** routes with `createRoutes` from `@analogjs/router`
  itself, and reads `src/content` with `@analogjs/content`'s API. Use it to share pages and
  content with an Analog web app, or to follow Analog's behaviour exactly as it changes.

A page written for one works in the other. Its `RouteMeta` type comes from the package that
routes it.

## Where it differs from Analog

- **A catch-all's parameter.** `[...slug].page.ts` gives the rest of the URL as `slug`; Analog
  gives it only for `[[...slug]]`, and matches `[...slug]` as `**`. Both match the same URLs.
- **`canMatch` passes a page over.** In Analog a page refused by its `canMatch` leaves an empty
  screen rather than falling through to the next route.
- **`pathMatch` is `'full'` for a redirect** unless the page says otherwise, where Analog leaves it
  to the page and Angular rejects the route without it.
- **Order.** A static path comes before a group's layout, a parameter and a catch-all; Analog sorts
  by name, with layouts after pages.
- **Mistakes throw.** Two files for one URL, or a malformed name, throw at startup instead of one
  of them being used.
- **Markdown pages** are drawn by the app's `markdownPage` component, with `filename` from the
  pages folder and no `toc`.
- **Not on native.** `.page.server.ts` loads, API routes and `meta` tags have nothing to run on in
  an app.
