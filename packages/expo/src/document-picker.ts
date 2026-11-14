/**
 * `DocumentPicker`, bound to `expo-document-picker`: the system's file picker.
 *
 * ```ts
 * private readonly documents = inject(DocumentPicker);
 * const [pdf] = await this.documents.pick({ type: 'application/pdf' });
 * ```
 *
 * The options are the module's own, passed through unchanged. What this adds is the thing every
 * call site otherwise writes: a cancelled picker answers with no files rather than a result to
 * unwrap. The system picker needs no permission, so none is asked for. Without the module
 * installed, `pick()` answers with no files.
 *
 * It is the file dialogs service on every OS: `pick()` opens files, `pickDirectory()` a folder,
 * and `save()` writes a file where the user chooses:
 *
 * ```ts
 * const where = await this.documents.save({ suggestedName: 'export.csv', contents: csv });
 * ```
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import type { NativeFile, PickedDirectory } from './file-system.ts';
import { base64Of } from './base64.ts';
import { expoModule, optional, presence, present } from './native.ts';

type Expo = typeof import('expo-document-picker');

/** What `save()` asks a platform's own save dialog for. */
export interface NativeSaveOptions {
  readonly suggestedName: string;
  /** Text, or bytes for anything that is not text. */
  readonly contents: string | Uint8Array;
  /** MIME types the file may be saved as, the first the default. */
  readonly types: readonly string[];
}

/**
 * The module's function this service calls, and the folder picker and save dialog where the
 * platform has them. The real modules are these; a test provides a fake.
 */
export type NativeDocumentPicker = Pick<Expo, 'getDocumentAsync'> & {
  /** The system folder picker, `expo-file-system`'s. Rejects with a coded error when dismissed. */
  pickDirectoryAsync?(): Promise<PickedDirectory>;
  /**
   * A save dialog that writes the file itself and answers where, or null when dismissed: the
   * desktop host's. Without one, `save()` writes into a folder the user picks.
   */
  saveDocumentAsync?(options: NativeSaveOptions): Promise<string | null>;
};

/** What to save, and what to suggest calling it. */
export type SaveOptions = {
  /** The name the dialog suggests, with its extension: `export.csv`. */
  readonly suggestedName: string;
  /** MIME types the file may be saved as, the first the default. */
  readonly types?: readonly string[];
} & (
  | { readonly contents: string | Uint8Array; readonly fromFile?: never }
  | { readonly fromFile: Pick<NativeFile, 'bytes'>; readonly contents?: never }
);

export type DocumentPickerOptions = import('expo-document-picker').DocumentPickerOptions;
export type PickedDocument = import('expo-document-picker').DocumentPickerAsset;

@Service()
export class DocumentPicker {
  /** Overridden in a test to pick files without a file system. */
  static readonly SOURCE = new InjectionToken<NativeDocumentPicker | null>(
    'angular-native.documentPickerSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-document-picker',
          () => require('expo-document-picker') as Expo,
        );
        // Missing from the build, or not on this platform: as it is, to say so or to be inert.
        if (!present(expo)) return expo;
        const files = optional(
          () => require('expo-file-system') as typeof import('expo-file-system'),
        );
        const folders = files?.Directory?.pickDirectoryAsync;
        const desktop = expo as Partial<DesktopDialogs>;
        return {
          getDocumentAsync: (options) => expo!.getDocumentAsync(options),
          ...(folders && { pickDirectoryAsync: () => folders() }),
          // The desktop host's own dialogs, which an `expo-*` package has none of on a desktop OS.
          ...(desktop.pickDirectoryAsync && {
            pickDirectoryAsync: () => desktopFolder(desktop.pickDirectoryAsync!()),
          }),
          ...(desktop.saveDocumentAsync && {
            saveDocumentAsync: (options: NativeSaveOptions) =>
              desktop.saveDocumentAsync!({
                ...options,
                contents:
                  typeof options.contents === 'string'
                    ? options.contents
                    : { base64: base64Of(options.contents) },
              }),
          }),
        };
      },
    },
  );

  private readonly native = inject(DocumentPicker.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /**
   * Opens the system picker. `type` is a MIME type or a list of them, `multiple` allows more than
   * one file, and `copyToCacheDirectory` (the default) copies each into the app's cache so other
   * Expo modules can read it. Empty if they cancelled.
   */
  async pick(options?: DocumentPickerOptions): Promise<readonly PickedDocument[]> {
    if (!this.native) return [];
    const result = await this.native.getDocumentAsync(options);
    return result.canceled ? [] : result.assets;
  }

  /**
   * Opens the system folder picker and answers the folder the user chose, or null if they
   * dismissed it, and where the platform has no folder picker. Create a file in it with
   * `createFile(name, mimeType)`, then write it with `FileSystem.write()`. Any other failure is
   * rethrown. Needs no permission.
   */
  async pickDirectory(): Promise<PickedDirectory | null> {
    const pick = this.native?.pickDirectoryAsync;
    if (!pick) return null;
    try {
      return await pick.call(this.native);
    } catch (error) {
      if (isCancelled(error)) return null;
      throw error;
    }
  }

  /**
   * Writes a file where the user chooses, and answers where it went, or null if they dismissed
   * the dialog. `contents` is text or bytes; `fromFile` copies another file, such as one in the
   * cache. On macOS it is the save panel; on iOS and Android the user picks a folder and the file
   * is made in it with `suggestedName`. Null where there is neither.
   */
  async save(options: SaveOptions): Promise<string | null> {
    const native = this.native;
    if (!native) return null;
    const types = options.types ?? [];
    const contents = options.fromFile ? await options.fromFile.bytes() : options.contents;
    if (native.saveDocumentAsync) {
      return native.saveDocumentAsync({ suggestedName: options.suggestedName, contents, types });
    }
    const folder = await this.pickDirectory();
    if (!folder) return null;
    const file = folder.createFile(options.suggestedName, types[0] ?? null);
    if (file.writeSync) file.writeSync(contents);
    else file.write(contents);
    return file.uri;
  }
}

/**
 * The desktop host's `NgNativeDocumentPicker`, beside Expo's `getDocumentAsync`: a folder as
 * `{ uri }` or null when dismissed, and a save panel taking bytes as `{ base64 }`.
 */
interface DesktopDialogs {
  pickDirectoryAsync(): Promise<{ uri: string } | null>;
  saveDocumentAsync(
    options: Omit<NativeSaveOptions, 'contents'> & { contents: string | { base64: string } },
  ): Promise<string | null>;
}

/**
 * The host's folder as a `PickedDirectory`, and a dismissed panel as the cancelled error the
 * other OSes reject with. The desktop host has no file system module to make a file in it with
 * yet, so `createFile` says so; `save()` writes through the save panel instead.
 */
async function desktopFolder(picked: Promise<{ uri: string } | null>): Promise<PickedDirectory> {
  const folder = await picked;
  if (!folder)
    throw Object.assign(new Error('The folder picker was dismissed.'), { code: CANCELLED[0] });
  return {
    uri: folder.uri,
    createFile: () => {
      throw new Error(
        '[angular-native] the desktop host cannot create a file in a picked folder yet. Use ' +
          'DocumentPicker.save(), which writes the file through the save panel.',
      );
    },
  };
}

/** Android codes a dismissed picker ERR_PICKER_CANCELLED, iOS ERR_FILE_PICKING_CANCELLED. */
const CANCELLED = ['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'];

function isCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CANCELLED.includes(code);
}
