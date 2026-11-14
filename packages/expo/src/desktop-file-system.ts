/**
 * The service's files and folders over the desktop host's `NgNativeFileSystem`.
 *
 * A TurboModule cannot hand JavaScript expo-file-system's `File` and `Directory`, so the host
 * answers flat calls over uris and this builds `NativeFiles` on them. Every call of the host's
 * that reads or writes is asynchronous, which a file's synchronous members cannot be:
 *
 * - A file queues what changes it - `create`, `write`, `delete` - and runs each after the one
 *   before. `text()` and `bytes()` read once the queue is empty, so a write is always read back.
 *   `settled()` answers when the queue is empty, and rejects with the first failure since the
 *   last time it was asked, which is where a write that failed is heard.
 * - `exists` and `size` are what the host last said, refreshed when the file is named and after
 *   each change. They read false and 0 until the first answer; await `settled()` for the real one.
 * - `textSync()` throws. `create()` leaves a file that is there alone, since the file's state is
 *   not known when it is called, unless `overwrite` is set.
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

type Host = {
  readonly paths?: Partial<Record<FolderName, string>>;
  readonly documentDirectory: string;
  readonly cacheDirectory: string;
  stat(uri: string): Promise<FileStat | null>;
  readdir(uri: string): Promise<FileEntry[]>;
  readAsStringAsync(uri: string, options: { encoding: 'utf8' | 'base64' }): Promise<string>;
  writeAsStringAsync(
    uri: string,
    text: string,
    options: { encoding: 'utf8' | 'base64' },
  ): Promise<void>;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
  watch(uri: string): number | null;
  unwatch(id: number): void;
};

/** A file the desktop host holds, with what its queue adds to `NativeFile`. */
export interface DesktopFile extends NativeFile {
  /** Answers when what is queued is done; rejects with the first failure since last asked. */
  settled(): Promise<void>;
}

class HostFile implements DesktopFile {
  exists = false;
  size = 0;
  private tail: Promise<void> = Promise.resolve();
  private failure: { error: unknown } | null = null;

  private readonly host: Host;
  readonly uri: string;

  constructor(host: Host, uri: string) {
    this.host = host;
    this.uri = uri;
    this.queue(() => this.refresh().catch(() => {}));
  }

  create(options?: { overwrite?: boolean; intermediates?: boolean }): void {
    this.queue(async () => {
      if (options?.intermediates) await this.makeParent();
      if (options?.overwrite || !(await this.host.stat(this.uri))) {
        await this.host.writeAsStringAsync(this.uri, '', { encoding: 'utf8' });
      }
    });
  }

  write(content: string | Uint8Array): void {
    this.queue(() =>
      typeof content === 'string'
        ? this.host.writeAsStringAsync(this.uri, content, { encoding: 'utf8' })
        : this.host.writeAsStringAsync(this.uri, base64Of(content), { encoding: 'base64' }),
    );
  }

  writeSync(content: string | Uint8Array): void {
    this.write(content);
  }

  async text(): Promise<string> {
    await this.tail;
    return this.host.readAsStringAsync(this.uri, { encoding: 'utf8' });
  }

  textSync(): string {
    throw new Error(
      '[angular-native] textSync is not available on a desktop OS: the host reads asynchronously. Use text().',
    );
  }

  async bytes(): Promise<Uint8Array> {
    await this.tail;
    return bytesOf(await this.host.readAsStringAsync(this.uri, { encoding: 'base64' }));
  }

  delete(): void {
    this.queue(() => this.host.deleteAsync(this.uri, { idempotent: false }));
  }

  async settled(): Promise<void> {
    await this.tail;
    const failure = this.failure;
    this.failure = null;
    if (failure) throw failure.error;
  }

  /** Run `task` after what is queued, then say what is there. A failure is kept, not thrown. */
  private queue(task: () => Promise<unknown>): void {
    this.tail = this.tail
      .then(task)
      .then(() => this.refresh())
      .catch((error) => {
        this.failure ??= { error };
        return this.refresh().catch(() => {});
      });
  }

  private async refresh(): Promise<void> {
    const info = await this.host.stat(this.uri);
    this.exists = info !== null && !info.directory;
    this.size = info?.size ?? 0;
  }

  private makeParent(): Promise<void> {
    const parent = this.uri.slice(0, this.uri.lastIndexOf('/') + 1);
    return this.host.makeDirectoryAsync(parent, { intermediates: true });
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
