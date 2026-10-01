---
title: Working offline
summary: Show the cache, fetch when online, fall back to the cache offline, queue writes for later.
---

# Working offline

Phone apps need to work through frequent connection losses. Use four steps:

1. Show cached data immediately, without waiting for a network request.
2. When connected, fetch fresh data and update the screen and cache.
3. When offline, keep displaying the cache.
4. Queue offline writes and send them on reconnection, preserving data without blocking the UI.

Combine [`Network`](/packages/expo/network) for connectivity,
[`Storage`](/packages/expo/storage) or [`Database`](/packages/expo/database) for caching, and
`HttpClient` for requests. No new package is needed.

## Pick the cache: `Storage` or `Database`

- **`Storage`** (or `SecureStorage`) holds individual preferences, flags or objects through a
  two-way signal, `store.signal('key', initial)`. Each read returns the whole value; it cannot
  query, filter or sort lists.
- **`Database`** uses `expo-sqlite`, opened and migrated by `database()`, for feeds, search results
  and paginated rows. `SELECT ... WHERE ... ORDER BY` handles caches beyond a handful of items;
  `Storage` has no equivalent.

The feed below uses `Database`. Use `Storage` for small values such as a last-synchronized
timestamp; see the [Storage guide](/packages/expo/storage).

## The worked example: a note feed

Declare the schema and migrations as a module-level value; [Database](/packages/expo/database)
explains why this is a value rather than a service:

```ts
// notes-db.ts
import { database } from '@ng-native/expo/database';

export const notesDb = database('notes.db', [
  {
    to: 1,
    up: (db) =>
      db.execAsync(`
        CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE pending_write (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL,
          body TEXT NOT NULL
        );
      `),
  },
]);
```

`pending_write` queues notes until the server receives them. Sort explicitly by `seq` to send
oldest first; database row order is not guaranteed.

