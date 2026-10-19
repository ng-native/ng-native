---
title: Navigation bar
summary: A stack of claims on Android's navigation bar, its button colour and whether it shows.
---

# Navigation bar

`NavigationBar` is the same stack of claims as [`StatusBar`](/packages/device/status-bar), for the
bar along the bottom of an Android screen: the colour of its buttons, and whether it is there at
all. A video player that hides the bar while it is open gives the screen behind it the bar back when
it closes, without either knowing about the other.

```ts
import { Component, DestroyRef, inject } from '@angular/core';
import { NavigationBar } from '@ng-native/device';

@Component({ selector: 'app-player', template: `<view />` })
export class Player {
  constructor() {
    const drop = inject(NavigationBar).push({ hidden: true });
    inject(DestroyRef).onDestroy(drop);
  }
}
```

`set()` replaces the base claim, for an app that configures the bar once at startup. `push()` adds a
claim on top of whatever is there and returns the function that drops it. `state` is every claim in
the stack merged in order, later ones winning per property. Anything a claim leaves unset falls
through to the claim underneath it. As for the [status bar](/packages/device/status-bar), every app
the runtime mounts claims the same stack, an app's claims leave it when the app is destroyed, and
an activity that comes to the front is given the bar again.

`NavigationBarState` takes `style` and `hidden`:

- `style` is `'light' | 'dark' | 'auto'` and names the colour of the buttons, the way
  `StatusBarStyle` names the colour of the status bar's text: `'dark'` is dark buttons, for a light
  screen behind them, and `'light'` is light buttons, for a dark one.
- `hidden: true` hides the bar. A swipe in from the edge it sits on shows it for a moment, and it
  hides again on its own.

## Install

Expo Go has the native module this drives. A development build needs it installed:

```sh
npx expo install expo-navigation-bar
```

Nothing in `@ng-native/device` imports the package: `NavigationBar` reaches its native module by
name. In a build without it, every claim is kept in `state` and changes nothing on screen.

## Buttons and contrast

`style` colours the buttons of three-button navigation, on Android 8 and later; on Android 7 it
changes nothing. Expo documents it as having no effect with gesture navigation, which has a handle
in place of buttons.

By default Android also keeps the buttons readable with a translucent band behind them, in the
colour that suits the style: light behind dark buttons and dark behind light ones. So light buttons
on a light screen sit on a grey band rather than straight on the screen. On Android 9 and earlier,
`expo-navigation-bar` paints that band as the bar's colour itself. A development build that wants
the buttons drawn straight over its own content turns the band off with the plugin's
`enforceContrast` option in `app.json`, then rebuilds; Expo Go keeps it on:

```json
{
  "expo": {
    "plugins": [["expo-navigation-bar", { "enforceContrast": false }]]
  }
}
```

## Following the color scheme

`'auto'` is dark buttons while [`ColorScheme`](/packages/device/color-scheme) reports light, and
light buttons while it reports dark. It changes with the scheme, whether the system switches or the
app calls `ColorScheme.set()`. `state` still reports `'auto'`.

```ts
inject(NavigationBar).set({ style: 'auto' });
```

A claim with a fixed style keeps that style whatever the scheme does. Android puts the buttons back
to the new scheme's own when the scheme changes, so `NavigationBar` sends a fixed style again each
time. Once a claim has named a style and the last one to name it drops, the bar goes back to
`'auto'` and keeps following the scheme. Until a claim names a style, the buttons are left to
Android.

## With the native stack

On Android, `react-native-screens` shows or hides the bar each time a screen appears, from that
screen's own `navigationBarHidden`, once any screen has had one. So where the module is installed,
the stack outlet from `@ng-native/router` puts the app's `hidden` claim on every screen that has
no `navigationBarHidden` of its own, and keeps it there as the claim changes or goes away. A screen
with its own, from its presentation or its page's host bindings, has it each time it comes in
front, and the claim is back when a screen without one is.

```ts
import { Component, inject } from '@angular/core';
import { NativeNavigation } from '@ng-native/router';

@Component({ selector: 'app-library', template: `<view />` })
export class Library {
  private readonly navigation = inject(NativeNavigation);

  protected openVideo(): void {
    this.navigation.push('/video', { presentation: { navigationBarHidden: true } });
  }
}
```

## On iOS, the web and Node

iOS has no navigation bar, and neither has the web. There, and off a device, claims are kept in
`state` and reach no platform, so shared code can claim the bar without a platform check.

## Reference

<!-- api: NavigationBar -->
