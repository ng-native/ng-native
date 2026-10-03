/**
 * `FileSystem`, bound to `expo-file-system`.
 *
 * Files located by what they are for rather than by path. `File` and `Paths` are Expo's own
 * classes over a native one, so they are used as published; this only decides which directory a
 * name lands in and hands the file back.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule, unavailable } from './native.ts';

/**
 * A file. Structural on purpose: this is Expo's `File`, described in terms a test can satisfy, so
 * a fake needs no Expo. An app gets the real object back and may use the rest of its surface.
 */
export interface NativeFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  create(options?: { overwrite?: boolean; intermediates?: boolean }): void;
  write(content: string | Uint8Array): void;
  text(): Promise<string>;
  textSync(): string;
  /** The contents as bytes: a PDF, an image, anything that is not text. */
  bytes(): Promise<Uint8Array>;
  delete(): void;
}

/** A directory, as far as this needs to know: something a file can be named inside. */
export type NativeDirectory = object;

/** The slice of `expo-file-system` this needs. */
export interface NativeFiles {
  /** Cleared by the system under storage pressure. */
  readonly cacheDirectory: NativeDirectory;
  /** Survives, and is backed up. */
  readonly documentDirectory: NativeDirectory;
  file(directory: NativeDirectory, name: string): NativeFile;
  /** The file at a uri, such as one a picker answers with. */
  fileAt?(uri: string): NativeFile;
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
        };
      },
    },
  );

  private readonly native = inject(FileSystem.SOURCE);

  /** A file the system may delete when the device runs low on storage. */
  cache(name: string): NativeFile {
    const native = this.installed();
    return native.file(native.cacheDirectory, name);
  }

  /** A file that survives, and is included in backups. */
  document(name: string): NativeFile {
    const native = this.installed();
    return native.file(native.documentDirectory, name);
  }

  /**
   * The file at a uri: a document the user picked, a photo from the library, a download. What a
   * picker answers with is a uri, and this is the file to read from it.
   */
  file(uri: string): NativeFile {
    const native = this.installed();
    if (!native.fileAt) {
      throw new Error(
        '[angular-native] this FileSystem.SOURCE has no fileAt(uri), which file() opens a uri with.',
      );
    }
    return native.fileAt(uri);
  }

  /**
   * Write text, or bytes for anything that is not text, whether or not the file is there already.
   * `write` alone throws on a file that has never been created, which is the first thing everyone
   * hits. It replaces what was there.
   */
  write(file: NativeFile, content: string | Uint8Array): void {
    if (!file.exists) file.create({ intermediates: true });
    file.write(content);
  }

  private installed(): NativeFiles {
    if (!this.native) {
      throw unavailable('expo-file-system', 'Provide FileSystem.SOURCE with a stand-in.');
    }
    return this.native;
  }
}
