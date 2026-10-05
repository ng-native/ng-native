---
title: Analog
summary: Use Analog's file-based pages and Markdown content in a native app, through createRoutes.
---

# Analog

`@ng-native/analog` routes an Angular Native app the way [Analog](https://analogjs.org) routes a
web app: each screen is a file in `src/app/pages`, and the file's path is its URL. The routes come
from `createRoutes` in `@analogjs/router` itself, not a copy of it, and go to
`provideNativeRouter` like any other routes, so every page is a screen on a native stack with a
native header.

It is opt-in and separate from the rest of the framework. An app that does not install it routes
with a routes array as before, or with [file routes](/packages/router/file-routes) from the router
itself.

## @ng-native/analog or fileRoutes: which one

Both route the same files, with the same names, to native stacks and tabs.

- **`@ng-native/analog`** routes with `createRoutes` from `@analogjs/router` itself, and reads
  `src/content` with `@analogjs/content`'s API. Use it to share pages and content with an Analog
  web app, or to follow Analog's behaviour exactly as it changes.
- **[`fileRoutes`](/packages/router/file-routes)** from `@ng-native/router` needs no other package
  and no Metro plugin, and checks the files as the app starts. Start there for an app that is only
  an app.

A page written for one works in the other. Its `RouteMeta` type comes from the package that
routes it. [Where it differs from Analog](/packages/router/file-routes#where-it-differs-from-analog)
lists what `fileRoutes` does differently.

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
import of `@analogjs/content` in the app's own code still resolves to the package, and fails the
build, naming the package, when it is not installed.

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

## Markdown pages

A `.md` file in `src/app/pages` is a page, as in Analog: `pages/colophon.md` is at `/colophon`, its
front matter `title` is the route's title and its `meta` is the page's `routeMeta.meta`. Metro reads
the front matter and lexes the Markdown as it bundles (see
[Importing .md files](/packages/components/markdown#importing-md-files)), so install `marked`:

```sh
npx expo install marked
```

Let the `require.context` find the `.md` files too:

```ts
export const pages = require.context('./pages', true, /\.(page\.ts|md)$/, 'lazy');
```

Analog draws a Markdown page with `@analogjs/content`, which renders HTML, so on native the app
gives `pageRoutes` the component that draws one. It reads its file with `injectMarkdownPage()` and
draws the tokens with `<markdown>`:

```ts
// src/app/markdown-page.ts
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectMarkdownPage } from '@ng-native/analog';
import { ScrollView } from '@ng-native/components';
import { Markdown } from '@ng-native/components/markdown';
import { NativeHeader } from '@ng-native/router';

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
import { MarkdownPage } from './markdown-page.ts';

provideNativeRouter(pageRoutes(pages, { markdownPage: MarkdownPage }), withComponentInputBinding());
```

`injectMarkdownPage()` returns `filename` (the path from the pages folder, `colophon.md`), `slug`,
`attributes`, `content` and `tokens`. It is `@ng-native/router`'s, which `@ng-native/analog`
builds on, so the same component draws a `.md` page under
[`fileRoutes`](/packages/router/file-routes) too. `pageRoutes` fails at startup when the pages
include a `.md` file and no `markdownPage` is given, and when `x.md` and `x.page.ts` would be the
same page. `@ng-native/analog` does not import `@ng-native/components`, which is why the
component is yours.

## Content files

`@ng-native/analog` reads the Markdown files in `src/content` with the API `@analogjs/content` has:
`injectContentFiles` lists them, and `injectContent` finds one by the route's `slug`. Find the
files with a `require.context`, in a file of its own so a test can replace it. Leave out `'lazy'`:
the list reads every file's front matter.

```ts
// src/app/content.ts
import type { ContentContext } from '@ng-native/analog';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp): ContentContext;
};

export const content = require.context('../content', true, /\.md$/);
```

```ts
// src/app/app.config.ts
import { withComponentInputBinding } from '@angular/router';
import { pageRoutes, provideContentFiles } from '@ng-native/analog';
import { provideNativeRouter } from '@ng-native/router';
import { content } from './content.ts';
import { MarkdownPage } from './markdown-page.ts';
import { pages } from './pages.ts';

export const appConfig = {
  providers: [
    provideNativeRouter(
      pageRoutes(pages, { markdownPage: MarkdownPage }),
      withComponentInputBinding(),
    ),
    provideContentFiles(content),
  ],
};
```

A post is a `.md` file with front matter:

```md
---
title: File routes on a native stack
description: How Analog's pages become screens.
date: 2026-09-12
---

Every file in `src/app/pages` is a screen.
```

The blog's list, `pages/blog/index.page.ts`:

```ts
import { Component } from '@angular/core';
import { injectContentFiles } from '@ng-native/analog';
import { Pressable, ScrollView, Text } from '@ng-native/components';
import { NativeRouterLink } from '@ng-native/router';

interface PostAttributes {
  title: string;
  description: string;
  date: string;
}

@Component({
  imports: [NativeRouterLink, Pressable, ScrollView, Text],
  template: `
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      @for (post of posts; track post.slug) {
        <pressable accessibilityRole="button" [nativeRouterLink]="['/blog', post.slug]">
          <text>{{ post.attributes.title }}</text>
          <text>{{ post.attributes.description }}</text>
        </pressable>
      }
    </scroll-view>
  `,
})
export default class BlogPage {
  protected readonly posts = injectContentFiles<PostAttributes>().sort((a, b) =>
    b.attributes.date.localeCompare(a.attributes.date),
  );
}
```

And one post, `pages/blog/[slug].page.ts`:

```ts
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { injectContent } from '@ng-native/analog';
import { ScrollView } from '@ng-native/components';
import { Markdown } from '@ng-native/components/markdown';
import { NativeHeader } from '@ng-native/router';

@Component({
  imports: [Markdown, NativeHeader, ScrollView],
  template: `
    @if (post(); as post) {
      <native-header [title]="post.attributes.title ?? 'Post'" />
      <scroll-view contentInsetAdjustmentBehavior="automatic">
        <markdown [tokens]="post.tokens" [source]="post.content" />
      </scroll-view>
    }
  `,
})
export default class PostPage {
  protected readonly post = toSignal(injectContent<{ title: string }>());
}
```

`[source]` is there for a slug with no file: then `tokens` is not set, and the fallback text is
drawn instead.

| API                                      | What it gives                                                  |
| ---------------------------------------- | -------------------------------------------------------------- |
| `injectContent()`                        | The file the `slug` route parameter names, as an `Observable`  |
| `injectContent('id')`                    | The file another parameter names                               |
| `injectContent({ param, subdirectory })` | The file under `src/content/<subdirectory>/`                   |
| `injectContent({ customFilename })`      | One file by name, with no parameter                            |
| `injectContentFiles(filterFn?)`          | Every file's `filename`, `slug` and `attributes`, filtered     |
| `contentFilesResource(filterFn?)`        | The same list, as a resource                                   |
| `contentFileResource(slug?)`             | One file as a resource, by a signal of its slug or the route's |

They behave as Analog's do. A file is found at `<slug>.md` or `<slug>/index.md`; a front matter
`slug` replaces the file's name; `index.md` has the slug `''`; and a file that is not there, or a
route with no `slug`, gives `{ attributes: {}, slug: '', content: 'No Content Found' }`, with your
own text as the second argument. The context is read each time the list or a file is asked for,
so a file the dev server adds or removes is in the next one.

### What differs from @analogjs/content

- **No renderer.** There is no `provideContent(withMarkdownRenderer())`, no `<analog-markdown>` and
  no highlighter. Metro lexed the files already: draw `tokens` with `<markdown>`, which shows code
  blocks as monospace text without colors.
- **`provideContentFiles(content)`** takes the `require.context` that Analog's Vite plugin sets up
  by itself.
- **`tokens`** is added to every `ContentFile` that has content. `content` is always the Markdown
  string, never a module, and `.agx` files are not read.
- **`toc`** has an entry for each heading, with the `id` Analog would give it. There are no anchors
  to scroll to on native.
- **Dates** in front matter are ISO strings, where Analog's `injectContent` gives a `Date`.
- **Locales** (`withLocale`) and `injectContentFilesMap` are not supported.
- Everything comes from `@ng-native/analog`, the resources included, where Analog has them in
  `@analogjs/content/resources`.

## What does not apply on native

Analog is a full-stack framework, and the parts that run on a server or in a browser have nothing
to run on in an app:

- **Server-side rendering and prerendering.** An app renders on the device.
- **API routes** (`src/server/routes`) and **`.page.server.ts` loads.** There is no server beside
  the app. Fetch from your API with `HttpClient`, through `provideNativeHttpClient()`.
- **`@analogjs/content` itself.** It renders Markdown to HTML. `@ng-native/analog` has its API
  over the files Metro lexed: see [Content files](#content-files).
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

vi.mock('./pages.ts', () => ({
  pages: import.meta.glob(['./pages/**/*.page.ts', './pages/**/*.md']),
}));
vi.mock('./content.ts', () => ({
  content: import.meta.glob('../content/**/*.md', { eager: true }),
}));

test('opens on the home page', async () => {
  await render(App, appConfig);
  expect(await screen.findByText('Analog Showroom')).toBeTruthy();
});
```

The `ngNative()` plugin makes each `.md` file the module Metro makes of it. `@analogjs/router`
ships partial-compiled code, which the plugin links only for the packages it is told about:

```ts
// vitest.config.mts
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ngNative({ inline: [/\/node_modules\/@analogjs\//] })],
});
```

The `examples/analog` app in the repository is a showroom of these features, each page
showing the file that makes it, with a test for each. Its blog reads `src/content`, and
`pages/colophon.md` is a Markdown page.