The service reads the cache, refreshes online, and queues and flushes writes. It keeps the queue in
memory and in `pending_write`. Unlike `Storage` and `Network`, `Database` throws without
`expo-sqlite` (see [Without the module](/packages/expo/database#without-the-module)).
Each `notesDb` call therefore has its own `try`/`catch`. The running app reads and flushes the
in-memory `queue`; SQLite persists it across restarts. Node tests and browser previews without
`expo-sqlite` lose persistence, but the queue still works.

```ts
// notes.ts
import { Service, inject, signal, effect, type Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Network } from '@ng-native/expo/network';
import { notesDb } from './notes-db.ts';

export interface Note {
  readonly id: string;
  readonly body: string;
  readonly updatedAt: number;
}

/** A queued write not yet sent, kept in memory so the queue works with no SQLite - see above. */
interface PendingWrite {
  readonly seq: number;
  readonly id: string;
  readonly body: string;
}

const nextId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

@Service()
export class Notes {
  private readonly http = inject(HttpClient);
  private readonly network = inject(Network);

  private readonly list = signal<Note[]>([]);
  private readonly queue = signal<PendingWrite[]>([]);
  private readonly refreshing = signal(false);
  private flushing = false;
  private seq = 0;

  readonly notes: Signal<Note[]> = this.list.asReadonly();
  readonly isRefreshing: Signal<boolean> = this.refreshing.asReadonly();

  constructor() {
    void this.loadFromCache();

    // `connected` flips true the moment there is a network of any kind - see "reachable is not
    // connected" below for why this reads `connected`, not `reachable`.
    effect(() => {
      if (this.network.connected()) void this.refresh();
    });
  }

  /**
   * Cached rows, and the queue as it stood at the last launch, on screen immediately - this is
   * what a cold, offline start shows. The `catch` is what keeps a platform with no SQLite from
   * failing to start at all: no cache and an empty queue is exactly what a genuinely cold start
   * looks like anyway.
   */
  private async loadFromCache(): Promise<void> {
    try {
      const db = await notesDb.ready();
      this.list.set(
        await db.getAllAsync<Note>(
          'SELECT id, body, updated_at as updatedAt FROM note ORDER BY updated_at DESC',
        ),
      );
      const pending = await db.getAllAsync<PendingWrite>(
        'SELECT seq, id, body FROM pending_write ORDER BY seq',
      );
      this.queue.set(pending);
      this.seq = pending.reduce((max, write) => Math.max(max, write.seq), 0);
    } catch {
      // No SQLite on this platform (Node under a test, a browser preview) - nothing was ever
      // written to read back, so an empty cache and an empty queue are the correct answer.
    }
  }

  /**
   * Fresh data when there is a connection; the cache already on screen is the offline fallback.
   * The in-memory `queue`, not a query against `pending_write`, decides which notes are still
   * local creations the server has not seen yet, so a refresh merges correctly whether or not
   * SQLite is there to ask.
   */
  async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      await this.flushPendingWrites();
      const fresh = await firstValueFrom(this.http.get<Note[]>('https://example.com/notes'));

      // Drop only notes the server no longer has and that are not still queued to be sent - a
      // pending note is never removed by a merge, only by a successful flush.
      const pendingIds = new Set(this.queue().map((write) => write.id));
      const freshIds = new Set(fresh.map((note) => note.id));
      const kept = this.list().filter((note) => pendingIds.has(note.id) && !freshIds.has(note.id));
      this.list.set([...fresh, ...kept]);
      await this.persistAll();
    } catch {
      // Offline, or the server is unreachable - the request fails and the cache stays exactly as
      // it was. There is no separate "offline branch" to write; not updating is the fallback.
    } finally {
      this.refreshing.set(false);
    }
  }

  /** Optimistic: the note is on screen and queued before the server has seen it. */
  async add(body: string): Promise<void> {
    const note: Note = { id: nextId(), body, updatedAt: Date.now() };
    this.list.update((notes) => [note, ...notes]);

    const write: PendingWrite = { seq: ++this.seq, id: note.id, body: note.body };
    this.queue.update((writes) => [...writes, write]);
    await this.persistNote(note);

    if (this.network.connected()) void this.flushPendingWrites();
  }

  /**
   * Sends whatever is queued, oldest first by `seq`, and stops at the first failure to try again
   * later. `flushing` serialises this against itself, so a reconnect and a fresh `add()` calling
   * it at the same moment cannot send the same write twice. Reads and removes from the in-memory
   * `queue`; `pending_write` is a mirror of it kept for the next launch, not what this reads.
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const ordered = [...this.queue()].sort((a, b) => a.seq - b.seq);
      for (const write of ordered) {
        try {
          await firstValueFrom(this.http.post('https://example.com/notes', write));
          this.queue.update((writes) => writes.filter((w) => w.seq !== write.seq));
          await this.deletePendingRow(write.id);
        } catch {
          break; // still offline, or the server rejected it - leave the rest queued and retry later
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The note and its queue entry, committed together in one transaction - a failure between the
   * two statements would otherwise leave a note with nothing that ever sends it. Best-effort, like
   * every SQLite call from here down: the `queue` signal above is what actually gets flushed, so
   * losing this write is losing durability across a restart, not losing the write.
   */
  private async persistNote(note: Note): Promise<void> {
    try {
      const db = await notesDb.ready();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'INSERT INTO note (id, body, updated_at) VALUES (?, ?, ?)',
          note.id,
          note.body,
          note.updatedAt,
        );
        await db.runAsync('INSERT INTO pending_write (id, body) VALUES (?, ?)', note.id, note.body);
      });
    } catch {
      // No SQLite on this platform - the in-memory queue above is what actually gets flushed.
    }
  }

  /** Mirrors `refresh()`'s merged list into `note`, wholesale - simpler than reconciling row by
   *  row, and cheap enough for a cache this size. Best-effort, as above. */
  private async persistAll(): Promise<void> {
    try {
      const db = await notesDb.ready();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM note');
        for (const note of this.list()) {
          await db.runAsync(
            'INSERT INTO note (id, body, updated_at) VALUES (?, ?, ?)',
            note.id,
            note.body,
            note.updatedAt,
          );
        }
      });
    } catch {
      // No SQLite on this platform.
    }
  }

  private async deletePendingRow(id: string): Promise<void> {
    try {
      const db = await notesDb.ready();
      await db.runAsync('DELETE FROM pending_write WHERE id = ?', id);
    } catch {
      // No SQLite on this platform.
    }
  }
}
```

The [Notes example](/examples/notes) runs this with a sync-status pill and a settings toggle to
disable sync.

The component only reads signals and calls methods; it needs no offline-specific logic:

```ts
// note-feed.ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text, TextInput } from '@ng-native/components';
import { Notes } from './notes.ts';

@Component({
  selector: 'app-note-feed',
  imports: [Pressable, Text, TextInput],
  template: `
    @if (notes.isRefreshing()) {
      <text>Refreshing…</text>
    }

    @for (note of notes.notes(); track note.id) {
      <text>{{ note.body }}</text>
    }

    <text-input placeholder="New note" [(value)]="draft" />
    <pressable (press)="addNote()">
      <text>Add</text>
    </pressable>
  `,
})
export class NoteFeed {
  protected readonly notes = inject(Notes);
  protected readonly draft = signal('');

  protected addNote(): void {
    const body = this.draft().trim();
    if (!body) return;
    void this.notes.add(body);
    this.draft.set('');
  }
}
```

Provide `HttpClient` once through `provideNativeHttpClient()` in `mount()`; see
[HTTP requests](/packages/platform#http-requests):

```ts
import { provideNativeHttpClient } from '@ng-native/platform/http';

mount(rootTag, App, getFabricUIManager(), {
  providers: [provideNativeHttpClient()],
});
```

## An interceptor, for the same reconnect signal everywhere

The `effect` handles one feed's reconnection. Use an `HttpInterceptorFn` for request-wide behavior,
such as retrying a failed `GET` once or tagging requests sent offline for the server:

```ts
import type { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

export const offlineAwareInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error) => {
      // A network failure here is XHR's own error, not an HTTP status - there was no response to
      // have a status. Distinguish it from a real 4xx/5xx before deciding whether to retry.
      if (error.status === 0) {
        console.warn(`[offline] ${req.method} ${req.url} did not reach the server`);
      }
      return throwError(() => error);
    }),
  );
```

```ts
import { withInterceptors } from '@angular/common/http';
import { provideNativeHttpClient } from '@ng-native/platform/http';

mount(rootTag, App, getFabricUIManager(), {
  providers: [provideNativeHttpClient(withInterceptors([offlineAwareInterceptor]))],
});
```

## Pitfalls

### `reachable` is not proof a request will land

[`Network`](/packages/expo/network) distinguishes a connection (`connected`) from the platform's
internet-reachability estimate (`reachable`). The estimate is `null`, not `false`, until known; on
iOS it equals `connected`. It informs the UI but does not probe your server. A banner checking
`reachable === false` must treat `null` on `reachable` as unknown, not offline.

The `refresh()` effect uses `connected` to decide whether to try a request. The `try`/`catch`
handles unreachable servers even when `Network` reports internet access. Waiting for `reachable`
would skip the first cold-start refresh while the estimate is unsettled.

### `HttpClient` needs `provideNativeHttpClient()`

Plain `provideHttpClient()` silently returns null bodies in a release build, because its default
`fetch` backend cannot read the body of React Native's own `fetch` response. The feed can appear
offline, and its `catch` blocks do not resolve the ambiguity. Always use `provideNativeHttpClient()`; see
[Known limitations](/guide/limitations#httpclient-needs-providenativehttpclient).

### The queue needs an order, a transaction, and a stopping point

`flushPendingWrites()` sorts by `seq`, sends oldest first and stops at the first failure, leaving
it queued. Reordering changes the user's write sequence; continuing after failure can leave a stuck
write retrying indefinitely alongside later writes. The `flushing` flag prevents concurrent
flushes when reconnection coincides with a new write.

`add()` inserts the note and queue entry in one transaction, preventing crashes or write failures
from leaving unsendable notes. `refresh()` merges server data into the cache and preserves queued
notes absent from the response because the server has not confirmed them.

### `Database` is not inert without `expo-sqlite` - the queue has to be

Without native modules, `Network.connected()` returns `false` and `Storage` signals retain their
`initial` values. `Database` instead rejects `notesDb.ready()` on purpose: pretending to hold rows
it does not have would be worse than saying so. See
[Without the module](/packages/expo/database#without-the-module).

A SQLite-only cache and queue therefore fail entirely without the module. If `loadFromCache()` or
`add()` awaits `notesDb.ready()` without `try`/`catch`, it rejects before queuing writes. These
unawaited calls produce unhandled rejections in Node tests and browser previews without
`expo-sqlite`.

Keep `queue` as the running app's source of truth. Wrap each `notesDb` call in `try`/`catch` so
persistence failures cannot stop dependent operations. SQLite adds durability underneath in-memory
state that already works without it - the same graceful-fallback contract `Network` and `Storage`
follow automatically, kept by hand here because `Database` will not keep it for you.
The [Notes example](/examples/notes) uses this pattern in `sync/notes.ts`; its tests exercise the
feed, queue and merge in Node without `expo-sqlite`.
