---
title: Animation
summary: Plain CSS, AnimatedStyle, and Reanimated worklets - and when to reach for each.
art: animation
---

# Animation

There are three separate ways to animate something here, and which one to reach for depends on
where the work needs to happen.

## Plain CSS

This needs nothing from this package at all: a component's own `styles` can use `transition` and
`@keyframes` exactly as they read on the web, compiled into the native stylesheet at build time.
`<touchable-opacity>`'s own press fade is built this way. This is the right choice for anything
that only needs to ease between states a class change already describes.

```ts
import { Component } from '@angular/core';
import { View } from '@ng-native/components';

@Component({
  selector: 'app-pulsing-dot',
  imports: [View],
  template: `<view class="dot"></view>`,
  styles: `
    @keyframes pulse {
      0%,
      100% {
        opacity: 0.25;
      }
      50% {
        opacity: 1;
      }
    }
    .dot {
      width: 12px;
      height: 12px;
      background-color: #3b6ef5;
      animation: pulse 900ms ease-in-out infinite;
    }
  `,
})
export class PulsingDot {}
```

A pulse that eases back down can also say so with `animation-direction`: `alternate`, `reverse`
and `alternate-reverse` compile and play as in CSS. Keyframes of just `from` and `to`, played with
`animation: pulse 450ms ease-in-out infinite alternate`, do what the `0%, 100%` and `50%` steps
above do.

## AnimatedStyle

`AnimatedStyle`, from `@ng-native/components/animations`, drives React Native's own
`Animated` graph directly - `Animated.Value`, `Animated.timing`, `Animated.spring`, interpolation,
all of it, since none of that machinery is React to begin with. Import `Animated` and `Easing` from
the same file, and bind `[animatedStyle]` to a style object built from `Animated` nodes:

```ts
import { Component } from '@angular/core';
import { View } from '@ng-native/components';
import { Animated, AnimatedStyle } from '@ng-native/components/animations';

@Component({
  selector: 'app-fade-in',
  imports: [View, AnimatedStyle],
  template: `<view [animatedStyle]="{ opacity: this.opacity }"></view>`,
})
export class FadeIn {
  private readonly opacity = new Animated.Value(0);
  constructor() {
    Animated.timing(this.opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }
}
```

With `useNativeDriver: true` the whole animation runs on the UI thread and this directive hands
over the element's native tag once, doing nothing per frame; without it, every frame runs in
JavaScript and gets written to the node from there.

The same component animates in a browser. A web build resolves that import to a React-free
`Animated` with the same names and React Native's own timing, spring, easing and interpolation
formulas, stepped by `requestAnimationFrame`. There every value is driven from JavaScript, so
`useNativeDriver` changes nothing; `Value`, `timing`, `spring`, `sequence`, `parallel`, `delay`,
`interpolate` and `Easing` are there, and decay, loops, `ValueXY` and `Animated.event` are not.

<!-- api: AnimatedStyle -->

## Reanimated worklets

`WorkletStyle` and `WorkletScroll`, from `@ng-native/components/reanimated`, are for
anything that needs to compute a style on every frame without ever touching the JavaScript thread

- a value that follows a gesture, or a header that shrinks as a list scrolls. `sharedValue` creates
  a value both the JavaScript and UI runtimes can see; `workletStyle` describes a style computed
  from one or more shared values, bound to an element with `[workletStyle]`; `workletScroll`
  describes a worklet that runs on every scroll frame, bound with `[workletScroll]`. A shared value
  that `[workletScroll]` writes and `[workletStyle]` elsewhere reads means the two never involve the
  JavaScript thread at all:

```ts
import { Component } from '@angular/core';
import { ScrollView, View } from '@ng-native/components';
import {
  sharedValue,
  workletScroll,
  workletStyle,
  WorkletScroll,
  WorkletStyle,
} from '@ng-native/components/reanimated';

@Component({
  selector: 'app-parallax-header',
  imports: [ScrollView, View, WorkletScroll, WorkletStyle],
  template: `
    <scroll-view [workletScroll]="onScroll">
      <view [workletStyle]="header"></view>
      <ng-content />
    </scroll-view>
  `,
})
export class ParallaxHeader {
  private readonly offset = sharedValue(0);
  protected readonly onScroll = workletScroll([this.offset], (event, offset) => {
    'worklet';
    offset.value = event.contentOffset.y;
  });
  protected readonly header = workletStyle([this.offset], (offset) => {
    'worklet';
    return { height: Math.max(80, 200 - offset.value) };
  });
}
```

Every value a worklet reads has to be passed to `workletStyle` or `workletScroll` as one of the
values in its first argument, and read from the function's own parameters - not closed over from
`this`. A worklet's closure is captured by value when it is created and sent to the other runtime,
so a function that read `this.offset` instead of a passed-in `offset` parameter would try to send
the entire component along with it.

In a browser build both directives are inert: the template renders and no worklet runs, and
`sharedValue` is a plain holder. [What does not carry over](/packages/web/limits) has the details.

<!-- api: WorkletStyle -->

<!-- api: WorkletScroll -->
