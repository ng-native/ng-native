import { Service, computed, effect, inject, signal, type Signal } from '@angular/core';
import { Network } from '@ng-native/expo/network';
import { Storage } from '@ng-native/expo/async-storage';
import { NOTES_API, type NoteWrite, type NotesApi } from '../api/notes-api.ts';
import { nextId, sortNotes, type Note } from '../data/note.ts';
import { SEED_NOTES } from '../data/seed-notes.ts';
import { notesDatabase } from '../data/notes-database.ts';

export type SyncStatus = 'synced' | 'pending' | 'offline';

interface NoteRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly pinned: number;
  readonly updated_at: number;
}

interface PendingRow extends NoteRow {
  readonly seq: number;
  readonly deleted: number;
}

/** A queued write not yet sent, kept in memory so the queue works with no SQLite - see below. */
interface PendingWrite {
  readonly seq: number;
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly updatedAt: number;
  readonly deleted: boolean;
}

/**
 * The note feed: read the cache first, refresh and flush when there is a connection, queue writes
 * when there is not. Follows [Working offline](/guide/offline) - one transaction for a note and
 * its queue entry, a `seq` ordering column, a serialised flush, a merge that keeps pending local
 * notes.
 *
 * The queue lives in memory as well as in `pending_write`: SQLite persists it across launches, but
 * the signals here are the source of truth for the running app, the same "inert, not broken"
 * contract `Database` itself follows - a platform with no `expo-sqlite` module (Node under the
 * tests, a browser preview) loses nothing but durability across a restart.
 */
@Service()
export class Notes {
  private readonly api: NotesApi = inject(NOTES_API);
  private readonly network = inject(Network);
  private readonly store = inject(Storage);

  private readonly list = signal<readonly Note[]>(SEED_NOTES);
  private readonly queue = signal<readonly PendingWrite[]>([]);
  private readonly refreshing = signal(false);
  private flushing = false;
  private seq = 0;

  readonly notes: Signal<readonly Note[]> = computed(() => sortNotes(this.list()));
  readonly isRefreshing: Signal<boolean> = this.refreshing.asReadonly();
  readonly pendingCount: Signal<number> = computed(() => this.queue().length);

  /** The settings screen's sync toggle - the "offline" a demo can switch on without a real one. */
  readonly syncEnabled = this.store.signal('notes.sync-enabled', true);
  readonly lastSyncedAt = this.store.signal<number | null>('notes.last-synced-at', null);

  readonly status: Signal<SyncStatus> = computed(() => {
    if (!this.syncEnabled() || !this.network.connected()) return 'offline';
    return this.pendingCount() > 0 ? 'pending' : 'synced';
  });

  constructor() {
    void this.loadFromCache();

    // `connected`, not `reachable` - see the offline guide for why: `reachable` stays null until
    // the platform has settled it, and the first refresh after a cold start would never fire.
    effect(() => {
      if (this.syncEnabled() && this.network.connected()) void this.refresh();
    });
  }

  find(id: string): Note | undefined {
    return this.list().find((note) => note.id === id);
  }

  /** Optimistic: the note is on screen and queued before the server has seen it. */
  async add(title: string, body: string): Promise<Note> {
    const note: Note = { id: nextId(), title, body, pinned: false, updatedAt: Date.now() };
    this.list.update((notes) => [note, ...notes]);
    await this.enqueue(note, false);
    return note;
  }

  async update(id: string, changes: { title: string; body: string }): Promise<void> {
    const current = this.find(id);
    if (!current) return;
    const note: Note = { ...current, ...changes, updatedAt: Date.now() };
    this.list.update((notes) => notes.map((n) => (n.id === id ? note : n)));
    await this.enqueue(note, false);
  }

  async togglePin(id: string): Promise<void> {
    const current = this.find(id);
    if (!current) return;
    const note: Note = { ...current, pinned: !current.pinned, updatedAt: Date.now() };
    this.list.update((notes) => notes.map((n) => (n.id === id ? note : n)));
    await this.enqueue(note, false);
  }

  async remove(id: string): Promise<void> {
    const current = this.find(id);
    if (!current) return;
    this.list.update((notes) => notes.filter((n) => n.id !== id));
    await this.enqueue(current, true);
  }

