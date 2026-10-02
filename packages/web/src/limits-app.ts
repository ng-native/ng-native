/**
 * Fixture for `browser/limits.test.ts`: the worklet and gesture directives an app imports, on a
 * page, as a web build meets them. See `button-app.ts`'s doc comment for why a real `@Component`
 * has to live in its own file rather than inside a test.
 */
import { Component } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { GestureRoot, NativeGesture } from '@ng-native/components/gestures';
import {
  WorkletScroll,
  WorkletStyle,
  sharedValue,
  workletScroll,
  workletStyle,
} from '@ng-native/components/reanimated';

@Component({
  selector: 'app-root',
  imports: [View, Text, ScrollView, GestureRoot, NativeGesture, WorkletStyle, WorkletScroll],
  template: `
    <view style="height: 300px">
      <gesture-root id="root">
        <view id="target" [gesture]="pan" [workletStyle]="slide">
          <text id="label">Drag me</text>
        </view>
        <scroll-view [workletScroll]="track"></scroll-view>
      </gesture-root>
    </view>
  `,
})
export class WorkletApp {
  private readonly offset = sharedValue(0);
  protected readonly pan = {};
  protected readonly slide = workletStyle([this.offset], (offset) => ({
    transform: [{ translateX: offset.value }],
  }));
  protected readonly track = workletScroll([this.offset], (event, offset) => {
    offset.value = event.contentOffset.y;
  });
}
