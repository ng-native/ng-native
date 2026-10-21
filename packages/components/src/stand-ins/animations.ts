/**
 * `@ng-native/components/animations` where React Native's animation graph cannot load: a test,
 * which `ngNative()` resolves the entry point from to here.
 *
 * The real entry point reaches `react-native/Libraries/Animated`, which is Flow source that Node
 * cannot parse. This is the browser build's graph (`animated.ts`) with no frames between: an
 * animation finishes the moment it starts, its value is where it ends, and its callback is called
 * with `finished: true` at once, so a test reads the style an animation lands on. `timing`,
 * `spring` and `delay` are instant; `sequence` and `parallel` compose them as they always do.
 */
import { Directive } from '@angular/core';
import {
  Animated as graph,
  animationBackend,
  type AnimatedValue,
  type CompositeAnimation,
  type SpringConfig,
  type TimingConfig,
} from '../animated.ts';
import { AnimatedStyleBase } from '../animated-style.ts';
import { ANIMATION } from '../animation.ts';

export { Easing } from '../easing.ts';

/** A zero duration with no delay is the one timing the graph ends without asking for a frame. */
const instant = (toValue: number): TimingConfig => ({ toValue, duration: 0, delay: 0 });

export const Animated = {
  ...graph,
  timing: (value: AnimatedValue, config: TimingConfig): CompositeAnimation =>
    graph.timing(value, instant(config.toValue)),
  spring: (value: AnimatedValue, config: SpringConfig): CompositeAnimation =>
    graph.timing(value, instant(config.toValue)),
  delay: (_time: number): CompositeAnimation => graph.delay(0),
};

@Directive({
  selector: '[animatedStyle]',
  providers: [{ provide: ANIMATION, useValue: animationBackend }],
})
export class AnimatedStyle extends AnimatedStyleBase {}
