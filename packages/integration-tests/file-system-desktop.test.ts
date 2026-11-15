/**
 * `FileSystem` on macOS. The host's `NgNativeFileSystem` is flat calls over uris, and a TurboModule
 * cannot hand back expo-file-system's `File` and `Directory`, so the desktop loader builds the
 * service's files over them. The host answers each call synchronously as well as with a promise, so
 * a file is synchronous where Expo's is: `exists`, `size`, `create`, `write`, `textSync` and
 * `delete` answer at once, and `text()` and `bytes()` answer a promise.
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
  const stat = (uri: string) => {
    if (uri.includes('unreachable')) throw new Error(`Outside the folders: ${uri}`);
    return uri in files
      ? { uri, directory: false, size: files[uri]!.length, modified: 1, created: 1 }
      : null;
  };
  const read = (uri: string, options: { encoding: string }) => {
    if (!(uri in files)) throw new Error(`The file could not be read: ${uri}`);
    const text = files[uri]!;
    return options.encoding === 'base64' ? Buffer.from(text, 'latin1').toString('base64') : text;
  };
  const write = (uri: string, text: string, options: { encoding: string }) => {
    if (uri.includes('locked')) throw new Error(`Not allowed: ${uri}`);
    files[uri] =
      options.encoding === 'base64' ? Buffer.from(text, 'base64').toString('latin1') : text;
    return null;
  };
  const remove = (uri: string) => {
    if (!(uri in files)) throw new Error(`Nothing to delete at ${uri}`);
    delete files[uri];
    return null;
  };
  const sync =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push([name, ...args]);
      return fn(...args);
    };
  const module = {
    paths: PATHS,
    documentDirectory: PATHS.document,
    cacheDirectory: PATHS.cache,
    stat: record('stat', stat),
    statSync: sync('statSync', stat),
    readdir: record('readdir', (uri: string) => [{ name: 'a', uri: `${uri}a`, directory: false }]),
    readAsStringAsync: record('readAsStringAsync', read),
    readAsStringSync: sync('readAsStringSync', read),
    writeAsStringAsync: record('writeAsStringAsync', write),
    writeAsStringSync: sync('writeAsStringSync', write),
    makeDirectorySync: sync('makeDirectorySync', () => null),
    deleteAsync: record('deleteAsync', remove),
    deleteSync: sync('deleteSync', remove),
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

  it('has written by the time write returns, and reads it back at once', async () => {
    const { files } = host();
    const fs = injectService(FileSystem);
    const file = fs.document('notes.txt');
    assert.equal(fs.write(file, 'one'), undefined);
    assert.equal(files['file:///app/Documents/notes.txt'], 'one');
    fs.write(file, 'two');
    assert.equal(file.textSync(), 'two');
    assert.equal(await file.text(), 'two');
  });

  it('says what is there now, each time it is asked', () => {
    const { files } = host({ 'file:///app/Documents/a.txt': 'four' });
    const fs = injectService(FileSystem);
    const file = fs.document('a.txt');
    assert.deepEqual([file.exists, file.size], [true, 4]);
    files['file:///app/Documents/a.txt'] = 'longer';
    assert.equal(file.size, 6);
    file.delete();
    assert.deepEqual([file.exists, file.size], [false, 0]);
    assert.equal(fs.file('file:///unreachable/x').exists, false);
  });

  it('makes the folders a first write needs', () => {
    const { calls, files } = host();
    const fs = injectService(FileSystem);
    fs.write(fs.document('deep/new.txt'), 'x');
    assert.deepEqual(
      calls.find((call) => call[0] === 'makeDirectorySync'),
      ['makeDirectorySync', 'file:///app/Documents/deep/', { intermediates: true }],
    );
    assert.equal(files['file:///app/Documents/deep/new.txt'], 'x');
  });

  it('creates an empty file, and throws for one that is there unless told to overwrite', () => {
    const { files } = host({ 'file:///app/Documents/old.txt': 'kept' });
    const fs = injectService(FileSystem);
    const fresh = fs.document('fresh.txt');
    fresh.create();
    assert.equal(files['file:///app/Documents/fresh.txt'], '');
    const old = fs.document('old.txt');
    assert.throws(() => old.create(), /already exists/);
    assert.equal(files['file:///app/Documents/old.txt'], 'kept');
    old.create({ overwrite: true });
    assert.equal(files['file:///app/Documents/old.txt'], '');
  });

  it('writes bytes as base64 and reads them back as bytes', async () => {
    const { calls } = host();
    const fs = injectService(FileSystem);
    const file = fs.cache('b.bin');
    fs.write(file, new Uint8Array([104, 105, 255]));
    assert.deepEqual([...(await file.bytes())], [104, 105, 255]);
    assert.deepEqual(
      calls
        .filter((call) => call[0] === 'writeAsStringSync')
        .at(-1)
        ?.slice(2),
      ['aGn/', { encoding: 'base64' }],
    );
  });

  it('throws the failure of a delete or a write where it happens', () => {
    host();
    const fs = injectService(FileSystem);
    assert.throws(() => fs.document('x.txt').delete(), /Nothing to delete/);
    assert.throws(() => fs.write(fs.document('locked.txt'), 'x'), /Not allowed/);
    assert.throws(() => fs.document('missing.txt').textSync(), /could not be read/);
  });

  it('has no settled(), as on iOS and Android', () => {
    host();
    const file = injectService(FileSystem).document('a.txt');
    assert.equal('settled' in file, false);
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
