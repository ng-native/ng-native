/**
 * `Camera`: a picture taken, or a video recorded, from the `<expo-camera>` view on screen.
 *
 * ```ts
 * registerExpoViews('expo-camera'); // once, at startup
 *
 * @Component({
 *   imports: [Camera],
 *   template: `<expo-camera facing="back" class="flex-1" />`,
 * })
 * export class Scanner {
 *   private readonly camera = viewChild.required(Camera);
 *   async shoot() { const picture = await this.camera().takePicture({ quality: 0.8 }); }
 * }
 * ```
 *
 * A video is `record()`, which resolves once it stops - `stopRecording()`, or a `maxDuration` or
 * `maxFileSize` reached - on a view with `mode="video"`.
 *
 * The view shows nothing without the camera permission, and records without sound without the
 * microphone's: `cameraPermission()` and `microphonePermission()` are each a `Permission`, over
 * `expo-camera`'s own functions on iOS and Android, and the desktop host's on macOS.
 *
 * Importing it is all it takes: it applies to every `<expo-camera>` in the template. The view is
 * what takes the picture, so this is a directive on the view rather than a service.
 *
 * In React, `takePictureAsync` is a method on the component's ref. Underneath, it is one of the
 * functions Expo defines on the view (`AsyncFunction("takePicture")` in the module, and `record`
 * and `stopRecording` beside it), which native
 * finds by reading `nativeTag` off whatever it is called on. So this calls the same function with
 * the tag the engine committed the view under, and no ref is needed. On macOS the functions are
 * the desktop host's `NgNativeCamera`'s, which take the tag as their first argument.
 */
import { Directive, ElementRef, InjectionToken, inject, input, output } from '@angular/core';
import { outputListened } from '@ng-native/device';
import { Engine, type EngineNode, type NativeSyntheticEvent } from '@ng-native/fabric';
import { desktopHost } from './desktop-host.ts';
import { expoModule, optional, present } from './native.ts';
import { Permission, UNAVAILABLE, type PermissionResponse } from './permissions.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';

/** `expo-camera`'s own props for its view, which each input below is typed from. */
type CameraViewProps = import('expo-camera').CameraViewProps;

export type PictureOptions = Omit<
  import('expo-camera').CameraPictureOptions,
  'onPictureSaved' | 'pictureRef'
>;
export type CameraPicture = import('expo-camera').CameraCapturedPicture;
/** `expo-camera`'s own, less `mirror`, which it has deprecated for the view's `mirror` prop. */
export type RecordingOptions = Omit<import('expo-camera').CameraRecordingOptions, 'mirror'>;
/** A recorded video: a file in the cache directory. */
export interface CameraRecording {
  readonly uri: string;
}

/** The functions `expo-camera` defines on its view, called with the view's tag as `this`. */
export interface CameraViewFunctions {
  takePicture(this: { nativeTag: number }, options: PictureOptions): Promise<CameraPicture>;
  record(this: { nativeTag: number }, options: RecordingOptions): Promise<CameraRecording>;
  stopRecording(this: { nativeTag: number }): Promise<void> | void;
}

@Directive({
  selector: 'expo-camera',
  exportAs: 'camera',
  host: {
    '[facing]': 'facing()',
    '[flashMode]': "flash() ?? flashMode() ?? 'off'",
    '[zoom]': 'zoom()',
    '[mode]': 'mode()',
    '[mute]': 'mute()',
    '[mirror]': 'mirror()',
    '[autoFocus]': 'autofocus() ?? autoFocus()',
    '[active]': 'active()',
    '[videoQuality]': 'videoQuality()',
    '[videoBitrate]': 'videoBitrate()',
    '[animateShutter]': 'animateShutter()',
    '[pictureSize]': 'pictureSize()',
    '[selectedLens]': 'selectedLens()',
    '[enableTorch]': 'enableTorch()',
    '[videoStabilizationMode]': 'videoStabilizationMode()',
    '[barcodeScannerEnabled]': 'barcodeScannerEnabled() ?? scanning()',
    '[barcodeScannerSettings]': 'barcodeScannerSettings()',
    '[responsiveOrientationWhenOrientationLocked]': 'responsiveOrientationWhenOrientationLocked()',
    '[ratio]': 'ratio()',
  },
})
export class Camera {
  /** Overridden in a test to take pictures without a camera. */
  static readonly SOURCE = new InjectionToken<CameraViewFunctions | null>(
    'angular-native.cameraSource',
    {
      factory: () => {
        const core = optional(
          () => require('expo-modules-core') as typeof import('expo-modules-core'),
        );
        const module = expoModule(
          'expo-camera',
          () =>
            core?.requireOptionalNativeModule<{
              ViewPrototypes?: Record<string, CameraViewFunctions>;
            }>('ExpoCamera'),
          { desktop: desktopCamera },
        );
        // Missing, the stand-in is the functions: taking a picture says what to install.
        if (module && !present(module)) return module as unknown as CameraViewFunctions;
        // The camera is the module's first view, so its functions are under the module's name.
        return module?.ViewPrototypes?.['ExpoCamera'] ?? null;
      },
    },
  );

