/**
 * `database()`, bound to `expo-sqlite`.
 *
 * `SQLiteProvider` and `useSQLiteContext` are the documented way in and both are React: a context
 * that opens the database, runs migrations, and closes it when the provider unmounts. The database
 * itself is a plain object with `getAllAsync` and the rest already on it, so what is rebuilt is
 * the *lifecycle* - opened once, migrated before anything queries, closed on request:
 *
 * ```ts
 * export const notes = database('notes.db', [
 *   { to: 1, up: (db) => db.execAsync('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT)') },
 * ]);
 *
 * const rows = await (await notes.ready()).getAllAsync<Note>('SELECT * FROM note');
 * ```
 *
 * A value rather than a service, because a schema belongs to a feature rather than to an injector,
 * and an app usually has exactly one. Opening is deferred until something asks: a database opened
 * at startup is a file handle and a WAL journal for an app that may never read from it.
 */
import { expoModule, unavailable } from './native.ts';

/** Enough of `SQLiteDatabase` to own it. Queries go through the database itself. */
export interface NativeDatabase {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  closeAsync(): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** One step from one schema version to the next. Run in order, each inside a transaction. */
export interface Migration {
  /** The version this migration produces. Must be greater than every one before it. */
  readonly to: number;
  readonly up: (database: NativeDatabase) => Promise<void>;
}

export interface DatabaseOptions<T extends NativeDatabase = NativeDatabase> {
  /**
   * Run on every open, before the migrations and outside any transaction: where the settings of a
   * connection go. `PRAGMA foreign_keys = ON` belongs here and nowhere else, since SQLite ignores
   * it inside a transaction, which a migration is, and forgets it when the connection closes.
   */
  readonly onOpen?: (database: T) => Promise<void> | void;
}

export class Database<T extends NativeDatabase> {
  private readonly open: () => Promise<T>;
  private readonly migrations: readonly Migration[];
  private readonly onOpen: DatabaseOptions<T>['onOpen'];
  private opening: Promise<T> | null = null;

  constructor(
    open: () => Promise<T>,
    migrations: readonly Migration[] = [],
    options: DatabaseOptions<T> = {},
  ) {
    this.open = open;
    this.migrations = [...migrations].sort((a, b) => a.to - b.to);
    this.onOpen = options.onOpen;
  }

  /**
   * The database, opened and migrated.
   *
   * Awaited at every call site rather than held, because the first caller is the one that pays for
   * opening it and every caller after that is handed the same promise - including the ones that
   * arrive while it is still opening, which is what stops two connections being made at once.
   */
  ready(): Promise<T> {
    if (this.opening) return this.opening;
    const opening = this.start();
    this.opening = opening;
    // A failed open is forgotten once everyone waiting on it has heard, so the next caller tries
    // again rather than being handed the same failure for the life of the app.
    opening.catch(() => {
      if (this.opening === opening) this.opening = null;
    });
    return opening;
  }

  /**
   * Close it. The next caller reopens; this is for a sign-out that has to leave nothing behind.
   *
   * Resolves even when the open failed: the connection was already closed by the failure, so there
   * is nothing left to release.
   */
  async close(): Promise<void> {
    const opening = this.opening;
    this.opening = null;
    const database = await opening?.catch(() => null);
    await database?.closeAsync();
  }

  /** Open, set the connection up and migrate, closing it again if either fails. */
  private async start(): Promise<T> {
    const database = await this.open();
    try {
      await this.onOpen?.(database);
      await this.migrate(database);
    } catch (error) {
      // The migration's own error is the one worth reporting; a failure to close after it is not.
      await database.closeAsync().catch(() => {});
      throw error;
    }
    return database;
  }

  /**
   * Bring the schema up to date, in order, each step in its own transaction.
   *
   * `user_version` is SQLite's own integer for this, so the record of where a database has got to
   * lives in the database rather than in a table this has to create first. It is transactional,
   * so it is set inside the migration's own transaction: the schema change and the record of it
   * commit together or roll back together, and a migration can never be half done and recorded.
   */
  private async migrate(database: T): Promise<void> {
    if (!this.migrations.length) return;

    const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    let version = row?.user_version ?? 0;

    for (const migration of this.migrations) {
      if (migration.to <= version) continue;
      await database.withTransactionAsync(async () => {
        await migration.up(database);
        await database.execAsync(`PRAGMA user_version = ${migration.to}`);
      });
      version = migration.to;
    }
  }
}

let opener: ((name: string) => unknown) | null = null;

/**
 * Open every `database()` with `open` in place of `expo-sqlite`, until the function this answers
 * is called. For a test, where no native module can load: `open` gives a stand-in, such as
 * `memoryDatabase()` from `@ng-native/testing`, and the migrations and `onOpen` run against it.
 */
export function openDatabasesWith(open: (name: string) => unknown): () => void {
  const before = opener;
  opener = open;
  return () => {
    opener = before;
  };
}

/** A database, opened on first use and migrated before the first query sees it. */
export function database(
  name: string,
  migrations: readonly Migration[] = [],
  options: DatabaseOptions<import('expo-sqlite').SQLiteDatabase> = {},
) {
  return new Database<import('expo-sqlite').SQLiteDatabase>(
    async () => {
      if (opener) return opener(name) as import('expo-sqlite').SQLiteDatabase;
      const expo = expoModule(
        'expo-sqlite',
        () => require('expo-sqlite') as typeof import('expo-sqlite'),
        ['ios', 'android', 'web'],
      );
      if (!expo) {
        throw unavailable(
          'expo-sqlite',
          'Point database() at a stand-in with openDatabasesWith(), such as memoryDatabase() from @ng-native/testing.',
        );
      }
      return expo.openDatabaseAsync(name);
    },
    migrations,
    options,
  );
}
