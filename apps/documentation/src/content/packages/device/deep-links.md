---
title: Deep links
summary: The url an app was launched with, and every link that arrives while it runs, as paths.
---

# Deep links

`DeepLinks` delivers the URL an app was launched with (`initialUrl()`, once it is known) and every
link that arrives while it is running (`subscribe()`), both normalized to a path your router can
navigate to.

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { DeepLinks } from '@ng-native/device';

@Component({ selector: 'app-root', imports: [View], template: `<view />` })
export class Root {
  constructor() {
    const links = inject(DeepLinks);
    const path = links.initialUrl();
    if (path) this.navigate(path);

    const stop = links.subscribe((next) => this.navigate(next));
    inject(DestroyRef).onDestroy(stop);
  }

  private navigate(path: string): void {}
}
```

`myapp://settings` and `https://example.com/settings` both mean `/settings` to a
router, which takes noticing that only the second one has a host to strip - a scheme's own prefix is
app configuration and every app's is different, but stripping one down to a path is not.

It also strips Expo Go's own `/--/` launch prefix and ignores the development client's internal
launch url (`<scheme>://expo-development-client/?url=...`), which is Expo telling its own launcher
which bundle to load and means nothing to the app - left alone it would reach the router as a path,
match no route, and show a blank screen on every launch during development, which looks exactly like
a bug in the app.

The launch url is delivered whichever way is true at the time: as `initialUrl()` if it is known
before anything asks, and through `subscribe()` if the app is already up. Both happen - the promise
that resolves `initialUrl()` races the first navigation and neither order is guaranteed - so call
`initialUrl()` and `subscribe()` both, as above, rather than picking one.

`open(url)` hands a url to whatever else on the device handles it: a browser, Maps, another app.

`follow(path)` hands a path of the app's own to what `subscribe()` was given, as a link that
arrived from outside is handed, so the router navigates to it. With nothing subscribed, as in an
app without `provideNativeRouter()`, the path goes nowhere: it is not kept for a listener later.

`NATIVE_HISTORY` is the native router's `PlatformLocation`, which `provideNativeRouter()` provides.
A package that stands in a `PlatformLocation` for an app with no router reads it first, so the
router's is kept in whichever order the two are provided.

`openSettings()` opens the app's own page in the system settings, where a person turns on a
permission the platform no longer asks for (see [Permissions](/packages/expo/permissions)). Android
has no url for that page, so `open()` cannot reach it there.

A url that came from a person or a server can name any scheme, another app's included. Check it
against the schemes you mean to open, usually `https:` and the app's own, before passing it to
`open()`, to [`Browser`](/packages/expo/browser)'s `open()` or to a `ui-link`'s `destination`.

Opening goes the other way too: any app or web page can open any of your routes by deep link, so a
route that acts as it arrives needs a guard (see [Router](/packages/router)).

`DeepLinks` gives a path, so the scheme, the host and the query of a link are gone by the time you
see it. An app that needs the whole address reads the platform's source itself: `deepLinkSource()`
returns the `DeepLinkSource` that `DeepLinks` is built on, with `launchUrl()`, `subscribe()`,
`open()` and `openSettings()`, all in terms of the url as it arrived.
Off a device it is a source that never delivers a link.

`@ng-native/router`'s `provideNativeRouter(routes)` wires this into `PlatformLocation` for you, so
most apps never call `DeepLinks` directly.

## Off a device and on the web

Off a device `initialUrl()` stays `null`, `subscribe()` never fires, and `open()` and
`openSettings()` do nothing, because there is no `Linking` module underneath them. On the web, urls
and paths are already the same idea, so `DeepLinks` is a native-only concern - a web build reads the
address bar instead.

## Reference

<!-- api: DeepLinks -->
