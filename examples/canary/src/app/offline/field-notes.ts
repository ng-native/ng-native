import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { Network } from '@ng-native/expo/network';
import { Storage } from '@ng-native/expo/async-storage';
import { NotesServer, type Change } from './notes-server.ts';

export interface Note {
  readonly id: string;
  readonly text: string;
  /** The server version this copy was made from; 0 for a note the server has never seen. */
  readonly base: number;
  readonly pending: boolean;
}

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const BACKOFF = [1000, 2000, 5000, 15000, 30000];

/**
 * Notes that work with no connection. Every change lands on the device at once and in an outbox,
 * both stored, so they survive the app closing; the outbox is sent in order whenever the server
 * can be reached, retried with a growing wait while it cannot, and a change the server has
 * already applied is not applied twice. A change made on a copy someone else has since changed
 * keeps both: the other device's text as the note, this device's as a conflict copy beside it.
 */
@Service()
export class FieldNotes {
  private readonly store = inject(Storage);
  private readonly network = inject(Network);
  private readonly server = inject(NotesServer);

  readonly notes = this.store.signal<Note[]>('field-notes', []);
  readonly outbox = this.store.signal<Change[]>('field-outbox', []);
  /** The device's own switch, for trying all this without leaving the app. */
  readonly airplane = signal(false);
  readonly sending = signal(false);
  readonly lastError = signal<string | null>(null);
  /** Stored notes are read in before anything can be changed. */
  readonly ready = this.store.ready;

  /** A network that has not said it cannot reach anything, and the switch off. */
  readonly online = computed(
    () => this.network.connected() && this.network.reachable() !== false && !this.airplane(),
  );

  /** How long to wait after each failure in a row, in milliseconds; the last one repeats. */
  backoff: readonly number[] = BACKOFF;
  /** A send failed and the next waits out its backoff. */
  private readonly backingOff = signal(false);
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const idle = !this.sending() && !this.backingOff();
      if (this.online() && this.ready() && this.outbox().length > 0 && idle) void this.send();
    });
    // Coming back online is worth trying at once, whatever the backoff had reached.
    effect(() => {
      if (this.online()) untracked(() => this.retryNow());
    });
  }

  add(text: string): void {
    const note: Note = { id: newId(), text, base: 0, pending: true };
    this.notes.update((notes) => [note, ...notes]);
    this.queue({ kind: 'save', id: note.id, text, base: 0 });
  }

  edit(id: string, text: string): void {
    const note = this.notes().find((each) => each.id === id);
    if (!note) return;
    this.notes.update((notes) =>
      notes.map((each) => (each.id === id ? { ...each, text, pending: true } : each)),
    );
    this.queue({ kind: 'save', id, text, base: note.base });
  }

  remove(id: string): void {
    const note = this.notes().find((each) => each.id === id);
    if (!note) return;
    this.notes.update((notes) => notes.filter((each) => each.id !== id));
    this.queue({ kind: 'delete', id, text: '', base: note.base });
  }

  /** Try now rather than waiting out the backoff. */
  retryNow(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.attempt = 0;
    this.backingOff.set(false);
  }

  /**
   * A change to a note already waiting replaces the waiting one: only where the note ends up is
   * worth sending. It keeps the base the first was made on, which is what the server compares.
   */
  private queue(change: Omit<Change, 'op'>): void {
    this.outbox.update((outbox) => {
      const waiting = outbox.findIndex((each) => each.id === change.id);
      const op = `${change.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
      if (waiting === -1) return [...outbox, { ...change, op }];
      const first = outbox[waiting]!;
      if (first.base === 0 && change.kind === 'delete') {
        // Never sent, now deleted: there is nothing for the server to hear.
        return outbox.filter((_, at) => at !== waiting);
      }
      return outbox.map((each, at) =>
        at === waiting ? { ...change, base: first.base, op } : each,
      );
    });
  }

  /** Send the outbox, oldest first, until it is empty or a send fails. */
  private async send(): Promise<void> {
    this.sending.set(true);
    try {
      for (;;) {
        const change = this.outbox()[0];
        if (!change || !this.online()) return;
        const answer = await this.server.send(change);
        this.outbox.update((outbox) => outbox.filter((each) => each.op !== change.op));
        if (answer.ok) this.settle(change, answer.note?.version ?? null);
        else this.keepBoth(change, answer.conflict);
        this.attempt = 0;
        this.lastError.set(null);
      }
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
      this.scheduleRetry();
    } finally {
      this.sending.set(false);
    }
  }

  /** The server has it: the note is no longer pending, unless it changed again meanwhile. */
  private settle(change: Change, version: number | null): void {
    if (version === null) return;
    const still = this.outbox().some((each) => each.id === change.id);
    this.notes.update((notes) =>
      notes.map((note) =>
        note.id === change.id ? { ...note, base: version, pending: still } : note,
      ),
    );
    // A later change to the same note was made on the old base; it is on this one now.
    if (still)
      this.outbox.update((outbox) =>
        outbox.map((each) => (each.id === change.id ? { ...each, base: version } : each)),
      );
  }

  /** Someone else changed it first: theirs is the note, ours sits beside it as a copy. */
  private keepBoth(change: Change, theirs: { id: string; text: string; version: number }): void {
    const copy: Note = {
      id: newId(),
      text: `${change.text} (conflict copy)`,
      base: 0,
      pending: true,
    };
    this.notes.update((notes) => [
      ...(change.kind === 'delete' ? [] : [copy]),
      ...notes.map((note) =>
        note.id === theirs.id
          ? { ...note, text: theirs.text, base: theirs.version, pending: false }
          : note,
      ),
      ...(change.kind === 'delete' && !notes.some((n) => n.id === theirs.id)
        ? [{ id: theirs.id, text: theirs.text, base: theirs.version, pending: false }]
        : []),
    ]);
    if (change.kind !== 'delete')
      this.queue({ kind: 'save', id: copy.id, text: copy.text, base: 0 });
  }

  private scheduleRetry(): void {
    const wait = this.backoff[Math.min(this.attempt, this.backoff.length - 1)]!;
    this.attempt++;
    this.backingOff.set(true);
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.backingOff.set(false);
    }, wait);
  }
}
