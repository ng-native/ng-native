/**
 * `FileSystem`, bound to `expo-file-system`.
 *
 * Files located by what they are for rather than by path. `File` and `Paths` are Expo's own
 * classes over a native one, so they are used as published; this only decides which directory a
 * name lands in and hands the file back.
 *
 * The file dialogs are `DocumentPicker`'s: `pickDirectory()` and `save()` are there. This
 * service's `pickDirectory()` answers the same, and is deprecated.
 *
 * Moving and listing stay on Expo's `File` and `Directory`.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { expoModule, presence, present } from './native.ts';

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

/** One entry of a folder, as `readdir` lists it. */
export interface FileEntry {
  readonly name: string;
  readonly uri: string;
  /** Whether it is a folder. */
  readonly directory: boolean;
}

/** What `stat` says of a path that is there. Times are milliseconds since 1970, where known. */
export interface FileStat {
  readonly uri: string;
  readonly directory: boolean;
  readonly size: number;
  readonly modified: number | null;
  readonly created: number | null;
}

/** A change `watch` reports: what happened, to which path, and where a rename took it. */
export interface FileChange {
  readonly type: 'created' | 'modified' | 'deleted' | 'renamed';
  readonly uri: string;
  readonly newUri?: string;
}

/** The folders `paths` names. */
export type FolderName =
  'cache' | 'document' | 'home' | 'desktop' | 'downloads' | 'temp' | 'appData';

/** Each folder's uri, or null where the OS has no such folder or the app cannot reach it. */
export type FileSystemPaths = Readonly<Record<FolderName, string | null>>;

/** A path, as a uri or as anything with one: a file, a folder, a picked folder. */
export type Where = string | { readonly uri: string };

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
  /** The entries of the folder at a uri. */
  readdir?(uri: string): readonly FileEntry[] | Promise<readonly FileEntry[]>;
  /** What is at a uri, or null where nothing is. */
  stat?(uri: string): FileStat | null | Promise<FileStat | null>;
  /** Calls `listener` with each change to the file or folder at a uri. Answers how to stop. */
  watch?(uri: string, listener: (change: FileChange) => void): () => void;
  /** The folders the platform has, as uris. One left out has no such folder there. */
  readonly paths?: Partial<Record<FolderName, string>>;
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
        // Missing from the build: the stand-in, to say so when it is used.
        if (!present(expo)) return expo as never;
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
          ...expoFolders(expo),
        };
      },
    },
  );

  private readonly native = inject(FileSystem.SOURCE);

  /**
   * The folders an app writes to, as uris: `cache` and `document` on every OS, and on macOS the
   * user's `home`, `desktop` and `downloads`, `temp` and the app's `appData`. A folder the OS has
   * not, or the app cannot reach, is null.
   */
  readonly paths: FileSystemPaths = pathsOf(present(this.native));

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
   * @deprecated Use `DocumentPicker.pickDirectory()` from `@ng-native/expo/document-picker`, the
   * file dialogs service, which answers the same. This one goes in a later release.
   *
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

  /** The entries of a folder the app can reach. Empty where there are none, or no module. */
  async readdir(folder: Where): Promise<readonly FileEntry[]> {
    return (await this.native?.readdir?.(uriOf(folder))) ?? [];
  }

  /** What is at a path the app can reach, or null where nothing is, or there is no module. */
  async stat(path: Where): Promise<FileStat | null> {
    return (await this.native?.stat?.(uriOf(path))) ?? null;
  }

  /**
   * Calls `listener` with each change to a file, or to what is in a folder, until the function it
   * answers is called. Where there is no module, nothing changes and stopping does nothing.
   */
  watch(path: Where, listener: (change: FileChange) => void): () => void {
    return this.native?.watch?.(uriOf(path), listener) ?? (() => {});
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

const uriOf = (where: Where): string => (typeof where === 'string' ? where : where.uri);

/** Each folder a source has, as a uri, and null for each it has not. */
function pathsOf(native: NativeFiles | null): FileSystemPaths {
  const uri = (directory: NativeDirectory | undefined) =>
    (directory as { uri?: string } | undefined)?.uri ?? null;
  return {
    home: null,
    desktop: null,
    downloads: null,
    temp: null,
    appData: null,
    ...native?.paths,
    cache: uri(native?.cacheDirectory),
    document: uri(native?.documentDirectory),
  };
}

type ExpoFiles = typeof import('expo-file-system');

/** The listing, description and watching `expo-file-system` has, as the slice. */
function expoFolders(expo: ExpoFiles): Pick<NativeFiles, 'readdir' | 'stat' | 'watch'> {
  /** The file or folder at a uri, as Expo's class for what is there, or null. */
  const at = (uri: string) => {
    const { exists, isDirectory } = expo.Paths.info(uri);
    if (!exists) return null;
    return isDirectory ? new expo.Directory(uri) : new expo.File(uri);
  };
  return {
    readdir: (uri) =>
      new expo.Directory(uri).list().map((entry) => ({
        name: entry.name,
        uri: entry.uri,
        directory: entry instanceof expo.Directory,
      })),
    stat: (uri) => {
      const entry = at(uri);
      if (!entry) return null;
      const info = entry.info();
      return {
        uri,
        directory: entry instanceof expo.Directory,
        size: info.size ?? 0,
        modified: info.modificationTime ?? null,
        created: info.creationTime ?? null,
      };
    },
    watch: (uri, listener) => {
      const entry = at(uri);
      if (!entry) return () => {};
      const subscription = (entry as InstanceType<ExpoFiles['Directory']>).watch((event) =>
        listener({
          type: event.type,
          uri: event.target.uri,
          ...(event.newTarget && { newUri: event.newTarget.uri }),
        }),
      );
      return () => subscription.remove();
    },
  };
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
