/**
 * A component that animates with `AnimatedStyle`, tested as an app tests it. The real
 * `@ng-native/components/animations` reaches React Native's `Libraries/Animated`, Flow source Node
 * cannot load; `ngNative()` resolves it to a stand-in, so this imports exactly what an app does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { View } from '@ng-native/components';
import { Animated, AnimatedStyle, Easing } from '@ng-native/components/animations';
import { cleanup, render, screen } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'app-fade',
  imports: [View, AnimatedStyle],
  template: `<view testID="box" [animatedStyle]="{ opacity: fade, width: grow }"></view>`,
})
class Fade {
  readonly fade = new Animated.Value(0);
  readonly grow = this.fade.interpolate({ inputRange: [0, 1], outputRange: [10, 50] });
  readonly ended = signal<boolean | null>(null);

  constructor() {
    Animated.timing(this.fade, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => this.ended.set(finished));
  }
}

describe('a component animated with AnimatedStyle', () => {
  it('loads, and shows the value a timing animation ends on', async () => {
    const { fixture } = await render(Fade);
    expect(screen.getByTestId('box').props).toMatchObject({ opacity: 1, width: 50 });
    expect(fixture.componentInstance.ended()).toBe(true);
  });

  it('settles a spring, a sequence and a parallel at once', async () => {
    const value = new Animated.Value(0);
    const other = new Animated.Value(0);
    const done: boolean[] = [];
    Animated.sequence([
      Animated.delay(1000),
      Animated.spring(value, { toValue: 5, useNativeDriver: false }),
      Animated.parallel([
        Animated.timing(value, { toValue: 7, duration: 900, useNativeDriver: false }),
        Animated.timing(other, { toValue: 2, duration: 900, delay: 400, useNativeDriver: false }),
      ]),
    ]).start(({ finished }) => done.push(finished));
    expect(done).toEqual([true]);
    const landed: number[] = [];
    value.stopAnimation((v) => landed.push(v));
    other.stopAnimation((v) => landed.push(v));
    expect(landed).toEqual([7, 2]);
  });

  it('follows a value set afterwards', async () => {
    const { fixture } = await render(Fade);
    fixture.componentInstance.fade.setValue(0.5);
    expect(screen.getByTestId('box').props).toMatchObject({ opacity: 0.5, width: 30 });
  });
});
