# @ng-native/platform

The only Angular-aware file in the rendering stack: a `Renderer2`/`RendererFactory2` pair that
turns Angular's renderer calls into mutations on `@ng-native/fabric`'s retained tree, and `mount()`,
which stands in for `bootstrapApplication` plus `@angular/platform-browser`.

Alpha: APIs may change before 1.0.

## Install

Most apps start from `npx create-expo-app@latest my-app --template @ng-native/template`, which
already calls `mount()` in `src/main.ts`. Otherwise:

```sh
npm install @ng-native/platform
npm install @angular/core react-native
```

`@angular/common` is an optional peer, needed only for `provideNativeHttpClient`.

## Example

```ts
// src/main.ts
import { AppRegistry, Image, Platform, processColor } from 'react-native';
import { mount } from '@ng-native/platform';
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric';
import { App } from './app/app.ts';

registerPlatformComponents(Platform.OS);

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  mount(Number(rootTag), App, getFabricUIManager(), {
    processColor,
    resolveAssetSource: (value) => Image.resolveAssetSource(value as never),
  });
});
```

## What's in the package

- `.` - `mount()`, `NativeRendererFactory`, `PLATFORM_NATIVE_ID`, `isPlatformNative()`.
- `./http` - `provideNativeHttpClient()`, an `HttpClient` backend over React Native's
  `XMLHttpRequest` (Angular's default `fetch` backend cannot read a React Native `fetch` response
  body). Use it in place of `provideHttpClient()`.

## Docs

- [Platform](https://ng-native.com/packages/platform)
- [Bootstrapping](https://ng-native.com/packages/platform/bootstrapping) and
  [renderer](https://ng-native.com/packages/platform/renderer)
- [Root README](https://github.com/ng-native/ng-native/blob/main/README.md) and
  [ARCHITECTURE.md](https://github.com/ng-native/ng-native/blob/main/docs/ARCHITECTURE.md)

## License

MIT
