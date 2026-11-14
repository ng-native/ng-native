/**
 * `FileSystem` on macOS. The host's `NgNativeFileSystem` is flat calls over uris, and a TurboModule
 * cannot hand back expo-file-system's `File` and `Directory`, so the desktop loader builds the
 * service's files over them. The host's calls are all asynchronous: a file's writes are queued in
 * order, `text()` and `bytes()` read after them, and `settled()` says when they are done.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { FileSystem } from '@ng-native/expo/file-system';
import { injectService } from '@ng-native/testing';

const PATHS = {
  cache: 'file:///app/Caches/',
  document: 'file:///app/Documents/',
  appData: 'file:///app/',
  temp: 'file:///tmp/',
  home: 'file:///Users/me/',
  desktop: 'file:///Users/me/Desktop/',
  downloads: 'file:///Users/me/Downloads/',
};

type Call = [string, ...unknown[]];

/** A desktop host with `files` (uri to text) in memory, recording each call. */
function host(files: Record<string, string> = {}) {
  const calls: Call[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const record =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    async (...args: A): Promise<R> => {
      calls.push([name, ...args]);
      return fn(...args);
    };
  const module = {
    paths: PATHS,
    documentDirectory: PATHS.document,
    cacheDirectory: PATHS.cache,
    stat: record('stat', (uri: string) =>
      uri in files
        ? { uri, directory: false, size: files[uri]!.length, modified: 1, created: 1 }
        : null,
    ),
    readdir: record('readdir', (uri: string) => [{ name: 'a', uri: `${uri}a`, directory: false }]),
    readAsStringAsync: record('readAsStringAsync', (uri: string, options: { encoding: string }) => {
      const text = files[uri] ?? '';
      return options.encoding === 'base64' ? Buffer.from(text, 'latin1').toString('base64') : text;
    }),
    writeAsStringAsync: record(
      'writeAsStringAsync',
      (uri: string, text: string, options: { encoding: string }) => {
        if (uri.includes('locked')) throw new Error(`Not allowed: ${uri}`);
        files[uri] =
          options.encoding === 'base64' ? Buffer.from(text, 'base64').toString('latin1') : text;
        return null;
      },
    ),
    makeDirectoryAsync: record('makeDirectoryAsync', () => null),
    deleteAsync: record('deleteAsync', (uri: string) => {
      if (!(uri in files)) throw new Error(`Nothing to delete at ${uri}`);
      delete files[uri];
      return null;
    }),
    watch: (...args: unknown[]) => (calls.push(['watch', ...args]), 11),
    unwatch: (...args: unknown[]) => void calls.push(['unwatch', ...args]),
  };
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
    return {
      Platform: { OS: 'macos' },
      TurboModuleRegistry: {
        get: (name: string) => (name === 'NgNativeFileSystem' ? module : null),
      },
      DeviceEventEmitter: {
        addListener: (event: string, listener: (event: unknown) => void) => {
          assert.equal(event, 'ngNativeFileSystem');
          listeners.add(listener);
          return { remove: () => void listeners.delete(listener) };
        },
      },
    };
  };
  return { calls, files, listeners };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

type Settling = { settled(): Promise<void> };

describe('FileSystem on macOS', () => {
  it('reaches the service with the host paths', () => {
    host();
    const fs = injectService(FileSystem);
    assert.equal(fs.available(), true);
    assert.deepEqual(fs.paths, PATHS);
  });

  it('names a file in the document and cache folders', () => {
    host();
    const fs = injectService(FileSystem);
    assert.equal(fs.document('notes.txt').uri, 'file:///app/Documents/notes.txt');
    assert.equal(fs.cache('a b/c.txt').uri, 'file:///app/Caches/a%20b/c.txt');
    assert.equal(fs.file('file:///x/y.txt').uri, 'file:///x/y.txt');
  });

  it('writes in order, then reads the text back', async () => {
    const { files } = host();
    const fs = injectService(FileSystem);
    const file = fs.document('notes.txt');
    fs.write(file, 'one');
    fs.write(file, 'two');
    assert.equal(await file.text(), 'two');
    assert.equal(files['file:///app/Documents/notes.txt'], 'two');
  });

  it('makes the folders a first write needs, and leaves a file that is there alone', async () => {
    const { calls, files } = host({ 'file:///app/Documents/old.txt': 'kept' });
    const fs = injectService(FileSystem);
    const fresh = fs.document('deep/new.txt');
    fs.write(fresh, 'x');
    await (fresh as unknown as Settling).settled();
    assert.deepEqual(
      calls.find((call) => call[0] === 'makeDirectoryAsync'),
      ['makeDirectoryAsync', 'file:///app/Documents/deep/', { intermediates: true }],
    );
    const old = fs.document('old.txt');
    old.create();
    await (old as unknown as Settling).settled();
    assert.equal(files['file:///app/Documents/old.txt'], 'kept');
  });

  it('says what is there once the queue has settled', async () => {
    host({ 'file:///app/Documents/a.txt': 'four' });
    const fs = injectService(FileSystem);
    const file = fs.document('a.txt');
    await (file as unknown as Settling).settled();
    assert.deepEqual([file.exists, file.size], [true, 4]);
    file.delete();
    await (file as unknown as Settling).settled();
    assert.deepEqual([file.exists, file.size], [false, 0]);
  });

  it('writes bytes as base64 and reads them back as bytes', async () => {
    const { calls } = host();
    const fs = injectService(FileSystem);
    const file = fs.cache('b.bin');
    fs.write(file, new Uint8Array([104, 105, 255]));
    assert.deepEqual([...(await file.bytes())], [104, 105, 255]);
    assert.deepEqual(
      calls
        .filter((call) => call[0] === 'writeAsStringAsync')
        .at(-1)
        ?.slice(2),
      ['aGn/', { encoding: 'base64' }],
    );
  });

  it('settles with the failure of a delete', async () => {
    host();
    const file = injectService(FileSystem).document('x.txt');
    file.delete();
    await assert.rejects((file as unknown as Settling).settled(), /Nothing to delete/);
  });

  it('answers write with a promise that rejects when the write fails', async () => {
    host();
    const fs = injectService(FileSystem);
    await assert.rejects(Promise.resolve(fs.write(fs.document('locked.txt'), 'x')), /Not allowed/);
    await fs.write(fs.document('fine.txt'), 'x');
  });

  it('says a synchronous read is not available', () => {
    host();
    const file = injectService(FileSystem).document('a.txt');
    assert.throws(() => file.textSync(), /textSync is not available on a desktop OS/);
  });

  it('lists and describes through the host', async () => {
    const { calls } = host({ 'file:///app/Documents/a': 'xy' });
    const fs = injectService(FileSystem);
    assert.deepEqual(await fs.readdir('file:///app/Documents/'), [
      { name: 'a', uri: 'file:///app/Documents/a', directory: false },
    ]);
    assert.equal((await fs.stat('file:///app/Documents/a'))?.size, 2);
    assert.equal(
      calls.some((call) => call[0] === 'readdir'),
      true,
    );
  });

  it('watches by id, and stops the watch', () => {
    const { calls, listeners } = host();
    const fs = injectService(FileSystem);
    const seen: unknown[] = [];
    const stop = fs.watch('file:///app/Documents/', (change) => seen.push(change));
    for (const listener of listeners) {
      listener({ watch: 99, type: 'created', uri: 'file:///other' });
      listener({ watch: 11, type: 'renamed', uri: 'file:///a', newUri: 'file:///b' });
    }
    assert.deepEqual(seen, [{ type: 'renamed', uri: 'file:///a', newUri: 'file:///b' }]);
    stop();
    assert.equal(listeners.size, 0);
    assert.deepEqual(calls.at(-1), ['unwatch', 11]);
  });

  it('says to rebuild the desktop host when it has no NgNativeFileSystem', () => {
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
      return { Platform: { OS: 'macos' }, TurboModuleRegistry: { get: () => null } };
    };
    assert.throws(() => injectService(FileSystem).document('a.txt'), /npm run macos/);
  });
});
