---
title: Keyboard
summary: The software keyboard's height, position and animation timing.
---

# Keyboard

`Keyboard` reports the software keyboard's height, where its top edge is, and how long its
animation takes - useful for a view that has to move with it - and it stays subscribed for the life
of the app, so a component that mounts mid-gesture gets the height that is already true rather than
waiting for the next change. The subscription is removed when the app is destroyed.

```ts
import { Component, computed, inject } from '@angular/core';
import { Keyboard } from '@ng-native/device';

@Component({
  selector: 'app-composer',
  template: `<view [style.marginBottom]="clearance()" />`,
})
export class Composer {
  private readonly keyboard = inject(Keyboard);
  protected readonly clearance = computed(() => this.keyboard.height() + 16);
}
```

`metrics` is everything the platform said, for a layout that needs the animation `duration` or
`easing` too. `height` and `visible` are the common case, derived from `metrics`. `dismiss()` puts
the keyboard away, as tapping outside a field would.

## When it changes

The metrics change when React Native's own `KeyboardAvoidingView` would move, which is not the same
moment on both platforms.

- **iOS**: as the keyboard starts to move, from `keyboardWillShow`, `keyboardWillHide` and
  `keyboardWillChangeFrame`. Each carries the keyboard's `duration` and `easing`, usually
  `'keyboard'`, the curve iOS moves it on, so a layout configured from them moves with the keyboard
  rather than after it. A hide carries its timing too: `{ height: 0, duration, easing }`. A frame
  change while the keyboard is up, such as the predictive bar appearing, reports the new size.
- **Android**: once the keyboard has arrived, from `keyboardDidShow` and `keyboardDidHide`, because
  Android sends no Will events. `easing` is always `'keyboard'` with a `duration` of zero: the
  platform animates its own keyboard, and nothing here should try to animate alongside it.

To move with the keyboard on iOS, hand its timing to
[`LayoutAnimation`](/packages/device/layout-animation) before the change it causes, which is what
`<keyboard-avoiding-view>` does:

```ts
import { Component, effect, inject, signal } from '@angular/core';
import { Keyboard, LayoutAnimation, type LayoutEasing } from '@ng-native/device';

@Component({
  selector: 'app-composer',
  template: `<view [style.marginBottom]="clearance()" />`,
})
export class Composer {
  private readonly keyboard = inject(Keyboard);
  private readonly layoutAnimation = inject(LayoutAnimation);
  protected readonly clearance = signal(16);

  constructor() {
    effect(() => {
      const { height, duration, easing } = this.keyboard.metrics();
      const move = () => this.clearance.set(height + 16);
      if (!duration) return move();
      void this.layoutAnimation.animate(move, {
        duration,
        easing: easing as LayoutEasing,
        appear: 'none',
        leave: 'none',
      });
    });
  }
}
```

## Off a device and on the web

Off a device `metrics` stays at `{ height: 0 }` forever and `dismiss()` does nothing, because there
is no `Keyboard` module underneath it. There is no software keyboard concept on the web in the same
shape; `Keyboard` is a native-only service.

## Reference

<!-- api: Keyboard -->
