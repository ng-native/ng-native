/**
 * `<expo-blur>`, typed: `expo-blur`'s view, registered with `registerExpoViews('expo-blur')`,
 * with its props as inputs so a template is checked against them. Each goes straight to the view.
 * The registration sets `intensity` to 50 and `tint` to `default`, as `expo-blur`'s React
 * component does, and an input left unset keeps them.
 *
 * ```html
 * <expo-blur class="absolute inset-0" tint="dark" intensity="80" />
 * ```
 *
 * On Android the view on its own draws its tint, not a blur: `expo-blur` blurs there only the
 * content of a `BlurTargetView` it is given, which this does not cover.
 */
import { Component, input } from '@angular/core';
import { optionalNumber } from './transforms.ts';

/** The tints `expo-blur` takes. Each but `default` adds a translucent colour over the blur. */
export type BlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'extraLight'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark';

/** How Android draws the blur. `none`, its default, draws a translucent view instead. */
export type BlurMethod = 'none' | 'dimezisBlurView' | 'dimezisBlurViewSdk31Plus';

@Component({
  selector: 'expo-blur',
  template: '<ng-content />',
  host: {
    '[tint]': 'tint()',
    '[intensity]': 'intensity()',
    '[blurReductionFactor]': 'blurReductionFactor()',
    '[blurMethod]': 'blurMethod()',
  },
})
export class ExpoBlur {
  readonly tint = input<BlurTint>();
  /** From 1 to 100. */
  readonly intensity = input<number>(undefined, { transform: optionalNumber });
  /** What Android divides the intensity by, to match iOS more closely. Android only. */
  readonly blurReductionFactor = input<number>(undefined, { transform: optionalNumber });
  /** Android only. */
  readonly blurMethod = input<BlurMethod>();
}
