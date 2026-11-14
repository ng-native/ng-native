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
import type {
  FileChange,
  FileEntry,
  FileStat,
  FolderName,
  NativeDirectory,
  NativeFile,
  NativeFiles,
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
    if (!options?.overwrite && this.exists) {
      throw new Error(`[angular-native] A file already exists at ${this.uri}.`);
    }
    this.host.writeAsStringSync(this.uri, '', { encoding: 'utf8' });
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

/**
 * `NativeFiles` over the host's `NgNativeFileSystem`, or null where the host has no such module.
 * `paths` are the folders it says the app can reach.
 */
export function desktopFiles(): NativeFiles | null {
  const native = require('react-native') as {
    TurboModuleRegistry: { get(name: string): unknown };
    DeviceEventEmitter: {
      addListener(event: string, listener: (event: unknown) => void): { remove(): void };
    };
  };
  const host = native.TurboModuleRegistry.get('NgNativeFileSystem') as Host | null;
  if (!host) return null;
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
      const subscription = native.DeviceEventEmitter.addListener('ngNativeFileSystem', (event) => {
        const { watch, ...change } = event as { watch: number } & FileChange;
        if (watch === id) listener(change);
      });
      return () => {
        subscription.remove();
        host.unwatch(id);
      };
    },
    paths: host.paths,
  };
}
