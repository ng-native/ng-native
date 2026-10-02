---
title: Native and web
summary: One component set for native and web, sharing a renderer seam, and what differs on the web.
---

# Native and web

The same components use a shared renderer interface on native platforms and in browsers. Every
example on this site runs a real `@ng-native/components` component through the browser renderer,
not a screenshot or a React port.

Controls have one implementation: `packages/components/src/switch.ts`, for example, serves both
hosts.

## The seam

`HostEngine` and `HostNode` in `@ng-native/fabric` define only the renderer calls
`@ng-native/components` uses. Direct dependencies on `inject(Engine)`, whose constructor requires
a `FabricUIManager`, and Fabric's `EngineNode` would couple components to native rendering.
Casting a browser object through `as unknown as Engine` would bypass type checking.

Fabric's `Engine` implements `HostEngine`; `EngineNode` extends `HostNode`. `BrowserEngine`
implements both over the DOM without casts, while the native path stays unchanged.

## Mounting on the web

```ts
import { provideRouter } from '@angular/router';
import { mount } from '@ng-native/web';
import { App } from './app/app.ts';

const root = document.getElementById('app-root')!;
mount(root, App, { providers: [provideRouter(routes)] });
```

Browser `mount` differs from `@ng-native/platform`'s `mount` only in host requirements.

The first argument is the target `Element`. Fabric instead uses the numeric root tag supplied by
React Native's host.

The browser needs no `FabricUIManager`, `processColor` or device tokens. It provides `HostEngine`,
not `Engine`. `@ng-native/components/reanimated` and `/gestures` need neither on the web: a browser
build resolves them to inert directives that need no engine.

`DOCUMENT` is the real document, rather than native `mount`'s `TransferState` stub.

## The layout reset

Browser and Yoga layout defaults differ.

`flex-row` on a `<view>` sets `flex-direction` explicitly and behaves identically on both
platforms. Without flex properties, Yoga defaults to
`display: flex; flex-direction: column; align-items: stretch; flex-shrink: 0`, while browsers give
the unknown `<view>` element `display: inline; flex-shrink: 1`.

`@ng-native/web`'s `reset.css` aligns those defaults using `[data-rn]`, which marks every created
node. Tag selectors would miss `text-input` and `switch`, rendered as `<textarea>` and `<input>`.

`<text>` is excluded from the flex reset. React Native's `Text` supports wrapping and nested
`<text>` inline runs; `display: flex` would prevent wrapping. The browser uses `display: inline`,
which wraps but ignores explicit `width` and `height`. Native `Text` is a full Yoga node and
accepts both. For explicit sizing on the web, add `class="block"` yourself.

## What does not survive the trip

`@ng-native/router` uses react-native-screens and has no web build. `<native-header>` becomes an
inert, invisible box; no native stack outlet exists. The browser host uses Angular's
`<router-outlet>`, whose DOM-independent `ViewContainerRef` implementation works unchanged over
`BrowserRenderer`.

Reanimated worklets and react-native-gesture-handler are native-only. Their directives are inert on
the web, and the libraries' own imports fail a browser build; see
[What does not carry over](/packages/web/limits).

Other controls work through the host. A self-focusing `<text-input>` and an offset-scrolling
`<scroll-view>` use `engine.measure()` and `dispatchCommand()`, which `BrowserEngine` implements
like Fabric's `Engine`. The site's examples exercise those implementations.

## Why the web host exists

The web host tests whether the shared interface supports another implementation, rather than merely
describing Fabric: running the same component against a different host exposes bugs that only
one host would hide. It is not intended as a deployment target.

It also powers this site's examples: each calls `mount` into a page container, using the same
source, cascade and press semantics as native.

In an existing Angular web app, `<ng-native-island>` embeds these components while sharing services
and change detection. Reuse a mobile screen without a second implementation, but keep the native
router and other native-only features on the phone. See [Islands](/packages/web/islands).

Conversely, `<dom-component>` renders a browser Angular component inside a native screen's web
view, with inputs and outputs bound from the native template. Use it for canvas, charting libraries
or editors. Its runtime is separate, so only JSON crosses. See
[DOM components](/packages/expo/dom-components).