  /** Everything local, gone for good - the database's own data, not just a closed handle. */
  async clearLocalData(): Promise<void> {
    this.list.set([]);
    this.queue.set([]);
    this.lastSyncedAt.set(null);
    try {
      const db = await notesDatabase.ready();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM note');
        await db.runAsync('DELETE FROM pending_write');
      });
    } catch {
      // No database on this platform - nothing was ever written to clear.
    }
  }

  /** Cached rows, on screen immediately - this is what a cold, offline start shows. */
  private async loadFromCache(): Promise<void> {
    try {
      const db = await notesDatabase.ready();
      const notes = await db.getAllAsync<NoteRow>('SELECT * FROM note ORDER BY updated_at DESC');
      const pending = await db.getAllAsync<PendingRow>('SELECT * FROM pending_write ORDER BY seq');
      if (notes.length > 0 || pending.length > 0) {
        this.list.set(notes.map(fromRow));
        this.queue.set(pending.map(fromPendingRow));
        this.seq = pending.reduce((max, row) => Math.max(max, row.seq), 0);
      } else {
        // First launch: persist the seed so the next one reads it back from disk too.
        await db.withTransactionAsync(async () => {
          for (const note of this.list()) await this.persistNote(db, note);
        });
      }
    } catch {
      // No database on this platform - the seed already stands in for it.
    }
  }

  /**
   * Fresh data when there is a connection; the cache already on screen is the offline fallback.
   * A note still in the queue has not been confirmed by the server yet, so the merge below leaves
   * it alone rather than treating the server's list as the whole truth.
   */
  async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      await this.flushPendingWrites();
      const fresh = await this.api.list();
      const pendingIds = new Set(this.queue().map((write) => write.id));
      const freshIds = new Set(fresh.map((note) => note.id));
      const kept = this.list().filter((note) => pendingIds.has(note.id) && !freshIds.has(note.id));
      this.list.set([...fresh, ...kept]);
      this.lastSyncedAt.set(Date.now());
      await this.persistAll();
    } catch {
      // Offline, or the fake server failed - the cache stays exactly as it was.
    } finally {
      this.refreshing.set(false);
    }
  }

  /** Note and queue entry, committed together so a failure between the two never loses either. */
  private async enqueue(note: Note, deleted: boolean): Promise<void> {
    const write: PendingWrite = {
      seq: ++this.seq,
      id: note.id,
      title: note.title,
      body: note.body,
      pinned: note.pinned,
      updatedAt: note.updatedAt,
      deleted,
    };
    this.queue.update((writes) => [...writes, write]);

    try {
      const db = await notesDatabase.ready();
      await db.withTransactionAsync(async () => {
        if (deleted) await db.runAsync('DELETE FROM note WHERE id = ?', note.id);
        else await this.persistNote(db, note);
        await db.runAsync(
          'INSERT INTO pending_write (id, title, body, pinned, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?)',
          note.id,
          note.title,
          note.body,
          note.pinned ? 1 : 0,
          note.updatedAt,
          deleted ? 1 : 0,
        );
      });
    } catch {
      // No database on this platform - the in-memory queue above is what actually gets flushed.
    }

    if (this.syncEnabled() && this.network.connected()) void this.flushPendingWrites();
  }

  /**
   * Sends whatever is queued, oldest first by `seq`, and stops at the first failure to try again
   * later. `flushing` serialises this against itself, so a reconnect and a fresh write landing at
   * the same moment cannot send the same write twice.
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const ordered = [...this.queue()].sort((a, b) => a.seq - b.seq);
      for (const write of ordered) {
        try {
          await this.api.push(toWrite(write));
          this.queue.update((writes) => writes.filter((w) => w.seq !== write.seq));
          await this.deletePendingRow(write.seq);
        } catch {
          break; // still offline, or the server rejected it - leave the rest queued and retry later
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async persistNote(db: Awaited<ReturnType<typeof notesDatabase.ready>>, note: Note) {
    return db.runAsync(
      `INSERT INTO note (id, title, body, pinned, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
         pinned = excluded.pinned, updated_at = excluded.updated_at`,
      note.id,
      note.title,
      note.body,
      note.pinned ? 1 : 0,
      note.updatedAt,
    );
  }

  private async persistAll(): Promise<void> {
    try {
      const db = await notesDatabase.ready();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM note');
        for (const note of this.list()) await this.persistNote(db, note);
      });
    } catch {
      // No database on this platform.
    }
  }

  private async deletePendingRow(seq: number): Promise<void> {
    try {
      const db = await notesDatabase.ready();
      await db.runAsync('DELETE FROM pending_write WHERE seq = ?', seq);
    } catch {
      // No database on this platform.
    }
  }
}

function fromRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned !== 0,
    updatedAt: row.updated_at,
  };
}

function fromPendingRow(row: PendingRow): PendingWrite {
  return {
    seq: row.seq,
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned !== 0,
    updatedAt: row.updated_at,
    deleted: row.deleted !== 0,
  };
}

function toWrite(write: PendingWrite): NoteWrite {
  return {
    id: write.id,
    title: write.title,
    body: write.body,
    pinned: write.pinned,
    updatedAt: write.updatedAt,
    deleted: write.deleted,
  };
}
