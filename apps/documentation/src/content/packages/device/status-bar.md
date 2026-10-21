---
title: Status bar
summary: A stack of claims on the status bar's style, visibility and color, not a setter.
---

# Status bar

`StatusBar` is a stack of claims rather than a setter, because more than one thing in an app can
have an opinion about the bar at once: a modal that wants light text has to give the screen behind
it back its own claim when it closes, and nothing else remembers what that was.

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { StatusBar } from '@ng-native/device';

@Component({ selector: 'app-photo-viewer', imports: [View], template: `<view />` })
export class PhotoViewer {
  constructor() {
    const drop = inject(StatusBar).push({ style: 'light', hidden: true });
    inject(DestroyRef).onDestroy(drop);
  }
}
```

`set()` replaces the base claim, for an app that configures the bar once at startup. `push()` adds a
claim on top of whatever is there and returns the function that drops it, ready to hand to
`DestroyRef.onDestroy`. `state` is what is actually showing: every claim in the stack merged in
order, later ones winning per property. Anything a claim leaves unset falls through to the claim
underneath it.

The bar is the device's, not one app's. Every app the runtime mounts claims the same stack, an app's
claims above those of an app that claimed before it, and an app's claims, its base claim included,
leave the stack when the app is destroyed. On Android, each time an activity comes to the front, a
recreated one included, the bar is given every claimed property again, since a new activity starts
with the platform's own bar.

`StatusBarState` takes `style` (`'default' | 'light' | 'dark' | 'auto'`, `'light'` meaning light
_content_ for a dark bar, as CSS would), `hidden` and `animated`.

It also takes `backgroundColor` and `translucent`, which are deprecated and do nothing. They were
Android-only, and under [Android edge-to-edge](/guide/android-edge-to-edge) the app always draws
under the bar, which has no background of its own: React Native's Android module ignores both. In
development the first use of each logs a warning on Android, unless the app has opted out of
edge-to-edge, where both still work up to React Native 0.86 (Expo SDK 57). React Native 0.88 (Expo
SDK 58) draws every Android app edge-to-edge and has neither, so there both do nothing and warn
whatever the theme. On iOS neither is sent, so React Native's "only available on Android" warning
no longer shows. To color the area behind the bar,
color the view under it.

## Following the color scheme

`'auto'` is dark content while [`ColorScheme`](/packages/device/color-scheme) reports light, and
light content while it reports dark. It changes with the scheme, whether the system switches or the
app calls `ColorScheme.set()`, for as long as it is the style the stack resolves to. `state` still
reports `'auto'`. An app from the template or a generator claims it at startup:

```ts
inject(StatusBar).set({ style: 'auto' });
```

A claim with a fixed style keeps that style whatever the scheme does, and once it drops, an `'auto'`
claim underneath resolves against the scheme at that moment.

Until something claims a style, Android shows light content, white icons that vanish on a light
screen, and `'default'` asks for the same. iOS picks dark or light content from the window's
appearance on its own.

`height` is only ever non-zero on Android; on iOS the number a layout wants instead is the safe-area
top inset, from [`SafeArea`](/packages/device/safe-area).

`expo-status-bar` is the same statics with a React component wrapped around them, so nothing here
needs that package installed, and neither does `expo-status-bar` need to be avoided if it is
already there - both talk to the same platform module.

## On iOS

An app built with the iOS 27 SDK changes the bar only through `@ng-native/metro`'s config plugin
(`"plugins": ["@ng-native/metro"]` in `app.json`). That SDK ignores the app-wide setters React
Native's status bar module calls, so the plugin answers them from the view controllers iOS asks
instead: the window's root, and a screen or modal presented full screen. The same holds for
`expo-status-bar` and React Native's own `StatusBar`, which end at the same module.

Until the app claims a style, a screen's own `statusBarStyle` presentation applies; once it has, the
claim applies on every screen. The same goes for `hidden` and `statusBarHidden`.

## On Android

`react-native-screens` sets the bar again each time a screen appears: from that screen's own
`statusBarStyle` and `statusBarHidden`, or, for a screen without them, to light content and shown.
So the stack outlet from `@ng-native/router` puts the app's claim on every screen that has no style
or visibility of its own, and keeps it there as the claim changes or goes away. A screen with its
own `statusBarStyle` or `statusBarHidden`, from its presentation or its page's host bindings, has
it each time it comes in front, and the claim is back when a screen without one is. A claim that
changes while such a screen is in front shows at once, until the next screen appears.

## Off a device and on the web

Off a device every setter is a no-op and `height` stays zero, because there is no `StatusBar` module
underneath it. There is no status bar on the web, so `StatusBar` is a native-only concern; an app
should guard status bar claims behind a platform check if it also targets the web.

## Reference

<!-- api: StatusBar -->
