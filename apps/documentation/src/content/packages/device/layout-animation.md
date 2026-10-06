---
title: Layout animation
summary: Animating a layout change - a list insertion, a row leaving - which CSS cannot express.
---

# Layout animation

`LayoutAnimation` asks the platform to animate the next layout change rather than snapping to it,
which is React Native's own mechanism and the cheapest way to make a list insertion or a disclosure
feel deliberate.

```ts
import { Component, inject } from '@angular/core';
import { LayoutAnimation } from '@ng-native/device';

@Component({ selector: 'app-todo-list', template: `<view />` })
export class TodoList {
  private readonly layout = inject(LayoutAnimation);
  private rows: string[] = [];

  protected removeRow(id: string): void {
    void this.layout.animate(() => {
      this.rows = this.rows.filter((row) => row !== id);
    });
  }
}
```

A `transition` animates a property from one value to another, and the engine already does that
without anything here. It cannot animate a layout: when a row is removed and the rows below move up,
nothing about those rows changed - their `top` was never set, Yoga computed it, and there is no old
value to transition from. The web solves this with FLIP, measuring before and after in JavaScript;
native solves it in the shadow tree, which is where the two layouts both exist. So `animate()` is
not a nicer `transition` - it is the only way to say the thing at all.

`animate(change, options?)` takes the change to make as a function, because the two have to be
adjacent: a configured animation with nothing after it animates whatever commit happens next, which
may be an unrelated screen appearing. It resolves when the animation ends, or once the duration has
passed where the platform does not report an end, so nothing waits on it forever.

`LayoutChange` takes `duration` (300ms default), `easing` (`'spring' | 'linear' | 'easeInEaseOut' |
'easeIn' | 'easeOut' | 'keyboard'`, default `'easeInEaseOut'`; `'spring'` is the platform's own and
what a native list uses, and `'keyboard'` is the curve iOS moves its keyboard on), and
`appear`/`leave` (`'opacity' | 'scaleXY' | 'none'`, both defaulting to `'opacity'`) for what a view
appearing or leaving does.

It animates whatever the next layout pass happens to move, so it is a blunt instrument by design.
Where you want one specific property animated, a CSS `transition` or a
[worklet style](/packages/components/animation) says so precisely and costs less.

## On Android

On Android `animate()` runs the change without animating it unless the app turns layout animations
on. React Native ships them off there: its `enableLayoutAnimationsOnAndroid` feature flag is false,
and with it false the layout lands in one step. The promise still resolves once the duration has
passed.

The [`@ng-native/metro` config plugin](/packages/metro) turns the flag on when asked:

```json
// app.json
{
  "expo": {
    "plugins": [["@ng-native/metro", { "android": { "layoutAnimations": true } }]]
  }
}
```

Run `npx expo prebuild` and build the app again afterwards: the plugin writes the override into
`MainApplication.kt`, so it takes effect in a build of the app's own.

Expo Go on Android cannot animate a layout change. It is built with the flag off, and no setting in
an app changes that.

An app that writes its own `MainApplication` overrides the flag itself, after React Native has
loaded, keeping every other flag as its React Native release level sets it. This is what the plugin
writes:

```kotlin
com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(
  object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by
    when (com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.releaseLevel) {
      com.facebook.react.common.ReleaseLevel.EXPERIMENTAL ->
        com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
      com.facebook.react.common.ReleaseLevel.CANARY ->
        com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
      else ->
        com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
    } {
    override fun enableLayoutAnimationsOnAndroid(): Boolean = true
  }
)
```

iOS animates with no setup, in Expo Go as well.

## Off a device

Off a device `animate()` still runs the change and resolves, it just never asks anything to animate,
because there is no `LayoutAnimation` module underneath it.

## Reference

<!-- api: LayoutAnimation -->
