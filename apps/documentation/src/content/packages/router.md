---
title: Router
summary: Angular's own Router, driving a real native stack, native tabs and a native header.
---

# Router

`@ng-native/router` is not a navigation library of its own. It is `@angular/router` - the
same `Router`, the same route config, the same guards, resolvers and deep links - pointed at
`react-native-screens` instead of the DOM. Reach for it as soon as an app has more than one
screen: its outlets create and destroy real `RNSScreen` views, so a push is a genuine native stack
transition with the platform's own animation, swipe-back gesture, and a real
`UINavigationController`/`Fragment` underneath it, not something drawn to look like one.

## Setting it up

```sh
npm install @ng-native/router @angular/router
npx expo install react-native-screens
```

`react-native-screens` is the native side: every stack, screen, header and tab bar here is one of
its views. Expo Go bundles it, but a development or release build only links a native module the
app lists in its own `package.json`, so without it those builds render `Unimplemented component`
where the navigation should be.

```ts
import { AppRegistry } from 'react-native';
import { withComponentInputBinding } from '@angular/router';
import { mount } from '@ng-native/platform';
import { getFabricUIManager } from '@ng-native/fabric';
import { provideNativeRouter } from '@ng-native/router';
import { routes } from './app/app.routes.ts';
import { App } from './app/app.ts';

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  mount(Number(rootTag), App, getFabricUIManager(), {
    providers: [provideNativeRouter(routes, withComponentInputBinding())],
  });
});
```

`provideNativeRouter(routes, ...features)` is `provideRouter` - it takes the same routes and the
same router features, and calls it - plus what native needs on top: a `PlatformLocation` backed by
an in-memory history instead of the browser's, a `RouteReuseStrategy` that detaches a screen instead
of destroying it (what keeps a pushed-away screen's scroll position and text input alive), and
`NativeNavigation`. Android's hardware back button and deep links come from `@ng-native/device`'s
`HardwareBack` and `DeepLinks` and need no wiring here - both already fall back to doing nothing off
a device.

The native options are passed the same way: `withLinkParent` for deep links, and
`withHeaderDefaults` and `withTabDefaults` for how every [header](/packages/router/header) and
[tab bar](/packages/router/tabs) looks when a screen does not say.

`withComponentInputBinding()` is opt-in here exactly as it is on the web: with it, a `:id` param,
a query param or resolved data arrives as the page's `id` input; without it, both outlets leave a
page's inputs alone, as Angular's `RouterOutlet` does, and the page reads `ActivatedRoute` instead.
The feature's options are not read, though: query params always bind, and an input with no
matching key is set to `undefined`, which are its defaults.

Every other router feature is passed through unchanged, preloading included. A lazy route's code
is otherwise loaded on the first navigation to it, which on the dev server is a request to Metro
and a pause before the page appears. `withPreloading(PreloadAllModules)` loads every lazy route
right after start-up instead:

```ts
import { PreloadAllModules, withComponentInputBinding, withPreloading } from '@angular/router';
import { provideNativeRouter } from '@ng-native/router';
import { routes } from './app/app.routes.ts';

const router = provideNativeRouter(
  routes,
  withComponentInputBinding(),
  withPreloading(PreloadAllModules),
);
```

## The shell

A route config is an ordinary `Routes` array - `loadComponent`, `children`, guards, all of it. What
differs is the shell: instead of a plain `<router-outlet>`, the root component renders a
`<native-stack-outlet>`, and its host element becomes the stack:

```ts
import { Component } from '@angular/core';
import { SafeAreaProvider } from '@ng-native/components';
import { NativeStackOutlet } from '@ng-native/router';

@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet, SafeAreaProvider],
  template: `
    <safe-area-provider>
      <native-stack-outlet />
    </safe-area-provider>
  `,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export class App {}
```

Every route's component is created directly inside its own screen, so screens below the top of
the stack stay mounted rather than torn down - which is what makes their scroll offset, cursor
position and keyboard focus survive a push. A screen popped by a swipe-back gesture or the Android
back button is reported to the router as a real navigation, so the URL and the visible stack never
disagree.

Anything a route path can express - `routerLink`, `router.navigate()`, guards, resolvers - keeps
working exactly as it does on the web, because it is still the same `Router`. For a plain push,
`nativeRouterLink` is the native equivalent of `routerLink`:

```html
<pressable [nativeRouterLink]="['/detail', item.id]"><text>Open</text></pressable>
```

## When a page fails to load

A lazy route whose code cannot be loaded fails its navigation the way it does on the web: the
router emits a `NavigationError` and stays on the page it was on. A lazily loaded chunk the dev
server cannot serve is one cause, and a release build, which puts every lazy route in the one
bundle, has none of these. Whichever way the navigation started, the app hears it in one place:
Angular's `withNavigationErrorHandler`, passed to `provideNativeRouter` beside the other router
features. It runs in an injection context, so it can tell the rest of the app:

```ts
import { Service, inject, signal } from '@angular/core';
import { withNavigationErrorHandler, type Routes } from '@angular/router';
import { provideNativeRouter } from '@ng-native/router';

const routes: Routes = [
  // The app's routes, lazy ones among them.
];

/** The page that did not load, for a banner that says so and offers to try again. */
@Service()
export class FailedPage {
  readonly url = signal<string | null>(null);
}

const router = provideNativeRouter(
  routes,
  withNavigationErrorHandler((error) => inject(FailedPage).url.set(error.url)),
);
```

A banner bound to `FailedPage.url` can show the message and call `Router.navigateByUrl(url)` to
try again. `router.events` carries the same `NavigationError` for code that watches every
navigation instead.

Around that one handler, each way into a page does what its caller expects:

- `NativeNavigation.push()` and `present()`, and `Router.navigate()`, reject their promise, so the
  code that asked can react as well.
- A tab tap that fails leaves the tab bar on the tab the router is still on, and the error also
  reaches the app's `ErrorHandler`.
- A deep link that fails, at launch or while the app runs, reaches the `ErrorHandler` too, rather
  than going unhandled.

From here, **Screens and navigation** covers everything a URL alone cannot express - replacing a
screen, presenting a modal or sheet, resetting the stack - through `NativeNavigation`. **The
native header** covers `<native-header>` and the slots `<native-header-item>` places content in.
**Tabs** covers `<native-tabs-outlet>` and declaring a bar as content rather than as config.
