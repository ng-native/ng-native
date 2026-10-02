---
title: Gestures
summary: react-native-gesture-handler's pans, pinches and rotations, without React.
art: gestures
---

# Gestures

`react-native-gesture-handler`'s gestures are recognized by the platform itself - a real
`UIPanGestureRecognizer`, a real Android `GestureDetector` - rather than by this package's own
touch handling (see the [pressable page](/packages/components/pressable)), which is what lets a
pinch, a rotation, or a pan that cooperates correctly with a scroll view exist at all. Build a
gesture with the library's own `Gesture` API and attach it with the `[gesture]` directive:

```ts
import { Component, signal } from '@angular/core';
import { Gesture } from 'react-native-gesture-handler';
import { View } from '@ng-native/components';
import { NativeGesture } from '@ng-native/components/gestures';
import { WorkletStyle, sharedValue, workletStyle } from '@ng-native/components/reanimated';

@Component({
  selector: 'app-draggable',
  imports: [View, NativeGesture, WorkletStyle],
  template: '<view testID="box" [gesture]="pan" [workletStyle]="slide"></view>',
})
export class Draggable {
  private readonly x = sharedValue(0);
  protected readonly slide = workletStyle([this.x], (x) => {
    'worklet';
    return { transform: [{ translateX: x.value }] };
  });
  protected readonly pan: ReturnType<typeof Gesture.Pan>;

  constructor() {
    // Captured into a local before the worklet is built - see the note below.
    const x = this.x;
    this.pan = Gesture.Pan().onUpdate((event) => {
      'worklet';
      x.value = event.translationX;
    });
  }
}
```

## Installing

The gestures need three native libraries, installed at the versions this Expo SDK expects:

```sh
npx expo install react-native-gesture-handler react-native-reanimated react-native-worklets
```

They are native code, so rebuild the development build afterwards (`npx expo run:ios` or
`npx expo run:android`); Expo Go already includes them. Then restart Metro. Installing
`react-native-worklets` or `react-native-reanimated` adds the worklets plugin to every file Babel
compiles, and the Metro preset keys its cache on the two packages' versions, so a restarted Metro
compiles everything afresh by itself. A Metro that was already running when they were installed
keeps the Babel setup it started with, and serves files without their worklets until it is
restarted.

## The gesture root

The whole app needs to sit inside one `<gesture-root>`, once, the way it would need
`GestureHandlerRootView` in a React Native app:

```html
<gesture-root>
  <router-outlet />
</gesture-root>
```

It is a different native view on each platform, and that is the library's own split:
`RNGestureHandlerRootView` is an Android view group that intercepts touches before the rest of the
tree sees them; on iOS the recognizers hang off the target view itself, so `<gesture-root>`
renders a plain view there instead.

## Imports come from their own file

`Gesture`, `Animated` and Reanimated's worklets each reach into React Native's own uncompiled
source, which Node cannot parse, so the test suite that runs this package's own code under Node
would break if the main entry point tried to load them. Import these from their own files -
`@ng-native/components/gestures`, `@ng-native/components/animations`,
`@ng-native/components/reanimated` - covered on the gestures and
[animation](/packages/components/animation) pages.

## A gesture inside a scroll view that moves the same way

A vertical `<scroll-view>` or `<virtual-list>` leaves a sideways pan to the gesture inside it. A
scroll view that also moves sideways, such as a pager, takes the drag first: a row that swipes to
delete inside a horizontal pager never sees its swipe. Give the scroll view its own
`Gesture.Native()` and have the row's pan block it, failing the pan as soon as the drag goes the
way the pager should have it:

```ts
protected readonly pager = Gesture.Native();
```

```html
<scroll-view [horizontal]="true" [pagingEnabled]="true" [gesture]="pager">...</scroll-view>
```

```ts
const swipe = Gesture.Pan()
  .activeOffsetX(-12) // a drag to the left swipes the row
  .failOffsetX(12) // a drag to the right fails it, and the pager takes it
  .failOffsetY([-10, 10]) // so does a vertical one, and the list scrolls
  .blocksExternalGesture(pager);
```

Without `failOffsetX` the pager waits for a pan that never fails, and does not page at all.

## Testing a component with gestures

Under the documented Vitest setup, `ngNative()` resolves `@ng-native/components/gestures` and
`react-native-gesture-handler` to stand-ins, because the real ones reach React Native source Node
cannot load. A root component wrapped in `<gesture-root>`, and any screen with a `[gesture]`,
render and take presses as they would without them: `<gesture-root>` renders a plain view and
`[gesture]` keeps its view uncollapsed, with no recognizer attached. `Gesture.Pan()` and the other
builders take any configuration call and keep the callbacks they were given on `callbacks`, so a
test of what a gesture does calls one directly. `gestureOf` finds the gesture on a view, or the one
of a kind inside a composed gesture such as `Gesture.Race(pan, tap)`, which is how a test reaches
a gesture a row component built for itself:

```ts
import { gestureOf, render, screen } from '@ng-native/testing';

await render(Draggable);
gestureOf(screen.getByTestId('box'), 'Pan').callbacks['onUpdate']!({ translationX: 40 });
```

The worklets a gesture drives are stood in for too: see
[the testing setup](/packages/testing/setup).

## Callbacks must not close over `this`

A callback passed to a gesture must not read `this`. The library's Babel plugin rewrites every
gesture callback into a worklet whether or not it ends up running on the UI thread, and a worklet
captures only its own free variables, sent to the UI thread once when the worklet is created.
Writing `this.x.value = ...` directly inside the callback above would close over `this` - the
whole component, every signal and the injector along with it - rather than the one shared value
that matters, which is why `x` is pulled into a local first.

<!-- api: NativeGesture -->

<!-- api: GestureRoot -->
