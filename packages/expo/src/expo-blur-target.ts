/**
 * `<expo-blur-target>`: what an `<expo-blur>` blurs on Android, as `expo-blur`'s `BlurTargetView`.
 * Put the content to blur in it and pass it to the blur's `[blurTarget]`. It is `expo-blur`'s
 * target view on Android, registered with `registerExpoViews('expo-blur-target')`, and a plain view
 * elsewhere, as `BlurTargetView` is.
 *
 * ```html
 * <expo-blur-target #behind class="absolute inset-0"><image [source]="photo" /></expo-blur-target>
 * <expo-blur class="absolute inset-0" [blurTarget]="behind" blurMethod="dimezisBlurView" />
 * ```
 */
import { Component, ElementRef, inject } from '@angular/core';
import type { EngineNode } from '@ng-native/fabric';

@Component({ selector: 'expo-blur-target', template: '<ng-content />' })
export class ExpoBlurTarget {
  /** The view the blur samples. */
  readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;
}
