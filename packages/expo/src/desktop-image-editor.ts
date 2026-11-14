/**
 * expo-image-manipulator over the desktop host's `NgNativeImageManipulator`, for `ImageEditor` on
 * macOS. A TurboModule cannot hand back expo's context and image objects, so the context keeps its
 * actions here and the host applies them whole: `renderAsync()` asks the size they give, and the
 * image's `saveAsync()` edits and writes the file. Nothing native is held between calls, so
 * `release()` has nothing to free.
 */
import { desktopHost } from './desktop-host.ts';

type Expo = typeof import('expo-image-manipulator');
type Action = import('expo-image-manipulator').Action;
type ImageResult = import('expo-image-manipulator').ImageResult;
type ImageLoadOptions = import('expo-image-manipulator').ImageLoadOptions;
type SaveOptions = import('expo-image-manipulator').SaveOptions;

interface ImageManipulatorHost {
  renderAsync(
    uri: string,
    actions: readonly Action[],
    options: ImageLoadOptions | null,
  ): Promise<{ width: number; height: number }>;
  saveAsync(
    uri: string,
    actions: readonly Action[],
    options: ImageLoadOptions | null,
    save: SaveOptions,
  ): Promise<ImageResult>;
}

/** The slice of expo-image-manipulator `ImageEditor` uses, or null with no NgNativeImageManipulator. */
export function desktopImageEditor(): Pick<Expo, 'ImageManipulator'> | null {
  const found = desktopHost<ImageManipulatorHost>('NgNativeImageManipulator');
  if (!found) return null;
  const host = found.module;

  class ImageRef {
    readonly #edit: [string, readonly Action[], ImageLoadOptions | null];
    readonly width: number;
    readonly height: number;

    constructor(
      edit: [string, readonly Action[], ImageLoadOptions | null],
      width: number,
      height: number,
    ) {
      this.#edit = edit;
      this.width = width;
      this.height = height;
    }

    saveAsync(save: SaveOptions = {}): Promise<ImageResult> {
      return host.saveAsync(...this.#edit, save);
    }

    release(): void {}
  }

  class Context {
    readonly #uri: string;
    readonly #options: ImageLoadOptions | null;
    #actions: Action[] = [];

    constructor(uri: string, options: ImageLoadOptions | null) {
      this.#uri = uri;
      this.#options = options;
    }

    #add(action: Action): this {
      this.#actions.push(action);
      return this;
    }

    resize(size: { width?: number | null; height?: number | null }): this {
      return this.#add({ resize: size } as Action);
    }

    rotate(degrees: number): this {
      return this.#add({ rotate: degrees });
    }

    flip(flipType: string): this {
      return this.#add({ flip: flipType } as Action);
    }

    crop(rect: { originX: number; originY: number; width: number; height: number }): this {
      return this.#add({ crop: rect });
    }

    reset(): this {
      this.#actions = [];
      return this;
    }

    async renderAsync(): Promise<ImageRef> {
      const actions = [...this.#actions];
      const { width, height } = await host.renderAsync(this.#uri, actions, this.#options);
      return new ImageRef([this.#uri, actions, this.#options], width, height);
    }

    release(): void {}
  }

  const ImageManipulator = {
    manipulate: (source: unknown, options?: ImageLoadOptions) => {
      if (typeof source !== 'string') {
        throw new Error('ImageManipulator.manipulate: on macOS the source is a uri');
      }
      return new Context(source, options ?? null);
    },
  };
  return { ImageManipulator } as unknown as Pick<Expo, 'ImageManipulator'>;
}
