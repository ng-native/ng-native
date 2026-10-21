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
import { View } from '@ng-native/components';
import { Keyboard } from '@ng-native/device';

@Component({
  selector: 'app-composer',
  imports: [View],
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
- **Android**: from `keyboardDidShow` and `keyboardDidHide`, because Android sends no Will events.
  They arrive once the window's insets have changed, which is as the keyboard starts to move, not
  once it has stopped, and they say only where it is going: `easing` is `'keyboard'` with a
  `duration` of zero. A layout that moves on them jumps there while the keyboard slides.
  `provideNativeKeyboard()` from [`@ng-native/expo/keyboard`](/packages/expo/keyboard) reports the
  motion as it starts, with Android's duration and `'easeOut'`, and every frame of it in
  `position`.

To move with the keyboard on iOS, hand its timing to
[`LayoutAnimation`](/packages/device/layout-animation) before the change it causes, which is what
`<keyboard-avoiding-view>` does:

```ts
import { Component, effect, inject, signal } from '@angular/core';
import { View } from '@ng-native/components';
import { Keyboard, LayoutAnimation, type LayoutEasing } from '@ng-native/device';

@Component({
  selector: 'app-composer',
  imports: [View],
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

## Following the keyboard frame by frame

`position` is where the keyboard is now. Where the platform reports the keyboard's motion,
`followsMotion` is true and `position` changes at every frame of it, starting where the keyboard
was and ending where `metrics` said it would; elsewhere it is `metrics`.

Android animates no layout alongside the keyboard unless an app turns React Native's layout
animations on, so there a layout that should move with the keyboard reads `position` instead of
animating to `metrics`. `<keyboard-avoiding-view>` reads it, and configures no layout animation
where `followsMotion` is true:

```ts
const keyboard = inject(Keyboard);
const clearance = computed(() => keyboard.position().height);
```

A frame moves the layout from JavaScript, a commit at a time, so it lands a frame or two after the
keyboard. A bar that should stay on the keyboard exactly belongs in a
[`<keyboard-dock>`](/packages/components/keyboard-avoiding-view#a-bar-that-rides-the-keyboard),
which native moves.

## Off a device and on the web

Off a device `metrics` stays at `{ height: 0 }` forever and `dismiss()` does nothing, because there
is no `Keyboard` module underneath it. There is no software keyboard concept on the web in the same
shape; `Keyboard` is a native-only service.

## Reference

<!-- api: Keyboard -->
