/**
 * `FileSystem`, bound to `expo-file-system`.
 *
 * Files located by what they are for rather than by path. `File` and `Paths` are Expo's own
 * classes over a native one, so they are used as published; this only decides which directory a
 * name lands in and hands the file back.
 *
 * `pickDirectory()` opens the system folder picker and answers the folder the user chose (or null
 * if they dismissed it), so a file can be saved somewhere the user can find it:
 *
 * ```ts
 * const folder = await this.files.pickDirectory();
 * if (folder) this.files.write(folder.createFile('export.csv', 'text/csv'), csv);
 * ```
 *
 * Moving and listing stay on Expo's `File` and `Directory`.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { expoModule, presence } from './native.ts';

/**
 * A file. Structural on purpose: this is Expo's `File`, described in terms a test can satisfy, so
 * a fake needs no Expo. An app gets the real object back and may use the rest of its surface.
 */
export interface NativeFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  create(options?: { overwrite?: boolean; intermediates?: boolean }): void;
  /** Synchronous up to SDK 57. From SDK 58 it answers a promise, and `writeSync` is synchronous. */
  write(content: string | Uint8Array): void;
  writeSync?(content: string | Uint8Array): void;
  text(): Promise<string>;
  textSync(): string;
  /** The contents as bytes: a PDF, an image, anything that is not text. */
  bytes(): Promise<Uint8Array>;
  delete(): void;
}

/** A directory, as far as this needs to know: something a file can be named inside. */
export type NativeDirectory = object;

/**
 * A folder the user picked, as far as this needs to know: something a file can be created in.
 * Structural like `NativeFile`: Expo's `Directory` satisfies it, and so does a test fake.
 */
export interface PickedDirectory {
  readonly uri: string;
  /** Creates the file, empty, and answers it. `mimeType` is used on Android, `null` for text. */
  createFile(name: string, mimeType: string | null): NativeFile;
}

/** The slice of `expo-file-system` this needs. */
export interface NativeFiles {
  /** Cleared by the system under storage pressure. */
  readonly cacheDirectory: NativeDirectory;
  /** Survives, and is backed up. */
  readonly documentDirectory: NativeDirectory;
  file(directory: NativeDirectory, name: string): NativeFile;
  /** The file at a uri, such as one a picker answers with. */
  fileAt?(uri: string): NativeFile;
  /** The system folder picker. Rejects with a coded error when the user dismisses it. */
  pickDirectoryAsync?(): Promise<PickedDirectory>;
}

/**
 * The two directories an app actually chooses between, plus the create-then-write dance that
 * writing a file for the first time needs.
 *
 * ponytail: a locator, not a file API. Everything else - moving, listing, downloading, streaming
 * - is on the object this hands back, documented by Expo, and not worth restating here.
 */
@Service()
export class FileSystem {
  /** Overridden in a test to write files that are not on a disk. */
  static readonly SOURCE = new InjectionToken<NativeFiles | null>(
    'angular-native.fileSystemSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-file-system',
          () => require('expo-file-system') as typeof import('expo-file-system'),
        );
        if (!expo) return null;
        return {
          // Both are getters on Expo's side, handing back a fresh Directory each time.
          get cacheDirectory() {
            return expo.Paths.cache;
          },
          get documentDirectory() {
            return expo.Paths.document;
          },
          file: (directory, name) =>
            new expo.File(directory as InstanceType<typeof expo.Directory>, name),
          fileAt: (uri) => new expo.File(uri),
          pickDirectoryAsync: () => expo.Directory.pickDirectoryAsync(),
        };
      },
    },
  );

  private readonly native = inject(FileSystem.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /**
   * A file the system may delete when the device runs low on storage. Where the service is absent,
   * a file that is not there: writing it does nothing, and reading it answers nothing.
   */
  cache(name: string): NativeFile {
    const native = this.native;
    return native ? native.file(native.cacheDirectory, name) : noFile();
  }

  /** A file that survives, and is included in backups. Where absent, as `cache`. */
  document(name: string): NativeFile {
    const native = this.native;
    return native ? native.file(native.documentDirectory, name) : noFile();
  }

  /**
   * The file at a uri: a document the user picked, a photo from the library, a download. What a
   * picker answers with is a uri, and this is the file to read from it. Where absent, as `cache`.
   */
  file(uri: string): NativeFile {
    const native = this.native;
    if (!native) return noFile(uri);
    if (!native.fileAt) {
      throw new Error(
        '[angular-native] this FileSystem.SOURCE has no fileAt(uri), which file() opens a uri with.',
      );
    }
    return native.fileAt(uri);
  }

  /**
   * Opens the system folder picker and answers the folder the user chose, or null if they
   * dismissed it. Create a file in it with `createFile(name, mimeType)`, which makes it, then
   * `write()` it. Any other failure is rethrown. Needs no permission. Null where the service is
   * absent.
   */
  async pickDirectory(): Promise<PickedDirectory | null> {
    const native = this.native;
    if (!native) return null;
    if (!native.pickDirectoryAsync) {
      throw new Error(
        '[angular-native] this FileSystem.SOURCE has no pickDirectoryAsync(), which pickDirectory() opens the picker with.',
      );
    }
    try {
      return await native.pickDirectoryAsync();
    } catch (error) {
      if (isCancelled(error)) return null;
      throw error;
    }
  }

  /**
   * Write text, or bytes for anything that is not text, whether or not the file is there already.
   * `write` alone throws on a file that has never been created, which is the first thing everyone
   * hits. It replaces what was there, and has written by the time it returns: from SDK 58 through
   * `writeSync`, since `write` there answers a promise.
   */
  write(file: NativeFile, content: string | Uint8Array): void {
    if (!file.exists) file.create({ intermediates: true });
    if (file.writeSync) file.writeSync(content);
    else file.write(content);
  }
}

/**
 * A file that is not there, which is what `FileSystem` hands back where it is absent: it never
 * exists, writing or deleting it does nothing, and reading it answers nothing.
 */
function noFile(uri = ''): NativeFile {
  return {
    uri,
    exists: false,
    size: 0,
    create: () => {},
    write: () => {},
    writeSync: () => {},
    text: () => Promise.resolve(''),
    textSync: () => '',
    bytes: () => Promise.resolve(new Uint8Array()),
    delete: () => {},
  };
}

/** Android codes a dismissed picker ERR_PICKER_CANCELLED, iOS ERR_FILE_PICKING_CANCELLED. */
const CANCELLED = ['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'];

function isCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CANCELLED.includes(code);
}