  /** `back` unless set. */
  readonly facing = input<CameraViewProps['facing']>();
  /**
   * The flash for a picture. Committed as `flashMode`, the prop native reads, and as `off` unless
   * set, as `expo-camera`'s `CameraView` sends it: iOS's own default is `auto`.
   */
  readonly flash = input<CameraViewProps['flash']>();
  /** The native view's own name for `flash`, which `flash` wins over. */
  readonly flashMode = input<CameraViewProps['flash']>();
  /** From 0, not zoomed, to 1, the device's furthest. */
  readonly zoom = input<number>(undefined, { transform: optionalNumber });
  /** `picture` unless set; `video` to `record()`. */
  readonly mode = input<CameraViewProps['mode']>();
  /**
   * Record without sound, and without the microphone permission. A bare `mute` attribute is true,
   * and unset (`undefined` or `null`) is expo-camera's default, with sound.
   */
  readonly mute = input<boolean>(undefined, { transform: optionalBoolean });
  /** Mirrors what the front camera takes. A bare attribute is true. */
  readonly mirror = input<boolean>(undefined, { transform: optionalBoolean });
  /** Committed as `autoFocus`, the prop native reads. */
  readonly autofocus = input<CameraViewProps['autofocus']>();
  /** The native view's own name for `autofocus`, which `autofocus` wins over. */
  readonly autoFocus = input<CameraViewProps['autofocus']>();
  /** Runs the camera session. True unless set; false stops it with the view still there. iOS only. */
  readonly active = input<boolean>(undefined, { transform: optionalBoolean });
  readonly videoQuality = input<CameraViewProps['videoQuality']>();
  /** Bits per second. iOS needs a `codec` in `record()`'s options for it. */
  readonly videoBitrate = input<number>(undefined, { transform: optionalNumber });
  /** Plays the shutter animation as a picture is taken. True unless set. */
  readonly animateShutter = input<boolean>(undefined, { transform: optionalBoolean });
  /** One of the sizes `expo-camera`'s `getAvailablePictureSizesAsync` lists. */
  readonly pictureSize = input<string>();
  /** A lens's `deviceType`, as `expo-camera`'s `getAvailableLensesAsync` lists them. iOS only. */
  readonly selectedLens = input<string>();
  /** Turns the torch on. A bare attribute is true. */
  readonly enableTorch = input<boolean>(undefined, { transform: optionalBoolean });
  readonly videoStabilizationMode = input<CameraViewProps['videoStabilizationMode']>();
  /**
   * Scans for barcodes, sending `barcodeScanned`. On by default while `barcodeScanned` has a
   * listener, as `expo-camera`'s React component turns it on when `onBarcodeScanned` is given; set
   * it to choose either way. A bare attribute is true.
   */
  readonly barcodeScannerEnabled = input<boolean>(undefined, { transform: optionalBoolean });
  readonly barcodeScannerSettings = input<CameraViewProps['barcodeScannerSettings']>();
  /** Takes landscape pictures with the device turned, with the app locked upright. iOS only. */
  readonly responsiveOrientationWhenOrientationLocked = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** The preview's aspect ratio. Android only. */
  readonly ratio = input<CameraViewProps['ratio']>();

  /** The preview has started. */
  readonly cameraReady = output<NativeSyntheticEvent<Record<string, never>>>();
  /** The preview could not start, with `expo-camera`'s message. */
  readonly mountError = output<NativeSyntheticEvent<import('expo-camera').CameraMountError>>();
  /** A barcode was scanned, with `barcodeScannerEnabled` on. */
  readonly barcodeScanned =
    output<NativeSyntheticEvent<import('expo-camera').BarcodeScanningResult>>();
  protected readonly scanning = outputListened(this.barcodeScanned);

  private readonly functions = inject(Camera.SOURCE);
  private readonly engine = inject(Engine);
  private readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;

  /**
   * Take a picture. Null without the module, or before the view has reached the screen - there is
   * no camera to take it with yet.
   */
  async takePicture(options: PictureOptions = {}): Promise<CameraPicture | null> {
    const nativeTag = this.engine.tagOf(this.node);
    if (!this.functions || nativeTag === null) return null;
    return this.functions.takePicture.call({ nativeTag }, options);
  }

  /**
   * Record a video, resolving once the recording stops: `stopRecording()`, a `maxDuration` (in
   * seconds) or `maxFileSize` (in bytes) reached, or the preview stopping. The view needs
   * `mode="video"`, and the microphone permission unless it has `mute`: without it, Android rejects
   * and iOS records without sound. Null without the module, or before the view has reached the
   * screen.
   */
  async record(options: RecordingOptions = {}): Promise<CameraRecording | null> {
    const nativeTag = this.engine.tagOf(this.node);
    if (!this.functions || nativeTag === null) return null;
    return this.functions.record.call({ nativeTag }, options);
  }

