import { Component, signal, viewChild } from '@angular/core';
import { Text } from '@ng-native/components';
import { ExpoBlur, ExpoBlurTarget } from '@ng-native/expo';

/** A blur over a target it samples, as `expo-blur` needs on Android; the target can go. */
@Component({
  selector: 'expo-blur-target-fixture',
  imports: [ExpoBlur, ExpoBlurTarget, Text],
  template: `
    @if (shown()) {
      <expo-blur-target nativeID="target"><text>Behind</text></expo-blur-target>
    }
    <expo-blur nativeID="blur" [blurTarget]="target()" blurMethod="dimezisBlurView" />
  `,
})
export class ExpoBlurTargetFixture {
  readonly shown = signal(true);
  protected readonly target = viewChild(ExpoBlurTarget);
}
