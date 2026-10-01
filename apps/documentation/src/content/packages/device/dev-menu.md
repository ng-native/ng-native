---
title: Dev menu
summary: Adding switches to the shake menu in development, gone entirely in a release build.
---

# Dev menu

`DevMenu` adds an entry to the shake menu in a development build, for the switches a team ends up
wanting: a mock user, a feature flag, a reset. It does nothing in a production build, so the calls
can stay where they are.

```ts
import { Component, inject } from '@angular/core';
import { DevMenu } from '@ng-native/device';

@Component({ selector: 'app-root', template: `<view />` })
export class Root {
  constructor() {
    const devMenu = inject(DevMenu);
    devMenu.add('Reset onboarding', () => this.resetOnboarding());
  }

  private resetOnboarding(): void {}
}
```

A feature flag, a fake slow network, "log the current state", "clear the database" - the things a
team otherwise builds a hidden settings screen for and then has to remember not to ship. These go in
the shake menu, which does not exist in a release build, so neither do they.

`available` is whether anything registered here will appear - `false` in a release build - checked
by reading `__DEV__` rather than assuming, because `DevSettings` exists in a release bundle and its
`addMenuItem` is a no-op there; an app that registers twenty items is still doing twenty things at
startup for no reason if `available` is not checked first.

`add(title, handler)` registers an item. Registering the same title again swaps in the new handler
rather than adding a second entry - React Native's own `DevSettings.addMenuItem` keys on `title` -
which is what makes it safe for a hot reload to re-run the constructor that calls `add()`: the menu
keeps one entry, wired to whichever handler registered most recently. `reload(reason?)` reloads the
bundle the way Metro's own reload does. In development in an Expo app, that is Expo's
`reloadAppAsync()`, since React Native's `DevSettings.reload()` brings an app in Expo Go back
without Expo's native modules; a reload Expo cannot do falls back to React Native's, with the error
logged. Elsewhere, and in a release build, it is React Native's.

## Off a device

Off a device and in a release build, `available` is `false`, `add()` does nothing, and `reload()`
does nothing, because there is no shake menu to add to either way.

## Reference

<!-- api: DevMenu -->
