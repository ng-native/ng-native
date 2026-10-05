# @ng-native/analog

[Analog](https://analogjs.org)'s file-based pages for an Angular Native app: the pages in
`src/app/pages`, routed by `createRoutes` from `@analogjs/router` itself, on a native stack, and the
Markdown in `src/content`, read with the API `@analogjs/content` has.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @ng-native/analog @analogjs/router @ng-native/router @angular/router
npx expo install react-native-screens
```

## Example

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withAnalog } = require('@ng-native/analog/metro');

module.exports = withAnalog(withAngularNative(getDefaultConfig(__dirname)));
```

```ts
// src/app/pages.ts
import type { PageContext } from '@ng-native/analog';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp, mode: 'lazy'): PageContext;
};

export const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');
```

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

## What's in the package

- `pageRoutes(pages, { markdownPage })`: Analog's routes for a `require.context` of the pages, or
  for the files of an `import.meta.glob` in a Vitest test. A `.md` page is drawn by `markdownPage`,
  which reads its file with `injectMarkdownPage()`: `@ng-native/router`'s, so the same component
  draws a `.md` page under its `fileRoutes` too.
- `provideContentFiles(content)`, `injectContent`, `injectContentFiles`, `contentFilesResource` and
  `contentFileResource`: `@analogjs/content`'s API over a `require.context` of `src/content`, each
  file lexed by Metro, for `<markdown [tokens]>` from `@ng-native/components/markdown`.
- `withAnalog(config)` in `@ng-native/analog/metro`: turns on `require.context`, and resolves
  `@analogjs/router`'s import of `@analogjs/content`, which only a Markdown page needs, to an empty
  module, installed or not. The app's own import of it resolves to the package, and fails the build
  when it is not installed.

Markdown pages and content files need `marked`, which Metro lexes them with:

```sh
npx expo install marked @ng-native/components
```

```ts
// src/app/content.ts
import type { ContentContext } from '@ng-native/analog';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp): ContentContext;
};

export const content = require.context('../content', true, /\.md$/);
```

```ts
// src/app/pages/blog/[slug].page.ts
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { injectContent } from '@ng-native/analog';
import { Markdown } from '@ng-native/components/markdown';

@Component({
  imports: [Markdown],
  template: `
    @if (post(); as post) {
      <markdown [tokens]="post.tokens" [source]="post.content" />
    }
  `,
})
export default class PostPage {
  protected readonly post = toSignal(injectContent());
}
```

Add `provideContentFiles(content)` to the app's providers.

## Docs

- [Analog](https://ng-native.com/packages/analog)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
