/**
 * expo-sqlite's database over the desktop host's `NgNativeSqlite`.
 *
 * A TurboModule cannot hand JavaScript an object with methods, so the host answers a handle,
 * `{id, databasePath, databaseName}`, and every other call takes the id first. This builds the
 * `SQLiteDatabase` `database()` expects on top of it.
 *
 * What does not carry over: the host answers a row as an object with no column list, so the keys
 * come in the order the host's map holds them, not the order of the `SELECT`. `prepareAsync` and
 * `serializeAsync` have no host call and throw; `getEachAsync` reads every row, then yields them.
 */
import { base64Of, bytesOf } from './base64.ts';

type Host = Record<string, (...args: unknown[]) => unknown>;

/** What expo-sqlite takes as params: a list, one array, or one object of named values. */
type Params = readonly unknown[];

const unsupported = (method: string): Error =>
  new Error(`[angular-native] ${method} is not available on a desktop OS.`);

/** Params as the host binds them: bytes are `{base64}`. */
function paramsOf(params: Params): unknown {
  const [first] = params;
  const named =
    params.length === 1 && first !== null && typeof first === 'object' && !isBytes(first);
  const one = named && !Array.isArray(first) ? first : null;
  if (one)
    return Object.fromEntries(Object.entries(one).map(([key, value]) => [key, bound(value)]));
  return (named ? (first as unknown[]) : [...params]).map(bound);
}

const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

const bound = (value: unknown): unknown => (isBytes(value) ? { base64: base64Of(value) } : value);

/** A row as expo-sqlite answers it: a blob column is bytes. */
function rowOf(row: unknown): unknown {
  if (row === null || typeof row !== 'object') return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const blob = value as { base64?: unknown } | null;
      return [key, typeof blob?.base64 === 'string' ? bytesOf(blob.base64) : value];
    }),
  );
}

function databaseOver(host: Host, handle: { id: number; databasePath: string }) {
  const { id } = handle;
  const call = (name: string, ...args: unknown[]) => host[name]!(id, ...args);
  const query = (name: string, source: string, params: Params) =>
    call(name, source, paramsOf(params));
  const all = (rows: unknown) => ((rows as unknown[] | null) ?? []).map(rowOf);

  const transaction = async (begin: string, task: () => Promise<void>) => {
    await call('execAsync', begin);
    try {
      await task();
    } catch (error) {
      await call('execAsync', 'ROLLBACK');
      throw error;
    }
    await call('execAsync', 'COMMIT');
  };

  return {
    databasePath: handle.databasePath,
    execAsync: (source: string) => call('execAsync', source),
    runAsync: (source: string, ...params: unknown[]) => query('runAsync', source, params),
    getFirstAsync: async (source: string, ...params: unknown[]) =>
      rowOf(await query('getFirstAsync', source, params)),
    getAllAsync: async (source: string, ...params: unknown[]) =>
      all(await query('getAllAsync', source, params)),
    async *getEachAsync(source: string, ...params: unknown[]) {
      yield* all(await query('getAllAsync', source, params));
    },
    isInTransactionAsync: () => call('isInTransactionAsync'),
    closeAsync: () => call('closeAsync'),
    withTransactionAsync: (task: () => Promise<void>) => transaction('BEGIN', task),
    withExclusiveTransactionAsync: (task: () => Promise<void>) =>
      transaction('BEGIN EXCLUSIVE', task),
    execSync: (source: string) => call('execSync', source),
    runSync: (source: string, ...params: unknown[]) => query('runSync', source, params),
    getFirstSync: (source: string, ...params: unknown[]) =>
      rowOf(query('getFirstSync', source, params)),
    getAllSync: (source: string, ...params: unknown[]) => all(query('getAllSync', source, params)),
    *getEachSync(source: string, ...params: unknown[]) {
      yield* all(query('getAllSync', source, params));
    },
    isInTransactionSync: () => call('isInTransactionSync'),
    closeSync: () => call('closeSync'),
    prepareAsync: () => Promise.reject(unsupported('prepareAsync')),
    serializeAsync: () => Promise.reject(unsupported('serializeAsync')),
  };
}

/**
 * The slice of `expo-sqlite` `database()` uses, over the host's `NgNativeSqlite`, or null where the
 * host has no such module. `directory` is where a file database lives; the host's default is
 * `<appData>/SQLite`.
 */
export function desktopSqlite(): {
  openDatabaseAsync(name: string, options?: unknown, directory?: string): Promise<unknown>;
} | null {
  const registry = (require('react-native') as typeof import('react-native'))
    .TurboModuleRegistry as { get(name: string): unknown };
  const host = registry.get('NgNativeSqlite') as Host | null;
  if (!host) return null;
  return {
    openDatabaseAsync: async (name, ...rest) =>
      databaseOver(host, (await host['openDatabaseAsync']!(name, ...rest)) as never),
  };
}
