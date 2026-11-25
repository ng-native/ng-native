/**
 * `<expo-video>`, typed: `expo-video`'s view, registered with `registerExpoViews('expo-video')`,
 * with its props as inputs so a template is checked against them. Each goes straight to the view,
 * but `player`: the view takes the player's shared-object id, as `expo-video`'s own `VideoView`
 * passes it, so a `videoPlayer()` is committed as its `id`, and a number as it is.
 *
 * ```html
 * <expo-video class="flex-1" [player]="player" contentFit="cover" [nativeControls]="false" />
 * ```
 *
 * `expo-video`'s `surfaceType` is not here: its React component reads it to choose between two
 * Android views, and no native view reads it. See the player docs for the texture view.
 */
import {
  Component,
  ElementRef,
  InjectionToken,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { Engine, type EngineNode, type NativeSyntheticEvent } from '@ng-native/fabric';
import { callViewFunction, currentPlatform, viewFunctions } from './native.ts';
import { optionalBoolean } from './transforms.ts';

/** `expo-video`'s view functions, which its `VideoView` ref has. */
export interface VideoViewFunctions {
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  startPictureInPicture(): Promise<void>;
  stopPictureInPicture(): Promise<void>;
}

export type VideoContentFit = 'contain' | 'cover' | 'fill';

/** How the view goes full screen. */
export interface VideoFullscreenOptions {
  /** Shows the full screen button. True unless set. */
  readonly enable: boolean;
  /** The orientation full screen takes. Android and iOS. */
  readonly orientation?:
    | 'default'
    | 'portrait'
    | 'portraitUp'
    | 'portraitDown'
    | 'landscape'
    | 'landscapeLeft'
    | 'landscapeRight';
  /** Leaves full screen when the device turns away from `orientation`. Android and iOS. */
  readonly autoExitOnRotate?: boolean;
  /** Whether full screen comes back when picture in picture stops. iOS only. */
  readonly keepFullscreenOnPiPStop?: 'always' | 'autoEnter' | 'never';
}

/** Which of the native controls' buttons Android shows. */
export interface VideoButtonOptions {
  readonly showNext?: boolean;
  readonly showPrevious?: boolean;
  readonly showSeekForward?: boolean;
  readonly showSeekBackward?: boolean;
  readonly showSubtitles?: boolean | null;
  readonly showSettings?: boolean;
  readonly showPlayPause?: boolean;
  readonly showBottomBar?: boolean;
}

/** What `player` takes: a player with an `id`, such as `videoPlayer()`'s, or the id itself. */
export type VideoViewPlayer = number | { readonly id: number | undefined } | null;

type VideoEvent = NativeSyntheticEvent<Record<string, never>>;

@Component({
  selector: 'expo-video',
  template: '',
  host: {
    '[player]': 'playerId()',
    '[nativeControls]': 'nativeControls()',
    '[contentFit]': 'contentFit()',
    '[fullscreenOptions]': 'fullscreenOptions()',
    '[showsTimecodes]': 'showsTimecodes()',
    '[requiresLinearPlayback]': 'requiresLinearPlayback()',
    '[buttonOptions]': 'buttonOptions()',
    '[contentPosition]': 'contentPosition()',
    '[allowsPictureInPicture]': 'allowsPictureInPicture()',
    '[startsPictureInPictureAutomatically]': 'startsPictureInPictureAutomatically()',
    '[allowsVideoFrameAnalysis]': 'allowsVideoFrameAnalysis()',
    '[useExoShutter]': 'useExoShutter()',
    '[controllerAutoShow]': 'controllerAutoShow()',
  },
})
export class ExpoVideo {
  /** The view's functions. Overridden in a test. */
  static readonly SOURCE = new InjectionToken<VideoViewFunctions | null>(
    'angular-native.videoViewSource',
    {
      // The view `<expo-video>` commits as: `SurfaceVideoView` on Android, `VideoView` on iOS.
      factory: () =>
        viewFunctions<VideoViewFunctions>(
          'expo-video',
          'ExpoVideo',
          currentPlatform() === 'android' ? 'SurfaceVideoView' : 'VideoView',
        ),
    },
  );

  /** The player the view shows. Bound to null, the view shows none. */
  readonly player = input<VideoViewPlayer>();
  /** Shows the platform's playback controls. True unless set. */
  readonly nativeControls = input<boolean>(undefined, { transform: optionalBoolean });
  /** `contain` unless set. */
  readonly contentFit = input<VideoContentFit>();
  readonly fullscreenOptions = input<VideoFullscreenOptions>();
  /** Shows the time in the controls. True unless set. iOS only. */
  readonly showsTimecodes = input<boolean>(undefined, { transform: optionalBoolean });
  /** Stops the user seeking. A bare attribute is true. */
  readonly requiresLinearPlayback = input<boolean>(undefined, { transform: optionalBoolean });
  /** Android only. */
  readonly buttonOptions = input<VideoButtonOptions>();
  /** Where the video sits in the view, in points. iOS only. */
  readonly contentPosition = input<{ readonly dx?: number; readonly dy?: number }>();
  /** Lets the video go picture in picture, with the config plugin's `supportsPictureInPicture`. */
  readonly allowsPictureInPicture = input<boolean>(undefined, { transform: optionalBoolean });
  /** Goes picture in picture as the app goes to the background. Android 12 and later, and iOS. */
  readonly startsPictureInPictureAutomatically = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** Live Text in the video. True unless set. iOS 16 and later. */
  readonly allowsVideoFrameAnalysis = input<boolean>(undefined, { transform: optionalBoolean });
  /** Covers the view until the first frame, as ExoPlayer does. Android only. */
  readonly useExoShutter = input<boolean>(undefined, { transform: optionalBoolean });
  /** Shows the controls as playback starts, pauses or ends. True unless set. Android only. */
  readonly controllerAutoShow = input<boolean>(undefined, { transform: optionalBoolean });

  readonly firstFrameRender = output<VideoEvent>();
  readonly fullscreenEnter = output<VideoEvent>();
  readonly fullscreenExit = output<VideoEvent>();
  readonly pictureInPictureStart = output<VideoEvent>();
  readonly pictureInPictureStop = output<VideoEvent>();

  private readonly functions = inject(ExpoVideo.SOURCE);
  private readonly engine = inject(Engine);
  private readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;

  /**
   * Show the video full screen, as `VideoView`'s ref does. Nothing without the module, or before
   * the view reaches the screen.
   */
  enterFullscreen(): Promise<void> {
    return this.call('enterFullscreen');
  }

  /**
   * Leave full screen. On Android the app's JavaScript is paused while the video is full screen,
   * so this runs from a native listener there, as with `VideoView`.
   */
  exitFullscreen(): Promise<void> {
    return this.call('exitFullscreen');
  }

  /** Go picture in picture, with `allowsPictureInPicture` and the config plugin's support. */
  startPictureInPicture(): Promise<void> {
    return this.call('startPictureInPicture');
  }

  stopPictureInPicture(): Promise<void> {
    return this.call('stopPictureInPicture');
  }

  private call(name: keyof VideoViewFunctions): Promise<void> {
    return callViewFunction(this.functions, name, this.engine.tagOf(this.node));
  }

  protected readonly playerId = computed(() => {
    const player = this.player();
    return typeof player === 'object' && player !== null ? (player.id ?? null) : player;
  });
}
