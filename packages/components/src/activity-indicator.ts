import { Directive, computed, input } from '@angular/core';
import { nativePlatform } from '@ng-native/fabric';
import type { ControlSize } from '@ng-native/device';
import { optionalBoolean } from './transforms.ts';
import { ViewBase } from './view-base.ts';

/**
 * A spinner. Commits as `ActivityIndicatorView` on iOS and `AndroidProgressBar` on Android.
 *
 * RN's wrapper gives the native view an explicit size: the native component has no intrinsic
 * dimensions, so without one it stretches to fill whatever space its parent offers. That
 * failure is invisible, since the spinner still draws at its natural size in the middle of the
 * stretched box, but the box swallows gestures across its whole width.
 */
@Directive({
  selector: 'activity-indicator',
  host: {
    '[style]': 'sizeStyle()',
    '[size]': 'nativeSize()',
    '[controlSize]': 'controlSize()',
    '[animating]': 'animating()',
    '[color]': 'color()',
    '[hidesWhenStopped]': 'hidesWhenStopped()',
    '[styleAttr]': 'styleAttr',
    '[indeterminate]': 'indeterminate',
  },
})
export class ActivityIndicator extends ViewBase {
  /** `small` and `large` match RN's 20 and 36 points; a number sets both dimensions. */
  readonly size = input<'small' | 'large' | number>('small');
  /** AppKit's control size on macOS, and UIKit's on iOS 26 and later. Ignored elsewhere. */
  readonly controlSize = input<ControlSize>();
  /** Whether the spinner turns. Defaults to true. */
  readonly animating = input(undefined, { transform: optionalBoolean });
  /** The spinner's colour. */
  readonly color = input<string>();
  /** iOS: hide the spinner when `animating` is false rather than showing it still. */
  readonly hidesWhenStopped = input(undefined, { transform: optionalBoolean });

  protected readonly nativeSize = computed(() => (this.size() === 'large' ? 'large' : 'small'));

  /**
   * Android only, and not optional there.
   *
   * `AndroidProgressBar` picks its drawable from `styleAttr`, and has no default: the native view
   * throws `setStyle() not called` out of its own update pass if the first commit arrives without
   * one, which takes the whole screen down. RN's wrapper sends `Normal` for every size and lets
   * the box above do the sizing, so this sends the same rather than mapping `large` onto
   * `progressBarStyleLarge` and diverging. `indeterminate` is required by the same spec.
   *
   * Both stay `undefined` on iOS, where `ActivityIndicatorView` has neither prop and an undefined
   * input never reaches native.
   */
  protected readonly styleAttr = nativePlatform() === 'android' ? 'Normal' : undefined;
  protected readonly indeterminate = nativePlatform() === 'android' ? true : undefined;

  protected readonly sizeStyle = computed(() => {
    const size = this.size();
    if (typeof size === 'number') return { width: size, height: size };
    return size === 'large' ? { width: 36, height: 36 } : { width: 20, height: 20 };
  });
}
