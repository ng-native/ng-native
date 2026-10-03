/**
 * An in-memory SQLite database with the part of `expo-sqlite`'s interface an app's services use,
 * for a test in Node, where no native module can load. It is Node's own `node:sqlite`, so the SQL
 * a service runs is run for real: a constraint is enforced, a migration creates its tables.
 *
 *     const restore = openDatabasesWith(() => memoryDatabase());
 *
 * with `openDatabasesWith` from `@ng-native/expo/database`, which points `database()` at it.
 */
type Row = Record<string, unknown>;

export interface MemoryDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: unknown[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getFirstAsync<T = Row>(source: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T = Row>(source: string, ...params: unknown[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/** `expo-sqlite` takes parameters one by one or as one array. */
const bound = (params: unknown[]): never[] =>
  (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];

export function memoryDatabase(): MemoryDatabase {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  // Foreign keys off until asked for, as a connection `expo-sqlite` opens is: Node turns them on.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  return {
    execAsync: async (source) => db.exec(source),
    runAsync: async (source, ...params) => {
      const { lastInsertRowid, changes } = db.prepare(source).run(...bound(params));
      return { lastInsertRowId: Number(lastInsertRowid), changes: Number(changes) };
    },
    getFirstAsync: async <T>(source: string, ...params: unknown[]) =>
      ({ ...db.prepare(source).get(...bound(params)) }) as T | null,
    getAllAsync: async <T>(source: string, ...params: unknown[]) =>
      db
        .prepare(source)
        .all(...bound(params))
        .map((row) => ({ ...row })) as T[],
    withTransactionAsync: async (task) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => db.close(),
  };
}
