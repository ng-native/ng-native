/**
 * `ImageEditor`, bound to `expo-image-manipulator`: resizing, cropping, rotating, flipping and
 * re-encoding an image file.
 *
 * ```ts
 * import { ImageEditor, SaveFormat } from '@ng-native/expo/image-editor';
 *
 * private readonly editor = inject(ImageEditor);
 *
 * async thumbnail(uri: string): Promise<string | null> {
 *   const image = await this.editor.edit(uri, [{ resize: { width: 256 } }], {
 *     format: SaveFormat.WEBP,
 *     compress: 0.8,
 *   });
 *   return image?.uri ?? null;
 * }
 * ```
 *
 * `edit()` takes the module's own actions and save options - the shape of its `manipulateAsync`
 * - and runs them through the module's current contextual API: one context, each action applied
 * in order, the result rendered and saved to a new file in the cache. The context and the
 * rendered image are native memory nothing else holds, so both are released once the file is
 * written, including when it fails. `manipulate()` hands over the module's context itself, for a
 * caller that chains its own steps and releases it after.
 *
 * Without the module installed, `edit()` resolves to null and `manipulate()` is null.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import type {
  Action,
  FlipType as ExpoFlipType,
  ImageManipulatorContext,
  ImageResult,
  SaveFormat as ExpoSaveFormat,
  SaveOptions,
} from 'expo-image-manipulator';
import { expoModule, presence } from './native.ts';

type Expo = typeof import('expo-image-manipulator');

/** The module's API this service calls. The real module is one; a test provides a fake. */
export type NativeImageEditor = Pick<Expo, 'ImageManipulator'>;

/**
 * The formats an edited image is saved in, as `expo-image-manipulator`'s own enum. Importing the
 * enum from the module loads the module, which a test in Node cannot; these are the same strings,
 * typed as the enum.
 */
export const SaveFormat = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
} as unknown as typeof ExpoSaveFormat;

/** The directions an image is flipped in, as the module's own enum. */
export const FlipType = {
  Vertical: 'vertical',
  Horizontal: 'horizontal',
} as unknown as typeof ExpoFlipType;

@Service()
export class ImageEditor {
  /** Overridden in a test to edit images without decoding any. */
  static readonly SOURCE = new InjectionToken<NativeImageEditor | null>(
    'angular-native.imageEditorSource',
    {
      factory: () =>
        expoModule('expo-image-manipulator', () => require('expo-image-manipulator') as Expo),
    },
  );

  private readonly native = inject(ImageEditor.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /**
   * Applies each action in order and saves the result as a new file: a JPEG unless `format` says
   * otherwise, `compress` from 0 to 1, and `base64` to have the contents back as well. Each action
   * has exactly one key: `resize`, `rotate` (degrees, clockwise), `flip`, `crop`, or on the web
   * `extent`.
   */
  async edit(
    source: string,
    actions: readonly Action[] = [],
    options: SaveOptions = {},
  ): Promise<ImageResult | null> {
    const context = this.manipulate(source);
    if (!context) return null;
    let image: Awaited<ReturnType<ImageManipulatorContext['renderAsync']>> | undefined;
    try {
      for (const action of actions) apply(context, action);
      image = await context.renderAsync();
      return await image.saveAsync({ format: SaveFormat.JPEG, ...options });
    } finally {
      context.release();
      image?.release();
    }
  }

  /**
   * The module's own context for a file or data URI, for chaining steps by hand: `resize()`,
   * `rotate()`, `flip()`, `crop()` and `reset()`, then `renderAsync()`. The caller
   * releases it, and the image it renders, once done.
   */
  manipulate(source: string): ImageManipulatorContext | null {
    return this.native?.ImageManipulator.manipulate(source) ?? null;
  }
}

function apply(context: ImageManipulatorContext, action: Action): void {
  if ('resize' in action) context.resize(action.resize);
  else if ('rotate' in action) context.rotate(action.rotate);
  else if ('flip' in action) context.flip(action.flip);
  else if ('crop' in action) context.crop(action.crop);
  // The web's context alone has `extent`; elsewhere the action is skipped, as the module skips it.
  else if ('extent' in action) context.extent?.(action.extent);
}
