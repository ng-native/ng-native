/**
 * `Camera`: a picture taken from the `<expo-camera>` view on screen.
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
 * Importing it is all it takes: it applies to every `<expo-camera>` in the template. The view is
 * what takes the picture, so this is a directive on the view rather than a service.
 *
 * In React, `takePictureAsync` is a method on the component's ref. Underneath, it is one of the
 * functions Expo defines on the view (`AsyncFunction("takePicture")` in the module), which native
 * finds by reading `nativeTag` off whatever it is called on. So this calls the same function with
 * the tag the engine committed the view under, and no ref is needed.
 */
import { Directive, ElementRef, InjectionToken, inject } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { expoModule, optional, present } from './native.ts';

export type PictureOptions = Omit<
  import('expo-camera').CameraPictureOptions,
  'onPictureSaved' | 'pictureRef'
>;
export type CameraPicture = import('expo-camera').CameraCapturedPicture;

/** The functions `expo-camera` defines on its view, called with the view's tag as `this`. */
export interface CameraViewFunctions {
  takePicture(this: { nativeTag: number }, options: PictureOptions): Promise<CameraPicture>;
}

@Directive({ selector: 'expo-camera', exportAs: 'camera' })
export class Camera {
  /** Overridden in a test to take pictures without a camera. */
  static readonly SOURCE = new InjectionToken<CameraViewFunctions | null>(
    'angular-native.cameraSource',
    {
      factory: () => {
        const core = optional(
          () => require('expo-modules-core') as typeof import('expo-modules-core'),
        );
        const module = expoModule('expo-camera', () =>
          core?.requireOptionalNativeModule<{
            ViewPrototypes?: Record<string, CameraViewFunctions>;
          }>('ExpoCamera'),
        );
        // Missing, the stand-in is the functions: taking a picture says what to install.
        if (module && !present(module)) return module as unknown as CameraViewFunctions;
        // The camera is the module's first view, so its functions are under the module's name.
        return module?.ViewPrototypes?.['ExpoCamera'] ?? null;
      },
    },
  );

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
}
