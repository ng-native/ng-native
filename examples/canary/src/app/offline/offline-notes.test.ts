import { Network, type NetworkStatus } from '@ng-native/expo/network';
import { Store, type NativeStore } from '@ng-native/expo/store';
import { Storage } from '@ng-native/expo/async-storage';
import { cleanup, fireEvent, render, screen, userEvent, waitFor } from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { FieldNotes } from './field-notes.ts';
import { NotesServer } from './notes-server.ts';
import { OfflineNotes } from './offline-notes.ts';

/** What the disk holds, kept between renders so a second render is the app opened again. */
function disk(): NativeStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

function network(connected: boolean) {
  const listeners = new Set<(status: NetworkStatus) => void>();
  let status: NetworkStatus = { connected, type: 'wifi', reachable: connected };
  return {
    source: {
      current: async () => status,
      subscribe: (listener: (status: NetworkStatus) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next: boolean) {
      status = { connected: next, type: next ? 'wifi' : 'none', reachable: next };
      listeners.forEach((listener) => listener(status));
    },
  };
}

async function open(options: { native?: NativeStore; online?: boolean; server?: NotesServer }) {
  const native = options.native ?? disk();
  const net = network(options.online ?? true);
  const server = options.server ?? new NotesServer();
  server.latency = 10;
  const app = await render(OfflineNotes, {
    providers: [
      { provide: Storage, useValue: new Store(native) },
      { provide: Network.SOURCE, useValue: net.source },
      { provide: NotesServer, useValue: server },
    ],
  });
  const notes = app.componentRef.injector.get(FieldNotes);
  notes.backoff = [30];
  await waitFor(() => expect(notes.ready()).toBe(true));
  return { ...app, native, net, server, notes };
}

async function add(text: string) {
  await userEvent.type(screen.getByLabelText('New note'), text);
  await userEvent.press(screen.getByRole('button', { name: 'Add' }));
}

const banner = (text: string) => screen.findByText(text, undefined, { timeout: 2000 });

describe('field notes', () => {
  test('changes made offline show at once, and wait', async () => {
    const { server } = await open({ online: false });
    await add('Birds at the lake');
    await add('Heron');
    await userEvent.press(screen.getByRole('button', { name: 'Edit Heron' }));
    await userEvent.clear(screen.getByLabelText('Edit note'));
    await userEvent.type(screen.getByLabelText('Edit note'), 'Grey heron');
    await userEvent.press(screen.getByRole('button', { name: 'Done' }));
    await userEvent.press(screen.getByRole('button', { name: 'Delete Birds at the lake' }));
    expect(screen.getByText('Grey heron')).toBeTruthy();
    expect(screen.queryByText('Birds at the lake')).toBeNull();
    // Two notes, an edit and a delete: the edit folds into the unsent note, the delete cancels it.
    await banner('Offline, 1 change waiting');
    expect(server.received).toBe(0);
  });

  test('sends what waited once back online', async () => {
    const { net, server } = await open({ online: false });
    await add('Kingfisher');
    net.set(true);
    await banner('All changes saved');
    expect(server.all().map((note) => note.text)).toEqual(['Kingfisher']);
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  test('keeps notes and the outbox through the app closing, and sends them on reopening', async () => {
    const native = disk();
    const server = new NotesServer();
    await open({ native, server, online: false });
    await add('Otter');
    await banner('Offline, 1 change waiting');
    cleanup();

    const { net } = await open({ native, server, online: false });
    expect(screen.getByText('Otter')).toBeTruthy();
    await banner('Offline, 1 change waiting');
    net.set(true);
    await banner('All changes saved');
    expect(server.all().map((note) => note.text)).toEqual(['Otter']);
  });

  test('retries a failed send after a wait, and sends it once', async () => {
    const server = new NotesServer();
    server.failNext = 2;
    await open({ server });
    await add('Swan');
    await banner('All changes saved');
    expect(server.all()).toHaveLength(1);
    expect(server.received).toBe(1);
  });

  test('a send whose reply was lost is sent again, and applied once', async () => {
    const server = new NotesServer();
    server.dropNext = 1;
    await open({ server });
    await add('Coot');
    await banner('All changes saved');
    expect(server.received).toBe(2);
    expect(server.all()).toHaveLength(1);
  });

  test('keeps both when the note changed elsewhere while this device was offline', async () => {
    const { net, server } = await open({});
    await add('Moorhen');
    await banner('All changes saved');
    await userEvent.press(screen.getByRole('button', { name: 'Change Moorhen elsewhere' }));
    net.set(false);
    await userEvent.press(screen.getByRole('button', { name: 'Edit Moorhen' }));
    await userEvent.clear(screen.getByLabelText('Edit note'));
    await userEvent.type(screen.getByLabelText('Edit note'), 'Two moorhens');
    await userEvent.press(screen.getByRole('button', { name: 'Done' }));
    net.set(true);
    await banner('All changes saved');
    expect(screen.getByText('Moorhen (edited elsewhere)')).toBeTruthy();
    expect(screen.getByText('Two moorhens (conflict copy)')).toBeTruthy();
    expect(
      server
        .all()
        .map((note) => note.text)
        .sort(),
    ).toEqual(['Moorhen (edited elsewhere)', 'Two moorhens (conflict copy)']);
  });

  test('the in-app airplane switch stops sending, and turning it off sends', async () => {
    const { notes, server } = await open({});
    notes.airplane.set(true);
    await add('Grebe');
    await banner('Offline, 1 change waiting');
    expect(server.received).toBe(0);
    // A switch reports a flip as a change event from native, not as a touch.
    await fireEvent(screen.getByLabelText('Airplane mode'), 'change', { value: false });
    await banner('All changes saved');
  });
});
