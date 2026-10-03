/**
 * A service built on `database()`, tested in Node: `openDatabasesWith` points every `database()`
 * at a stand-in, and `memoryDatabase()` is one that runs the SQL for real, on `node:sqlite`.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { database, openDatabasesWith } from '@ng-native/expo/database';
import { memoryDatabase } from '@ng-native/testing';

let restore: () => void;
beforeEach(() => {
  restore = openDatabasesWith(() => memoryDatabase());
});
afterEach(() => restore());

const schema = [
  {
    to: 1,
    up: (db: { execAsync(sql: string): Promise<void> }) =>
      db.execAsync(
        'CREATE TABLE list (id INTEGER PRIMARY KEY);' +
          'CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT, ' +
          'list INTEGER REFERENCES list(id) ON DELETE CASCADE)',
      ),
  },
];

describe('database() in a Node test', () => {
  it('migrates and runs a service’s SQL against the stand-in', async () => {
    const notes = database('notes.db', schema);
    const db = await notes.ready();
    const added = await db.runAsync('INSERT INTO note (body) VALUES (?)', 'hello');
    assert.equal(added.lastInsertRowId, 1);
    assert.deepEqual(await db.getAllAsync('SELECT id, body FROM note'), [{ id: 1, body: 'hello' }]);
    assert.deepEqual(await db.getFirstAsync('SELECT body FROM note WHERE id = ?', [1]), {
      body: 'hello',
    });
    await notes.close();
  });

  it('gives each open a database of its own', async () => {
    const first = await database('a.db', schema).ready();
    await first.runAsync('INSERT INTO note (body) VALUES (?)', 'one');
    const second = await database('b.db', schema).ready();
    assert.deepEqual(await second.getAllAsync('SELECT * FROM note'), []);
  });

  it('enforces a foreign key once onOpen turns them on, and not without', async () => {
    const orphan = (db: { runAsync(sql: string, ...params: unknown[]): Promise<unknown> }) =>
      db.runAsync('INSERT INTO note (body, list) VALUES (?, ?)', 'x', 99);

    const lax = await database('lax.db', schema).ready();
    await assert.doesNotReject(orphan(lax));

    const strict = await database('strict.db', schema, {
      onOpen: (db) => db.execAsync('PRAGMA foreign_keys = ON'),
    }).ready();
    await assert.rejects(orphan(strict), /FOREIGN KEY constraint failed/);
  });

  it('rolls a failed transaction back', async () => {
    const db = await database('tx.db', schema).ready();
    await assert.rejects(
      db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO note (body) VALUES (?)', 'gone');
        throw new Error('stop');
      }),
      /stop/,
    );
    assert.deepEqual(await db.getAllAsync('SELECT * FROM note'), []);
  });

  it('answers null for no first row, and binds a boolean as expo-sqlite does', async () => {
    const db = await database('rows.db', schema).ready();
    assert.equal(await db.getFirstAsync('SELECT * FROM note WHERE id = ?', 7), null);
    await db.execAsync('CREATE TABLE flag (id INTEGER PRIMARY KEY, done INTEGER)');
    await db.runAsync('INSERT INTO flag (id, done) VALUES (?, ?)', 1, true as never);
    await db.runAsync('INSERT INTO flag (id, done) VALUES ($id, $done)', {
      $id: 2,
      $done: false,
    } as never);
    assert.deepEqual(await db.getAllAsync('SELECT done FROM flag ORDER BY id'), [
      { done: 1 },
      { done: 0 },
    ]);
  });

  it('keeps the error of a task whose transaction is already rolled back', async () => {
    const db = await database('gone.db', schema).ready();
    await assert.rejects(
      db.withTransactionAsync(async () => {
        await db.execAsync('ROLLBACK');
        throw new Error('the task failed');
      }),
      /the task failed/,
    );
  });

  it('opens with expo-sqlite again once restored', async () => {
    restore();
    await assert.rejects(database('real.db').ready());
  });
});
