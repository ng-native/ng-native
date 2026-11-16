/**
 * The service's files and folders over the desktop host's `NgNativeFileSystem`.
 *
 * A TurboModule cannot hand JavaScript expo-file-system's `File` and `Directory`, so the host
 * answers flat calls over uris and this builds `NativeFiles` on them. The host answers each call
 * synchronously as well as with a promise, so a file behaves as Expo's does on iOS and Android:
 * `exists` and `size` say what is there when read, `create`, `write` and `delete` have happened by
 * the time they return and throw their failure, `textSync()` reads at once, and `text()` and
 * `bytes()` answer a promise.
 */
import { base64Of, bytesOf } from './base64.ts';
import { desktopHost } from './desktop-host.ts';
import type {
  FileChange,
  FileEntry,
  FileStat,
  FolderName,
  NativeDirectory,
  NativeFile,
  NativeFiles,
  PickedDirectory,
} from './file-system.ts';

type Encoding = { encoding: 'utf8' | 'base64' };

type Host = {
  readonly paths?: Partial<Record<FolderName, string>>;
  readonly documentDirectory: string;
  readonly cacheDirectory: string;
  stat(uri: string): Promise<FileStat | null>;
  statSync(uri: string): FileStat | null;
  readdir(uri: string): Promise<FileEntry[]>;
  readAsStringAsync(uri: string, options: Encoding): Promise<string>;
  readAsStringSync(uri: string, options: Encoding): string;
  writeAsStringSync(uri: string, text: string, options: Encoding): void;
  makeDirectorySync(uri: string, options: { intermediates: boolean }): void;
  /** Makes an empty file named `name` in a folder, failing rather than empty one that is there. */
  createFileSync(folder: string, name: string): { uri: string };
  deleteSync(uri: string, options: { idempotent: boolean }): void;
  watch(uri: string): number | null;
  unwatch(id: number): void;
};

class HostFile implements NativeFile {
  private readonly host: Host;
  readonly uri: string;

  constructor(host: Host, uri: string) {
    this.host = host;
    this.uri = uri;
  }

  get exists(): boolean {
    const info = this.info();
    return info !== null && !info.directory;
  }

  get size(): number {
    return this.info()?.size ?? 0;
  }

  create(options?: { overwrite?: boolean; intermediates?: boolean }): void {
    if (options?.intermediates) {
      const parent = this.uri.slice(0, this.uri.lastIndexOf('/') + 1);
      this.host.makeDirectorySync(parent, { intermediates: true });
    }
    if (options?.overwrite) {
      this.host.writeAsStringSync(this.uri, '', { encoding: 'utf8' });
      return;
    }
    if (this.exists) throw new Error(`[angular-native] A file already exists at ${this.uri}.`);
    // In one step on the host, so a file another writer makes after the check is not emptied.
    const slash = this.uri.lastIndexOf('/') + 1;
    this.host.createFileSync(this.uri.slice(0, slash), decodeURIComponent(this.uri.slice(slash)));
  }

  write(content: string | Uint8Array): void {
    if (typeof content === 'string') {
      this.host.writeAsStringSync(this.uri, content, { encoding: 'utf8' });
    } else {
      this.host.writeAsStringSync(this.uri, base64Of(content), { encoding: 'base64' });
    }
  }

  writeSync(content: string | Uint8Array): void {
    this.write(content);
  }

  text(): Promise<string> {
    return this.host.readAsStringAsync(this.uri, { encoding: 'utf8' });
  }

  textSync(): string {
    return this.host.readAsStringSync(this.uri, { encoding: 'utf8' });
  }

  async bytes(): Promise<Uint8Array> {
    return bytesOf(await this.host.readAsStringAsync(this.uri, { encoding: 'base64' }));
  }

  bytesSync(): Uint8Array {
    return bytesOf(this.host.readAsStringSync(this.uri, { encoding: 'base64' }));
  }

  delete(): void {
    this.host.deleteSync(this.uri, { idempotent: false });
  }

  /** What is at the uri now, or null where nothing is or the app cannot reach it. */
  private info(): FileStat | null {
    try {
      return this.host.statSync(this.uri);
    } catch {
      return null;
    }
  }
}

/** A name as a path under a folder's uri, each segment percent-encoded. */
const underFolder = (folder: string, name: string): string =>
  folder + name.split('/').map(encodeURIComponent).join('/');

/** The host's `NgNativeDocumentPicker`, as far as its folder panel goes. */
interface FolderPanel {
  pickDirectoryAsync?(): Promise<{ uri: string } | null>;
}

/** Android codes a dismissed picker ERR_PICKER_CANCELLED, as `pickDirectory()` expects. */
const DISMISSED = 'ERR_PICKER_CANCELLED';

/**
 * The host's picked folder as a `PickedDirectory`, and a dismissed panel as the cancelled error
 * the other OSes reject with. `createFile` makes the file through the host's `NgNativeFileSystem`,
 * which can write in the folder because the user picked it.
 */
export async function desktopFolder(
  picked: Promise<{ uri: string } | null>,
): Promise<PickedDirectory> {
  const folder = await picked;
  if (!folder) {
    throw Object.assign(new Error('The folder picker was dismissed.'), { code: DISMISSED });
  }
  const uri = folder.uri.endsWith('/') ? folder.uri : `${folder.uri}/`;
  return {
    uri: folder.uri,
    createFile: (name) => {
      const files = desktopHost<Host>('NgNativeFileSystem')?.module;
      if (!files) {
        throw new Error(
          '[angular-native] this build of the desktop host has no NgNativeFileSystem to create a ' +
            'file with: rebuild it with "npm run macos".',
        );
      }
      return new HostFile(files, files.createFileSync(uri, name).uri);
    },
  };
}

/**
 * `NativeFiles` over the host's `NgNativeFileSystem`, or null where the host has no such module.
 * `paths` are the folders it says the app can reach, and `pickDirectoryAsync` is the host's folder
 * panel, from `NgNativeDocumentPicker`.
 */
export function desktopFiles(): NativeFiles | null {
  const found = desktopHost<Host>('NgNativeFileSystem');
  if (!found) return null;
  const host = found.module;
  const panel = desktopHost<FolderPanel>('NgNativeDocumentPicker')?.module;
  const directory = (uri: string): NativeDirectory => ({ uri });
  return {
    cacheDirectory: directory(host.cacheDirectory),
    documentDirectory: directory(host.documentDirectory),
    file: (folder, name) => new HostFile(host, underFolder((folder as { uri: string }).uri, name)),
    fileAt: (uri) => new HostFile(host, uri),
    readdir: (uri) => host.readdir(uri),
    stat: (uri) => host.stat(uri),
    watch: (uri, listener) => {
      const id = host.watch(uri);
      if (id === null || id === undefined) return () => {};
      const subscription = found.listen('ngNativeFileSystem', (event) => {
        const { watch, ...change } = event as { watch: number } & FileChange;
        if (watch === id) listener(change);
      });
      return () => {
        subscription.remove();
        host.unwatch(id);
      };
    },
    paths: host.paths,
    ...(panel?.pickDirectoryAsync && {
      pickDirectoryAsync: () => desktopFolder(panel.pickDirectoryAsync!()),
    }),
  };
}
