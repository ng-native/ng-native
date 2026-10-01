---
title: Platform
summary: The seam that bootstraps an Angular app onto a native screen, not a DOM.
---

# Platform

`@ng-native/platform` is the only Angular-aware file in the whole rendering stack.
Everything below it, [`@ng-native/fabric`](/packages/fabric), is a framework-agnostic
retained tree with no import from `@angular/core` anywhere in it. This package is the seam: a
`Renderer2`/`RendererFactory2` pair that turns Angular's renderer calls into mutations on that
tree, and a `mount()` function that stands in for `bootstrapApplication` plus
`@angular/platform-browser`.

Reach for this package exactly once, in your app's entry file, to call `mount()`. Everything else
you write - components, styles, routes - goes through the packages built on top of it, not through
this one directly. `mount` also returns an `engine` you can hold onto: it carries commit stats
(counts and timings) and is what [`@ng-native/device`](/packages/device)'s
`watchConditions(engine)` re-resolves media queries against on rotation or a system theme change.

## The smallest app

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

`mount` takes a root tag (the number React Native's own runnable handler hands you), your root
component, a `FabricUIManager` (`getFabricUIManager()` reads `global.nativeFabricUIManager`, which
only exists once the New Architecture is enabled and only inside an `AppRegistry` runnable), and an
options object for the gaps a browser never had - color conversion, asset resolution, media-query
conditions, and the one global stylesheet every element is matched against regardless of which
component created it.

## How this differs from bootstrapping on the web

There is no `bootstrapApplication`, no `BrowserModule`, and no CSS selector naming an element in an
`index.html` - there is no HTML document at all. The root Angular mounts into is `engine.root`, a
plain object standing in for `Element`, and it becomes a screen's worth of native views the moment
the first commit runs rather than by producing markup for a browser to paint. `DOCUMENT` is
provided as a stub, just enough to satisfy the one Angular internal (`TransferState`, reached the
moment a `resource()` is created) that calls `getElementById` on it. And there is no zone.js option
to reach for: `mount()` provides zoneless change detection unconditionally, so the change-detection
model a zoneless Angular app already uses on the web carries over unchanged.

The [bootstrapping](/packages/platform/bootstrapping) page covers `mount()`'s options, its return
value, and what it puts in the injector. The [renderer](/packages/platform/renderer) page covers
what `NativeRendererFactory` and `NativeRenderer` actually do with an Angular template once it
exists, including how a commit gets scheduled outside a normal change-detection pass.

## HTTP requests

Use `provideNativeHttpClient()` from `@ng-native/platform/http`, not `provideHttpClient()`, in
`mount`'s `providers`:

```ts
import { provideNativeHttpClient } from '@ng-native/platform/http';
import { withInterceptors } from '@angular/common/http';

mount(rootTag, App, getFabricUIManager(), {
  providers: [provideNativeHttpClient(withInterceptors([authInterceptor]))],
});
```

`provideNativeHttpClient(...features)` takes the same `HttpFeature`s `provideHttpClient()` does -
`withInterceptors()` among them - and configures `HttpClient` with `withXhr()` instead of the
default `fetch` backend. That is not a style preference. Angular 22's default backend reads a
response body only through `response.body`'s stream. Expo's `fetch` streams one, but a release
build of an app whose `src/main.ts` does not import `expo` has React Native's own `fetch`, which is
`whatwg-fetch` over XHR, whose `Response` has no `body`. There every request resolves with a null
body and nothing reports why. So does any build with `EXPO_PUBLIC_USE_RN_FETCH` set to `1` or
`true`, which tells Expo's runtime to leave React Native's `fetch` in place. React Native's
`XMLHttpRequest` is native and complete, upload progress included, and the XHR backend uses
`XMLHttpRequest` whatever the global `fetch` is. See
[Known limitations](/guide/limitations#httpclient-needs-providenativehttpclient).

A separate entry point, `@ng-native/platform/http`, so an app that never makes a request does not
pull in `@angular/common`.
