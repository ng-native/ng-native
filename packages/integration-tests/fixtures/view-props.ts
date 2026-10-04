import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { Switch } from '../../components/src/switch.ts';
import { TextInput } from '../../components/src/text-input.ts';

@Component({
  selector: 'x-view-props',
  imports: [View],
  template: `
    <view
      testID="root"
      aria-label="hello"
      aria-hidden="true"
      aria-valuenow="3"
      collapsable="false"
      [pointerEvents]="pointer()"
      [accessibilityState]="{ selected: true }"
      aria-busy="true"
      focusable="true"
      [hitSlop]="10"
    >
      <view testID="plain"></view>
    </view>
  `,
})
export class ViewProps {
  readonly pointer = signal<'auto' | 'none'>('none');
}

/**
 * Android's ripple, in both places it can be painted. The colour is written the way an app writes
 * one - a CSS string - so the test can watch it go through `processColor`.
 */
@Component({
  selector: 'x-ripple-props',
  imports: [Pressable, TextInput],
  template: `
    <text-input testID="field"></text-input>
    <pressable testID="behind" [android_ripple]="{ color: '#ff0000' }"></pressable>
    <pressable
      testID="over"
      [android_ripple]="{ color: '#00ff00', foreground: true, borderless: true, radius: 12 }"
    ></pressable>
    <pressable testID="none"></pressable>
  `,
})
export class RippleProps {}

/**
 * A switch's per-state track colours, written the way an app writes one so the test can watch
 * them go through `processColor`.
 */
@Component({
  selector: 'x-track-color-props',
  imports: [Switch],
  template: `
    <switch
      testID="toggle"
      [checked]="true"
      [trackColor]="{ false: '#cccccc', true: '#0a7cff' }"
      thumbColor="#ffffff"
    ></switch>
  `,
})
export class TrackColorProps {}
