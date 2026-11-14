/**
 * `database()` on macOS. The host's `NgNativeSqlite` is handles, since a TurboModule cannot hand
 * back an object with methods: `openDatabaseAsync` answers `{id, databasePath, databaseName}` and
 * every other call takes the id first. The desktop loader builds expo-sqlite's database over it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { database } from '@ng-native/expo/database';

type Call = [string, ...unknown[]];

/** A desktop host whose `NgNativeSqlite` records every call and answers from `answers`. */
function host(answers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: Call[] = [];
  const module = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        async (...args: unknown[]) => {
          calls.push([name, ...args]);
          if (name === 'openDatabaseAsync') {
            return { id: 7, databasePath: `/data/SQLite/${args[0]}`, databaseName: args[0] };
          }
          return answers[name]?.(...args) ?? null;
        },
    },
  );
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
    return {
      Platform: { OS: 'macos' },
      TurboModuleRegistry: { get: (name: string) => (name === 'NgNativeSqlite' ? module : null) },
    };
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

describe('database() on macOS', () => {
  it('opens through the host and puts the id on every call', async () => {
    const calls = host({ getAllAsync: () => [{ id: 1 }] });
    const db = await database('notes.db').ready();
    await db.execAsync('CREATE TABLE a (id)');
    const rows = await db.getAllAsync('SELECT * FROM a WHERE id = ?', 1);
    assert.deepEqual(rows, [{ id: 1 }]);
    assert.deepEqual(calls, [
      ['openDatabaseAsync', 'notes.db'],
      ['execAsync', 7, 'CREATE TABLE a (id)'],
      ['getAllAsync', 7, 'SELECT * FROM a WHERE id = ?', [1]],
    ]);
  });

  it('takes params as a list, an array or an object, as expo-sqlite does', async () => {
    const calls = host();
    const db = await database('a.db').ready();
    await db.runAsync('x', 1, 'two');
    await db.runAsync('x', [3]);
    await db.runAsync('x', { $id: 4 });
    await db.getFirstAsync('x');
    assert.deepEqual(
      calls.slice(1).map((call) => call[3]),
      [[1, 'two'], [3], { $id: 4 }, []],
    );
  });

  it('sends bytes as {base64} and answers a blob as bytes', async () => {
    const calls = host({ getFirstAsync: () => ({ blob: { base64: 'AQID' } }) });
    const db = await database('a.db').ready();
    await db.runAsync('x', new Uint8Array([1, 2, 3, 4]));
    const row = await db.getFirstAsync<{ blob: Uint8Array }>('x');
    assert.deepEqual(calls[1]?.[3], [{ base64: 'AQIDBA==' }]);
    assert.deepEqual([...row!.blob], [1, 2, 3]);
  });

  it('runs a transaction as BEGIN, the task, COMMIT', async () => {
    const calls = host();
    const db = await database('a.db').ready();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT');
    });
    assert.deepEqual(
      calls.slice(1).map((call) => [call[0], call[2]]),
      [
        ['execAsync', 'BEGIN'],
        ['runAsync', 'INSERT'],
        ['execAsync', 'COMMIT'],
      ],
    );
  });

  it('rolls back and rethrows when the task throws', async () => {
    const calls = host();
    const db = await database('a.db').ready();
    await assert.rejects(
      db.withTransactionAsync(async () => {
        throw new Error('nope');
      }),
      /nope/,
    );
    assert.deepEqual(
      calls.slice(1).map((call) => call[2]),
      ['BEGIN', 'ROLLBACK'],
    );
  });

  it('migrates through transactions', async () => {
    const calls = host({ getFirstAsync: () => ({ user_version: 0 }) });
    await database('a.db', [{ to: 1, up: (db) => db.execAsync('CREATE TABLE a (id)') }]).ready();
    assert.deepEqual(
      calls.slice(2).map((call) => call[2]),
      ['BEGIN', 'CREATE TABLE a (id)', 'PRAGMA user_version = 1', 'COMMIT'],
    );
  });

  it('closes through the host', async () => {
    const calls = host();
    const notes = database('a.db');
    await notes.ready();
    await notes.close();
    assert.deepEqual(calls.at(-1), ['closeAsync', 7]);
  });

  it('streams getEachAsync over the rows the host answers', async () => {
    host({ getAllAsync: () => [{ n: 1 }, { n: 2 }] });
    const db = await database('a.db').ready();
    const seen: unknown[] = [];
    for await (const row of db.getEachAsync('x')) seen.push(row);
    assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
  });

  it('answers runAsync with what the host says', async () => {
    host({ runAsync: () => ({ lastInsertRowId: 5, changes: 1 }) });
    const db = await database('a.db').ready();
    assert.deepEqual(await db.runAsync('x'), { lastInsertRowId: 5, changes: 1 });
  });

  it('says what the host cannot do for prepareAsync and serializeAsync', async () => {
    host();
    const db = await database('a.db').ready();
    await assert.rejects(db.prepareAsync('x'), /prepareAsync is not available on a desktop OS/);
    await assert.rejects(db.serializeAsync(), /serializeAsync is not available on a desktop OS/);
  });

  it('says to rebuild the desktop host when it has no NgNativeSqlite', async () => {
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
      return { Platform: { OS: 'macos' }, TurboModuleRegistry: { get: () => null } };
    };
    await assert.rejects(database('a.db').ready(), /npm run macos/);
  });
});