  /** Stop the recording in progress, if there is one: `record()` then resolves with the video. */
  async stopRecording(): Promise<void> {
    const nativeTag = this.engine.tagOf(this.node);
    if (!this.functions || nativeTag === null) return;
    await this.functions.stopRecording.call({ nativeTag });
  }
}

/**
 * What the desktop host's `NgNativeCamera` takes: the view's functions, by the view's tag. A host
 * built without one takes no picture and records nothing, as the service does without the module.
 */
type CameraHost = Partial<{
  takePicture(tag: number, options: PictureOptions): Promise<CameraPicture>;
  record(tag: number, options: RecordingOptions): Promise<CameraRecording>;
  stopRecording(tag: number): Promise<void>;
}>;

/**
 * The camera view's functions over the desktop host's `NgNativeCamera`, for macOS, where the view
 * is the host's own and a TurboModule has no view prototypes: each passes its view's tag.
 */
function desktopCamera(): { ViewPrototypes: Record<string, CameraViewFunctions> } | null {
  const host = desktopHost<CameraHost>('NgNativeCamera')?.module;
  if (!host) return null;
  return {
    ViewPrototypes: {
      ExpoCamera: {
        async takePicture(options) {
          return (await host.takePicture?.(this.nativeTag, options)) ?? (null as never);
        },
        async record(options) {
          return (await host.record?.(this.nativeTag, options)) ?? (null as never);
        },
        async stopRecording() {
          await host.stopRecording?.(this.nativeTag);
        },
      },
    },
  };
}

/** The permission functions on `expo-camera`'s native module, as its `Camera` calls them. */
interface CameraPermissions {
  getCameraPermissionsAsync(): Promise<PermissionResponse>;
  requestCameraPermissionsAsync(): Promise<PermissionResponse>;
  getMicrophonePermissionsAsync(): Promise<PermissionResponse>;
  requestMicrophonePermissionsAsync(): Promise<PermissionResponse>;
}

/**
 * The permission to use the camera, which `<expo-camera>` needs before it shows anything. Made in
 * an injection context, a field of a component or a service, a refusal is checked again each time
 * the app comes back to the front. Denied, and never to be asked again, without the module.
 */
export function cameraPermission(): Permission {
  const native = cameraPermissions();
  return Permission.of(
    () => native?.getCameraPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
    () => native?.requestCameraPermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
  );
}

/**
 * The permission to use the microphone, which `record()` needs for a video with sound, unless the
 * view has `mute`: without it Android rejects, and iOS and macOS record without sound. On macOS it
 * is the same permission as `recordingPermission()` from `@ng-native/expo/audio`.
 */
export function microphonePermission(): Permission {
  const native = cameraPermissions();
  return Permission.of(
    () => native?.getMicrophonePermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
    () => native?.requestMicrophonePermissionsAsync?.() ?? Promise.resolve(UNAVAILABLE),
  );
}

/**
 * `expo-camera`'s native module, whose permission functions its `Camera` object forwards to, or
 * on macOS the desktop host's `NgNativeCamera` for the camera and `NgNativeAudio` for the
 * microphone, which AVFoundation asks about once for both.
 */
function cameraPermissions(): CameraPermissions | null {
  const core = optional(() => require('expo-modules-core') as typeof import('expo-modules-core'));
  return expoModule(
    'expo-camera',
    () => core?.requireOptionalNativeModule<CameraPermissions>('ExpoCamera'),
    { desktop: desktopCameraPermissions },
  );
}

/** What the desktop host's `NgNativeCamera` and `NgNativeAudio` answer for the two permissions. */
function desktopCameraPermissions(): CameraPermissions | null {
  const camera = desktopHost<Partial<CameraPermissions>>('NgNativeCamera')?.module;
  if (!camera) return null;
  const audio = desktopHost<Partial<RecordingPermissions>>('NgNativeAudio')?.module;
  const absent = () => Promise.resolve(UNAVAILABLE);
  return {
    getCameraPermissionsAsync: () => camera.getCameraPermissionsAsync?.() ?? absent(),
    requestCameraPermissionsAsync: () => camera.requestCameraPermissionsAsync?.() ?? absent(),
    getMicrophonePermissionsAsync: () => audio?.getRecordingPermissionsAsync?.() ?? absent(),
    requestMicrophonePermissionsAsync: () =>
      audio?.requestRecordingPermissionsAsync?.() ?? absent(),
  };
}

/** The desktop host's `NgNativeAudio`, as far as the microphone's permission goes. */
interface RecordingPermissions {
  getRecordingPermissionsAsync(): Promise<PermissionResponse>;
  requestRecordingPermissionsAsync(): Promise<PermissionResponse>;
}
