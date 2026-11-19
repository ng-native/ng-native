/**
 * `<expo-live-photo>`, typed: `expo-live-photo`'s view, registered with
 * `registerExpoViews('expo-live-photo')`, with its props as inputs so a template is checked
 * against them. Each goes straight to the view. iOS only: the module has no view elsewhere.
 *
 * ```html
 * <expo-live-photo class="aspect-square" [source]="photo()" isMuted contentFit="cover" />
 * ```
 */
import { Component, input, output } from '@angular/core';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import { optionalBoolean } from './transforms.ts';

/** A live photo: the photo and the video paired with it, unaltered from the same capture. */
export interface LivePhotoAsset {
  readonly photoUri: string;
  readonly pairedVideoUri: string;
}

@Component({
  selector: 'expo-live-photo',
  template: '',
  host: {
    '[source]': 'source()',
    '[isMuted]': 'isMuted()',
    '[contentFit]': 'contentFit()',
    '[useDefaultGestureRecognizer]': 'useDefaultGestureRecognizer()',
  },
})
export class ExpoLivePhoto {
  readonly source = input<LivePhotoAsset | null>();
  /** Plays the video without its sound. A bare attribute is true. */
  readonly isMuted = input<boolean>(undefined, { transform: optionalBoolean });
  /** `contain` unless set. */
  readonly contentFit = input<'contain' | 'cover'>();
  /** Plays the video while the photo is pressed and held, as Photos does. True unless set. */
  readonly useDefaultGestureRecognizer = input<boolean>(undefined, { transform: optionalBoolean });
  readonly loadStart = output<NativeSyntheticEvent<Record<string, never>>>();
  readonly previewPhotoLoad = output<NativeSyntheticEvent<Record<string, never>>>();
  readonly loadComplete = output<NativeSyntheticEvent<Record<string, never>>>();
  readonly loadError = output<NativeSyntheticEvent<{ readonly message: string }>>();
  readonly playbackStart = output<NativeSyntheticEvent<Record<string, never>>>();
  readonly playbackStop = output<NativeSyntheticEvent<Record<string, never>>>();
}
