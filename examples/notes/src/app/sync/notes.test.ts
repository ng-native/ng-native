import { Component } from '@angular/core';
import { Network, type NetworkStatus } from '@ng-native/expo/network';
import { Store } from '@ng-native/expo/store';
import { Storage } from '@ng-native/expo/async-storage';
import { render } from '@ng-native/testing';
import { beforeEach, expect, test } from 'vitest';
import { NOTES_API, type NoteWrite, type NotesApi } from '../api/notes-api.ts';
import type { Note } from '../data/note.ts';
import { Notes } from './notes.ts';

/** A note or two the fake server already has, distinct from the seeded local notes. */
const REMOTE: readonly Note[] = [
  {
    id: 'remote-1',
    title: 'From the server',
    body: 'Already synced.',
    pinned: false,
    updatedAt: 1,
  },
];

/** A `NotesApi` a test can see inside: every push recorded, and failures switched on to order. */
class RecordingApi implements NotesApi {
  readonly pushCalls: NoteWrite[] = [];
  private failNextCalls = 0;
  remote: Note[] = [...REMOTE];

  async list(): Promise<readonly Note[]> {
    return this.remote;
  }

  async push(write: NoteWrite): Promise<void> {
    if (this.failNextCalls > 0) {
      this.failNextCalls--;
      throw new Error('the fake server rejected the write');
    }
    this.pushCalls.push(write);
    if (write.deleted) this.remote = this.remote.filter((note) => note.id !== write.id);
    else {
      const { deleted: _deleted, ...note } = write;
      this.remote = [...this.remote.filter((n) => n.id !== note.id), note];
    }
  }

  failNextPush(times = 1): void {
    this.failNextCalls = times;
  }
}

/** A fixed `Network.SOURCE`, so a test controls connectivity without a device. */
function networkSource(status: NetworkStatus) {
  return { current: async () => status, subscribe: () => () => {} };
}

/** An empty host, just so `render()` gives the sync engine a real app injector to live in. */
@Component({ selector: 'notes-harness', template: '' })
class Harness {}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function buildNotes(options: { connected?: boolean; api?: NotesApi } = {}) {
  const connected = options.connected ?? true;
  const { componentRef } = await render(Harness, {
    providers: [
      { provide: NOTES_API, useValue: options.api ?? new RecordingApi() },
      {
        provide: Network.SOURCE,
        useValue: networkSource({
          connected,
          type: connected ? 'wifi' : 'none',
          reachable: connected,
        }),
      },
      { provide: Storage, useValue: new Store(null) },
    ],
  });
  return componentRef.injector.get(Notes);
}

let api: RecordingApi;

beforeEach(() => {
  api = new RecordingApi();
});

test('a write made offline is queued, and reaches the server once back online', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();

  await notes.add('Shopping', 'Milk and eggs');
  expect(notes.pendingCount()).toBe(1);
  expect(api.pushCalls).toHaveLength(0);

  await notes.refresh();
  expect(api.pushCalls).toHaveLength(1);
  expect(api.pushCalls[0]?.title).toBe('Shopping');
  expect(notes.pendingCount()).toBe(0);
});

test('a failed flush leaves the write queued rather than dropping it', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();

  await notes.add('Shopping', 'Milk and eggs');
  expect(notes.pendingCount()).toBe(1);

  api.failNextPush();
  await notes.refresh(); // tries to flush, and fails once
  expect(notes.pendingCount()).toBe(1);
  expect(api.pushCalls).toHaveLength(0);
  expect(notes.find(notes.notes()[0]!.id)?.title).toBe('Shopping');

  await notes.refresh(); // tries again, and this time it lands
  expect(notes.pendingCount()).toBe(0);
  expect(api.pushCalls).toHaveLength(1);
});

test('the queue flushes oldest first', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();

  await notes.add('First', 'one');
  await notes.add('Second', 'two');
  await notes.add('Third', 'three');

  await notes.refresh();
  expect(api.pushCalls.map((write) => write.title)).toEqual(['First', 'Second', 'Third']);
});

test('a flush already running is not started again', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();
  await notes.add('First', 'one');
  await notes.add('Second', 'two');

  await Promise.all([notes.refresh(), notes.refresh()]);

  expect(api.pushCalls).toHaveLength(2);
  expect(notes.pendingCount()).toBe(0);
});

test('a merge keeps a note the server has not confirmed yet', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();

  await notes.add('Not synced yet', 'still local');
  expect(notes.pendingCount()).toBe(1);

  api.failNextPush(); // the refresh below tries to flush it and fails once more
  await notes.refresh();

  const titles = notes.notes().map((note) => note.title);
  expect(titles.includes('Not synced yet')).toBe(true);
  expect(titles.includes('From the server')).toBe(true);
  expect(notes.pendingCount()).toBe(1);
});

test('the sync toggle keeps writes queued even with a connection', async () => {
  const notes = await buildNotes({ connected: true, api });
  await settle();
  notes.syncEnabled.set(false);

  await notes.add('Draft', 'kept local for now');
  await settle();

  expect(notes.status()).toBe('offline');
  expect(api.pushCalls).toHaveLength(0);

  notes.syncEnabled.set(true);
  await notes.refresh();
  expect(api.pushCalls).toHaveLength(1);
});

test('clearing local data empties both the list and the queue', async () => {
  const notes = await buildNotes({ connected: false, api });
  await settle();
  await notes.add('Throwaway', 'gone soon');
  expect(notes.pendingCount()).toBe(1);

  await notes.clearLocalData();

  expect(notes.notes()).toHaveLength(0);
  expect(notes.pendingCount()).toBe(0);
});
