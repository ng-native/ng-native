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

/** A value as SQLite binds it: `expo-sqlite` takes a boolean as 1 or 0, which Node refuses. */
const value = (param: unknown): unknown => (typeof param === 'boolean' ? Number(param) : param);

/** `expo-sqlite` takes parameters one by one, as one array, or as one object of named ones. */
function bound(params: unknown[]): never[] {
  const [only] = params;
  if (params.length !== 1) return params.map(value) as never[];
  if (Array.isArray(only)) return only.map(value) as never[];
  // Bytes are one value, a BLOB, and not an object of named parameters.
  if (only !== null && typeof only === 'object' && !(only instanceof Uint8Array)) {
    const named = Object.entries(only).map(([name, param]) => [name, value(param)]);
    return [Object.fromEntries(named)] as never[];
  }
  return [value(only)] as never[];
}

export function memoryDatabase(): MemoryDatabase {
  const sqlite = process.getBuiltinModule('node:sqlite') as
    typeof import('node:sqlite') | undefined;
  if (!sqlite) {
    throw new Error('[angular-native] memoryDatabase() needs node:sqlite: Node 22.13 or later.');
  }
  const { DatabaseSync } = sqlite;
  // Foreign keys off until asked for, as a connection `expo-sqlite` opens is: Node turns them on.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  return {
    execAsync: async (source) => db.exec(source),
    runAsync: async (source, ...params) => {
      const { lastInsertRowid, changes } = db.prepare(source).run(...bound(params));
      return { lastInsertRowId: Number(lastInsertRowid), changes: Number(changes) };
    },
    getFirstAsync: async <T>(source: string, ...params: unknown[]) => {
      const row = db.prepare(source).get(...bound(params));
      return row === undefined ? null : ({ ...row } as T);
    },
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
        // SQLite rolls some failures back itself, and a second rollback then fails: the error
        // worth having is the task's.
        try {
          db.exec('ROLLBACK');
        } catch {
          // Already rolled back.
        }
        throw error;
      }
    },
    closeAsync: async () => db.close(),
  };
}
