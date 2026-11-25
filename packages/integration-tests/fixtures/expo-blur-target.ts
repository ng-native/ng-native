import { Component, signal, viewChild } from '@angular/core';
import { Text } from '@ng-native/components';
import { ExpoBlur, ExpoBlurTarget } from '@ng-native/expo';

const template = `
  @if (shown()) {
    <expo-blur-target nativeID="target" [style.display]="hidden() ? 'none' : 'flex'">
      <text>Behind</text>
    </expo-blur-target>
  }
  <expo-blur nativeID="blur" [blurTarget]="target()" blurMethod="dimezisBlurView" />
`;

/** A blur over a target it samples, as `expo-blur` needs on Android; the target can go. */
@Component({
  selector: 'expo-blur-target-fixture',
  imports: [ExpoBlur, ExpoBlurTarget, Text],
  template,
})
export class ExpoBlurTargetFixture {
  readonly shown = signal(true);
  readonly hidden = signal(false);
  protected readonly target = viewChild(ExpoBlurTarget);
}

/** The same with the target hidden from the start, so it has no view to tag until it is shown. */
@Component({
  selector: 'expo-blur-hidden-target-fixture',
  imports: [ExpoBlur, ExpoBlurTarget, Text],
  template,
})
export class ExpoBlurHiddenTargetFixture {
  readonly shown = signal(true);
  readonly hidden = signal(true);
  protected readonly target = viewChild(ExpoBlurTarget);
}
