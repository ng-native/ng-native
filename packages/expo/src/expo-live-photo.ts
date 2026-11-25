/**
 * `<expo-live-photo>`, typed: `expo-live-photo`'s view, registered with
 * `registerExpoViews('expo-live-photo')`, with its props as inputs so a template is checked
 * against them. Each goes straight to the view. iOS only: the module has no view elsewhere.
 *
 * ```html
 * <expo-live-photo class="aspect-square" [source]="photo()" isMuted contentFit="cover" />
 * ```
 */
import { Component, ElementRef, InjectionToken, inject, input, output } from '@angular/core';
import { Engine, type EngineNode, type NativeSyntheticEvent } from '@ng-native/fabric';
import { callViewFunction, viewFunctions } from './native.ts';
import { optionalBoolean } from './transforms.ts';

/** How `startPlayback` plays: the whole video, or the short hint Photos plays. */
export type LivePhotoPlaybackStyle = 'full' | 'hint';

/** `expo-live-photo`'s view functions, which its `LivePhotoView` ref has. */
export interface LivePhotoViewFunctions {
  startPlayback(playbackStyle?: LivePhotoPlaybackStyle): unknown;
  stopPlayback(): unknown;
}

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
  /** The view's functions. Overridden in a test. */
  static readonly SOURCE = new InjectionToken<LivePhotoViewFunctions | null>(
    'angular-native.livePhotoViewSource',
    {
      factory: () =>
        viewFunctions<LivePhotoViewFunctions>('expo-live-photo', 'ExpoLivePhoto', 'LivePhotoView', [
          'ios',
        ]),
    },
  );

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

  private readonly functions = inject(ExpoLivePhoto.SOURCE);
  private readonly engine = inject(Engine);
  private readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;

  /**
   * Play the photo's video, `full` unless set, as `LivePhotoView`'s ref does. Nothing without the
   * module, or before the view reaches the screen.
   */
  startPlayback(playbackStyle?: LivePhotoPlaybackStyle): Promise<void> {
    return callViewFunction(
      this.functions,
      'startPlayback',
      this.engine.tagOf(this.node),
      ...(playbackStyle === undefined ? [] : [playbackStyle]),
    );
  }

  stopPlayback(): Promise<void> {
    return callViewFunction(this.functions, 'stopPlayback', this.engine.tagOf(this.node));
  }
}
