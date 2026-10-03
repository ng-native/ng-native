/**
 * A list row that swipes to show an action behind it: the recipe on the lists page, built on the
 * gesture and worklet entry points.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Component, effect, input, output, signal } from '@angular/core';
import { Gesture } from 'react-native-gesture-handler';
import { withTiming } from 'react-native-reanimated';
import { Pressable, Text, View } from '@ng-native/components';
import { NativeGesture } from '@ng-native/components/gestures';
import { WorkletStyle, sharedValue, workletStyle } from '@ng-native/components/reanimated';
import { cleanup, gestureOf, render, screen, settle, userEvent } from '@ng-native/testing';

afterEach(cleanup);

/** How far the row opens: the width of the action behind it. */
const OPEN = 88;

@Component({
  selector: 'app-swipe-row',
  imports: [NativeGesture, Pressable, Text, View, WorkletStyle],
  template: `
    <pressable
      accessibilityRole="button"
      style="position: absolute; top: 0; right: 0; bottom: 0; width: 88px"
      (press)="remove.emit()"
    >
      <text>Delete</text>
    </pressable>
    <view testID="front" [gesture]="swipe" [workletStyle]="slide"><ng-content /></view>
  `,
})
class SwipeRow {
  /** What the row shows, so a row recycled for another item closes. */
  readonly item = input.required<unknown>();
  readonly remove = output<void>();

  private readonly x = sharedValue(0);
  protected readonly slide;
  protected readonly swipe;

  constructor() {
    // Locals, since a worklet cannot close over `this`.
    const x = this.x;
    const from = sharedValue(0);
    this.slide = workletStyle([x], (offset) => {
      'worklet';
      return { transform: [{ translateX: offset.value }] };
    });
    this.swipe = Gesture.Pan()
      .activeOffsetX([-12, 12]) // a sideways drag is the row's
      .failOffsetY([-10, 10]) // a vertical one fails it, and the list scrolls
      .onBegin(() => {
        'worklet';
        from.value = x.value;
      })
      .onUpdate((event: { translationX: number }) => {
        'worklet';
        x.value = Math.min(0, Math.max(-OPEN, from.value + event.translationX));
      })
      .onEnd(() => {
        'worklet';
        x.value = withTiming(x.value < -OPEN / 2 ? -OPEN : 0);
      });
    // The list recycles a row's views for another item: close before it shows the next one.
    effect(() => {
      this.item();
      x.value = 0;
    });
  }
}

@Component({
  selector: 'app-list',
  imports: [SwipeRow, Text],
  template: `
    <app-swipe-row [item]="shown()" (remove)="removed.set(shown())">
      <text>{{ shown() }}</text>
    </app-swipe-row>
  `,
})
class List {
  readonly shown = signal('Invoice 1');
  readonly removed = signal('');
}

const offset = () =>
  (screen.getByTestId('front').props['transform'] as [{ translateX: number }])[0].translateX;
/** Drag the row by `translationX` from where it rests, and let go when `release` is set. */
async function drag(translationX: number, release = false): Promise<void> {
  const callbacks = gestureOf(screen.getByTestId('front'), 'Pan').callbacks as Record<
    string,
    (event: object) => void
  >;
  callbacks['onBegin']!({});
  callbacks['onUpdate']!({ translationX });
  if (release) callbacks['onEnd']!({});
  await settle();
}

describe('a row that swipes to show an action', () => {
  it('follows the drag, no further than the action is wide, and never to the right', async () => {
    await render(List);
    await drag(-40);
    expect(offset()).toBe(-40);
    await drag(-300);
    expect(offset()).toBe(-OPEN);
    await drag(200);
    expect(offset()).toBe(0);
  });

  it('settles open past halfway and closed short of it, and drags on from where it rests', async () => {
    await render(List);
    await drag(-60, true);
    expect(offset()).toBe(-OPEN);
    await drag(70, true);
    expect(offset()).toBe(0);
    await drag(-30, true);
    expect(offset()).toBe(0);
  });

  it('runs its action, and closes when the list gives the row another item', async () => {
    const { instance, detectChanges } = await render(List);
    await drag(-OPEN, true);
    await userEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(instance.removed()).toBe('Invoice 1');
    expect(offset()).toBe(-OPEN);

    instance.shown.set('Invoice 2');
    await detectChanges();
    await settle();
    expect(offset()).toBe(0);
  });
});
