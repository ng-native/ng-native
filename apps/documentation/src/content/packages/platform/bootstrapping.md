---
title: Bootstrapping
summary: What mount() takes, what it returns, and what it puts in the injector.
---

# Bootstrapping

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

## Options

`mount(rootTag, component, fabric, options?)` takes an options object that is mostly there to
close gaps a browser never had:

- **`processColor`** converts a color string or number to whatever the platform wants, the same
  function React Native exports as `processColor`. Without it colors reach native unconverted.
- **`resolveAssetSource`** turns what `require('./x.png')` compiles to - an asset id - into
  `{uri, width, height, scale}`. Without it a local image is blank; a remote `{uri}` object happens
  to pass through unresolved and hides the gap until someone reaches for a bundled asset.
- **`conditions`** is what `@media` resolves against: viewport width and height, color scheme, and
  the reduced-motion preference. Without it every media query evaluates false. It also carries the
  system text size (`fontScale`), which the line box of a single-line iOS text input scales by.
- **`tokens`** seeds device-level custom properties - the hairline width, mainly - below `:root`, so
  an app's own stylesheet still wins if it sets the same name.
- **`globalStyles`** is the one stylesheet allowed to match a node regardless of which component
  created it: your Tailwind output, or any app-wide reset, goes here. See
  [Metro](/packages/metro) and [Tailwind](/packages/tailwind).
- **`providers`** are extra `Provider`/`EnvironmentProviders` merged into the environment injector
  `mount` creates, the same shape you would pass to `bootstrapApplication`.
- **`inputs`** sets the root component's inputs, by their public names, before its first change
  detection. That is the only moment an `input.required()` can be given one: `mount` runs the
  first pass itself, so there is no later point to set it before the template reads it. The
  object is a plain `Record<string, unknown>`, not checked against the component's inputs.
- **`onError`** receives an error thrown while a native event is being dispatched, with the
  event's name: a responder handler, a listener registered on the engine directly, or a commit a
  focus change started. Angular already catches what a template listener throws, so those never
  reach it. Without `onError`, `mount` points these errors at the app's `ErrorHandler`; with it,
  they go to your function instead and the `ErrorHandler` never sees them. Either way nothing
  thrown there is rethrown into native.

```ts
const app = mount(Number(rootTag), App, getFabricUIManager(), {
  processColor,
  inputs: { accountId: 'acc_42' },
  onError: (error, topLevelType) => console.error(`[${topLevelType}]`, error),
});
```

To change an input once the app is running, call `app.componentRef.setInput(name, value)`.

## Return value and watching conditions

`mount` returns `{ componentRef, applicationRef, factory, engine }`. `engine` is worth keeping: it
carries `engine.stats` (commit counts and timings) and is what `watchConditions` re-resolves media
queries against on rotation or a system theme change. Without calling `watchConditions(app.engine)`,
`dark:` and any responsive layout only ever renders whatever `conditions` was at mount time.
`watchConditions` also re-measures every text when the system text size changes; without it a
text keeps the size it was first measured at, and its glyphs are clipped once they grow.

## What is in the injector

`mount` builds an `EnvironmentInjector` parented to the platform injector (via Angular's
`ɵcreateOrReusePlatformInjector`, exactly as `internalCreateApplication` does), and provides:

- Zoneless change detection, unconditionally. There is no zone.js anywhere in this stack, and no
  option to add it back.
- `RendererFactory2`, as the `NativeRendererFactory` described in [the renderer
  page](/packages/platform/renderer).
- `Engine`, the class itself, exposed so a component can read `engine.stats` or reach a node for an
  imperative native command.
- `HostEngine`, aliased to the same `Engine` instance (`useExisting: Engine`). This is the
  interface `@ng-native/components` actually injects, so it stays renderer-agnostic; `Engine`
  under its own token exists for the small number of components
  (`worklet-style`, `worklet-scroll`, `native-gesture`) that need Fabric's own handles for
  Reanimated and gesture-handler.
- `DOCUMENT`, as a stub object (`{ head: undefined, body: undefined, getElementById: () => null }`).
  It exists because Angular's `resource()` reaches for `TransferState`, which calls
  `document.getElementById` the moment a resource is created - without the stub every resource in
  an app throws before its loader runs.
- `PLATFORM_ID`, as `'native'`. See below.
- `ErrorHandler`, Angular's default.

## Telling native from the web

`PLATFORM_ID` is `'native'` in an app on a device. Angular's own default, when nothing provides
one, is `'unknown'`, which `isPlatformBrowser()` and `isPlatformServer()` both answer false for,
so a library could not tell a native app from anything else - and one that guarded its DOM work
with `!isPlatformServer(id)` would reach for `document` and fail. `isPlatformNative()` asks the
question the same way Angular's two do:

```ts
import { Component, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { isPlatformNative } from '@ng-native/platform';

@Component({ selector: 'app-share', template: '...' })
export class Share {
  private readonly platformId = inject(PLATFORM_ID);

  share(url: string): void {
    if (isPlatformNative(this.platformId)) {
      // The native share sheet: see /packages/device/sharing.
    } else if (isPlatformBrowser(this.platformId)) {
      void navigator.share?.({ url });
    }
  }
}
```

On the web the answer is `'browser'`: [`mount()`](/packages/web) provides it for an app of its
own, because it really is running in a DOM, and an [island](/packages/web/islands) inside an
Angular web app inherits whatever that app provides. To tell iOS from Android, use
`nativePlatform()` from `@ng-native/fabric`, or the `ios:` and `android:` Tailwind variants for
styling.

## Development checks

In development, `mount` also checks that `animate.enter`/`animate.leave` will actually do anything
and logs a console error naming the fix if not, and installs the fallback reload hook Fast Refresh
cannot cover on its own. Both depend on the polyfills `withAngularNative` installs - see
[Metro](/packages/metro/configuration).
