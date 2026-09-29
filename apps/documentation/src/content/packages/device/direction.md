---
title: Direction
summary: Which way round the world is, for the TypeScript the cascade cannot decide.
---

# Direction

`Direction` reports whether the app is laid out left-to-right or right-to-left, following the
device's locale.

```ts
import { Component, inject } from '@angular/core';
import { Direction } from '@ng-native/device';

@Component({
  selector: 'app-drawer',
  template: `<view [style.left]="direction.rtl() ? null : 0" />`,
})
export class Drawer {
  protected readonly direction = inject(Direction);
}
```

The cascade already mirrors the _paint_ for `direction: rtl` without anything being injected -
padding, text alignment and box order all flip on their own, and Yoga inherits that down the shadow
tree without anyone asking. `Direction` is for the TypeScript that computes a position outside of
CSS: resolving an `align: start` against a concrete edge, mapping a drag's x-delta onto a value,
naming which edge a panel opens from. `current` is `'ltr'` or `'rtl'`; `rtl` is the same fact as a
boolean, because most callers branch on it rather than switch.

A `direction` set in a stylesheet or an inline style also applies to a subtree, as on the web:
the row reverses, logical edges swap, and a paragraph inside starts at the subtree's start edge
whatever its script, with its base writing direction following. `text-align: start` and `end`
resolve against that direction, `left` and `right` stay on the side they name, and an explicit
`writingDirection` on a text is kept. A paragraph with no `direction` anywhere above it keeps the
platform's natural alignment, which follows the app's language.

An app can override `Direction` for a subtree with its own directive, providing a `DirectionContext`
in its place, exactly as Angular's CDK provides `Dir` in place of `Directionality`. Everything that
injects `Direction` gets whichever of the two is closest without needing to know which one it got.

## Off a device and on the web

On a device, `current` reads `I18nManager.isRTL` once and never changes: React Native settles
direction from the device's own locale while the native side starts up, and `I18nManager.forceRTL`
only takes effect after a restart, so `isRTL` cannot change under a running app - which is why
there is nothing to subscribe to on native. Off a device, where `react-native` cannot be required,
`current` is always `'ltr'`. The browser source is the exception:
`document.dir` is a mutable attribute, so a consumer should not have to know which platform it is on
to read the signal.

## Reference

<!-- api: Direction -->
