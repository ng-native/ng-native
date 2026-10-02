/**
 * A component that animates on the UI thread, tested as an app tests it. `@ng-native/components/
 * reanimated`, `react-native-reanimated` and `react-native-worklets` reach React Native source
 * Node cannot load; `ngNative()` resolves them to stand-ins, so this imports exactly what an app
 * does.
 */
import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { interpolate, withTiming, Extrapolation } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import {
  WorkletScroll,
  WorkletStyle,
  sharedValue,
  workletScroll,
  workletStyle,
} from '@ng-native/components/reanimated';
import { fireEvent, render, screen, userEvent } from '@ng-native/testing';

@Component({
  selector: 'app-collapsing',
  imports: [Pressable, ScrollView, Text, View, WorkletScroll, WorkletStyle],
  template: `
    <view testID="banner" [workletStyle]="collapse"
      ><text>{{ closed() }}</text></view
    >
    <scroll-view testID="list" [workletScroll]="track">
      <pressable accessibilityRole="button" (press)="close()"><text>Close</text></pressable>
    </scroll-view>
  `,
})
class Collapsing {
  readonly closed = signal(0);
  private readonly offset = sharedValue(0);
  protected readonly collapse;
  protected readonly track;

  constructor() {
    const offset = this.offset;
    this.collapse = workletStyle([offset], (y) => {
      'worklet';
      return {
        height: interpolate(y.value, [0, 100], [120, 40], Extrapolation.CLAMP),
        transform: [{ translateY: -y.value / 10 }],
      };
    });
    this.track = workletScroll([offset], (event, y) => {
      'worklet';
      y.value = event.contentOffset.y;
    });
  }

  protected close(): void {
    const closed = this.closed;
    this.offset.value = withTiming(100, { duration: 200 }, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(() => closed.update((n) => n + 1));
    });
  }
}

describe('a component animated on the UI thread', () => {
  it('renders its worklet style from the shared values it reads', async () => {
    await render(Collapsing);
    expect(screen.getByTestId('banner').props['height']).toBe(120);
  });

  it('follows a scroll through a worklet scroll handler', async () => {
    await render(Collapsing);
    await fireEvent(screen.getByTestId('list'), 'scroll', { contentOffset: { x: 0, y: 50 } });
    const banner = screen.getByTestId('banner');
    expect(banner.props['height']).toBe(80);
    expect(banner.props['transform']).toEqual([{ translateY: -5 }]);
  });

  it('settles an animation at its end and runs its completion', async () => {
    await render(Collapsing);
    await userEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('banner').props['height']).toBe(40);
    expect(screen.getByText('1')).toBeTruthy();
  });
});

describe('a shared value', () => {
  it('has the surface Reanimated gives code outside a worklet', () => {
    const offset = sharedValue(1);
    const heard: number[] = [];
    offset.addListener(1, (value) => heard.push(value));
    offset.value = 2;
    offset.set((value) => value + 1);
    offset.modify((value) => value * 2);
    offset.removeListener(1);
    offset.set(0);
    expect(offset.get()).toBe(0);
    expect(heard).toEqual([2, 3, 6]);
  });
});
