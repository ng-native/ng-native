/**
 * `<expo-gl>`, typed: `expo-gl`'s view, registered with `registerExpoViews('expo-gl')`, with its
 * props as inputs so a template is checked against them. Each goes straight to the view.
 *
 * ```html
 * <expo-gl class="flex-1" msaaSamples="0" (surfaceCreate)="draw($event.nativeEvent.exglCtxId)" />
 * ```
 *
 * The view's context is reached through an event rather than a prop: `surfaceCreate` carries the
 * id `expo-gl`'s own `GLView` hands to its context.
 */
import { Component, computed, input, output } from '@angular/core';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import { currentPlatform } from './native.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';

@Component({
  selector: 'expo-gl',
  template: '',
  host: {
    '[msaaSamples]': 'samples()',
    '[enableExperimentalWorkletSupport]': 'enableExperimentalWorkletSupport()',
  },
})
export class ExpoGL {
  /**
   * The number of samples iOS multisamples with; 0 turns it off. 4 on iOS unless set, as
   * `expo-gl`'s `GLView` sends it: the native view's own default is 0. iOS only.
   */
  readonly msaaSamples = input<number>(undefined, { transform: optionalNumber });
  /**
   * Lets a Reanimated worklet use the context. A bare attribute is true. `expo-gl` reads it once,
   * as the view is created.
   */
  readonly enableExperimentalWorkletSupport = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** The view's surface is ready, with the id of its context. */
  readonly surfaceCreate = output<NativeSyntheticEvent<{ readonly exglCtxId: number }>>();

  protected readonly samples = computed(
    () => this.msaaSamples() ?? (currentPlatform() === 'ios' ? 4 : undefined),
  );
}
