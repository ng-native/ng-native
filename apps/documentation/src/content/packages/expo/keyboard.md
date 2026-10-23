---
title: Keyboard motion
summary: Follow the keyboard on Android as it moves, rather than jumping to where it is going.
---

# Keyboard motion

`provideNativeKeyboard()` gives Android what iOS already reports: the keyboard's motion, as it
starts and at every frame of it, from this package's native half.

React Native on Android reports the keyboard once the window's insets have changed, as it starts to
move, and says only where it is going. A `<keyboard-avoiding-view>` jumps there, and a
`<keyboard-dock>` jumps onto the keyboard's resting place, while the keyboard slides up underneath
and leaves a gap. With this provider:

- a [`<keyboard-dock>`](/packages/components/keyboard-avoiding-view#a-bar-that-rides-the-keyboard)
  and the content its `[keyboardLift]` moves follow the keyboard on the native side, every frame,
  as they do on iOS with react-native-keyboard-controller;
- a [`<keyboard-avoiding-view>`](/packages/components/keyboard-avoiding-view#animation) follows it
  frame by frame, from
  [`Keyboard.position`](/packages/device/keyboard#following-the-keyboard-frame-by-frame);
- [`Keyboard.metrics`](/packages/device/keyboard) carries the motion's duration, with `'easeOut'`,
  Android's own curve.

## Install

Nothing beyond this package: the native module is part of it, so it needs a development build.

```ts
import { provideNativeKeyboard } from '@ng-native/expo/keyboard';

export const appConfig = { providers: [provideNativeKeyboard() /* ... */] };
```

On iOS it provides nothing of its own, and the keyboard is what React Native reports there; a dock
follows it with `provideKeyboardController()` from `@ng-native/components`. Both can be in the same
app. On Android in a build made before this package had the module, and in Expo Go, it provides
nothing either, and React Native's own events are what there is.

## How it measures

The native module watches the keyboard through Android's window insets animation, from a view of
its own at the root of the window. It applies and consumes no inset, so the app is laid out exactly
as it is without it, edge to edge, in landscape too.

A dock is moved by how far the keyboard covers the dock's own bottom edge on screen, measured at
every frame. A dock that is not at the bottom of the window rises only as far as it must, and one in
a form sheet that react-native-screens raises with the keyboard is not lifted twice. A dock in a
`<modal>` is in a window of its own, and follows that window's keyboard.

React Native's own keyboard events still arrive, and are what a modal's keyboard is reported by in
`Keyboard.metrics`. Each one waits 100 ms for the native module, and is dropped when the module has
already said the same, so a modal's keyboard reaches `Keyboard.metrics` 100 ms after React Native
reports it.
