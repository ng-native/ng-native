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
the keyboard away, as tapping outside a field would: the `text-input` that has the focus is sent
`blur`, which on iOS resigns it as first responder and on Android clears its focus and hides the
keyboard. A view or a pressable that has the focus, from a hardware keyboard or a D-pad, holds no
keyboard and is left as it is. A `search-field` or an `@expo/ui` text field does not tell the
engine it has the focus, so `dismiss()` does not put its keyboard away. Call it while that field is
still on screen. Once its view has been removed there is nothing left
to send `blur` to, and Android, unlike iOS, does not take the keyboard down with the field.

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

## Comparing the keyboard with a view

`metrics().screenY` is the keyboard's top edge from the top of the screen, on both platforms. A
view's frame from `measureInWindow` is counted from the top of the window, and the two are not
always the same place:

- **iOS**: the window starts at the top of the screen, and `windowTop` is zero.
- **Android**: when React Native's edge-to-edge flag is off, React Native measures from below the
  status bar, even in an app that draws under the bar. Expo Go draws under the bar with the flag
  off. `windowTop` is then the status bar's height, and zero when the flag is on. It is read
  from the window's current insets on each access, so it follows a rotation.
- **Android, in the lower half of a split screen or in a freeform window**: the app's window itself
  starts below the top of the screen, and `windowTop` adds how far with
  [`provideNativeKeyboard()`](/packages/expo/keyboard) from `@ng-native/expo`. React Native has no
  way to read it, so in Expo Go, or without that provider, `windowTop` leaves it out.

Take `windowTop` off `screenY` to have the keyboard's top in the window a view was measured in.
`<keyboard-avoiding-view>`, `<keyboard-dock>` and a `<text-input>` focused with the keyboard up
already do; without it, each comes up short by the status bar's height on Android.

```ts
const keyboard = inject(Keyboard);
const top = computed(() => {
  const { screenY } = keyboard.metrics();
  return screenY === undefined ? undefined : screenY - keyboard.windowTop;
});
```

## Off a device and on the web

Off a device `metrics` stays at `{ height: 0 }` forever, because there is no `Keyboard` module
underneath it. `dismiss()` still blurs the focused field, so a test can see it sent as a `blur`
command in the fake Fabric's `commands`. There is no software keyboard concept on the web in the
same shape; `Keyboard` is a native-only service. Called on the web all the same, `dismiss()` blurs
a focused `text-input` and leaves the focus on anything else, such as the button that was clicked.

## Reference

<!-- api: Keyboard -->
