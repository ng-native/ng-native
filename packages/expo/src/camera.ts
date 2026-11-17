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
import { Directive, ElementRef, InjectionToken, inject, input } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { desktopHost } from './desktop-host.ts';
import { expoModule, optional, present } from './native.ts';
import { Permission, UNAVAILABLE, type PermissionResponse } from './permissions.ts';
import { optionalBoolean } from './transforms.ts';

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

@Directive({ selector: 'expo-camera', exportAs: 'camera', host: { '[mute]': 'mute()' } })
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

  /**
   * Record without sound, and without the microphone permission. A bare `mute` attribute is true,
   * and unset (`undefined` or `null`) is expo-camera's default, with sound.
   */
  readonly mute = input<boolean>(undefined, { transform: optionalBoolean });

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
