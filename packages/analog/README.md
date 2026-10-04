# @ng-native/analog

[Analog](https://analogjs.org)'s file-based pages for an Angular Native app: the pages in
`src/app/pages`, routed by `createRoutes` from `@analogjs/router` itself, on a native stack.

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

- `pageRoutes(pages)`: Analog's routes for a `require.context` of the pages, or for the files of an
  `import.meta.glob` in a Vitest test.
- `withAnalog(config)` in `@ng-native/analog/metro`: turns on `require.context`, and resolves
  `@analogjs/router`'s import of `@analogjs/content`, which only a Markdown page needs, to an empty
  module, installed or not.

## Docs

- [Analog](https://ng-native.com/packages/analog)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
