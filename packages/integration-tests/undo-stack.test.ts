/**
 * `UndoStack` from `@ng-native/device`, on a fake host and on the testing library's `fakeUndo`.
 *
 * The host contract, on the `NgNativeUndo` module:
 * - `register(id, label)` registers an action the app has done with the app's undo manager
 *   (NSUndoManager on macOS, UIUndoManager on iOS), named `label`, so Edit > Undo reads
 *   "Undo <label>". One manager serves every window. A focused text input keeps its own undo
 *   history, so Edit > Undo and mod+z reach the app's actions only when no text input has focus.
 * - Undoing an action sends `{ type: 'undo', id }` on `ngNativeUndo` and registers its redo under
 *   the same id; redoing sends `{ type: 'redo', id }` and registers the undo again. Registering
 *   anything else clears the redo history, as NSUndoManager does.
 * - `undo()` and `redo()` do what Edit > Undo and Edit > Redo do; `clear()` removes every action.
 * - Edit > Undo and Edit > Redo stay the menu bar's `undo` and `redo` role items: the OS's own, which
 *   the undo manager titles and enables. The menu model is unchanged.
 * - Android and the web host have no module, and the service is inert there.
 */
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { UndoStack, type NativeUndo, type NativeUndoEvent } from '@ng-native/device';
import { cleanup, fakeUndo, injectService, settle } from '@ng-native/testing';

afterEach(cleanup);

function recordingHost() {
  const calls: string[] = [];
  const listeners = new Set<(event: NativeUndoEvent) => void>();
  const native: NativeUndo = {
    register: (id, label) => void calls.push(`register ${id} ${label}`),
    undo: () => void calls.push('undo'),
    redo: () => void calls.push('redo'),
    clear: () => void calls.push('clear'),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const send = async (event: NativeUndoEvent) => {
    listeners.forEach((listener) => listener(event));
    await settle();
  };
  return { native, calls, send };
}

function rename(log: string[], from: string, to: string) {
  return {
    label: `Rename to ${to}`,
    undo: () => void log.push(`back to ${from}`),
    redo: () => void log.push(`again to ${to}`),
  };
}

it('registers each action with the host, and runs it when the host undoes or redoes it', async () => {
  const host = recordingHost();
  const stack = injectService(UndoStack, {
    providers: [{ provide: UndoStack.SOURCE, useValue: host.native }],
  });
  const log: string[] = [];
  stack.push(rename(log, 'a', 'b'));
  stack.push(rename(log, 'b', 'c'));
  assert.deepEqual(host.calls, ['register 1 Rename to b', 'register 2 Rename to c']);
  assert.equal(stack.available(), true);
  assert.equal(stack.undoLabel(), 'Rename to c');

  stack.undo();
  assert.deepEqual(host.calls.at(-1), 'undo');
  assert.deepEqual(log, [], 'the host undoes; the action runs when it says so');
  await host.send({ type: 'undo', id: '2' });
  assert.deepEqual(log, ['back to b']);
  assert.equal(stack.undoLabel(), 'Rename to b');
  assert.equal(stack.redoLabel(), 'Rename to c');

  await host.send({ type: 'redo', id: '2' });
  assert.deepEqual(log, ['back to b', 'again to c']);
  assert.equal(stack.canRedo(), false);

  stack.redo();
  stack.clear();
  assert.deepEqual(host.calls.slice(-2), ['redo', 'clear']);
  assert.equal(stack.canUndo(), false);
});

it('drops the redo history when something new is done, and ignores an id it no longer has', async () => {
  const host = recordingHost();
  const stack = injectService(UndoStack, {
    providers: [{ provide: UndoStack.SOURCE, useValue: host.native }],
  });
  const log: string[] = [];
  stack.push(rename(log, 'a', 'b'));
  await host.send({ type: 'undo', id: '1' });
  assert.equal(stack.canRedo(), true);
  stack.push(rename(log, 'a', 'z'));
  assert.equal(stack.canRedo(), false);
  await host.send({ type: 'redo', id: '1' });
  assert.deepEqual(log, ['back to a']);
});

it('follows Edit > Undo and Redo on the testing fake, as the undo manager orders them', async () => {
  const host = fakeUndo();
  const stack = injectService(UndoStack, {
    providers: [{ provide: UndoStack.SOURCE, useValue: host }],
  });
  const log: string[] = [];
  stack.push(rename(log, 'a', 'b'));
  stack.push(rename(log, 'b', 'c'));
  assert.equal(host.undoTitle, 'Undo Rename to c');
  host.chooseUndo();
  host.chooseUndo();
  host.chooseRedo();
  await settle();
  assert.deepEqual(log, ['back to b', 'back to a', 'again to b']);
  assert.equal(host.undoTitle, 'Undo Rename to b');
  assert.equal(host.redoTitle, 'Redo Rename to c');
  stack.undo();
  await settle();
  assert.equal(stack.undoLabel(), null);
  assert.equal(host.undoTitle, null);
});

it('does nothing where the OS has no undo manager', () => {
  const stack = injectService(UndoStack, {
    providers: [{ provide: UndoStack.SOURCE, useValue: null }],
  });
  const log: string[] = [];
  assert.equal(stack.available(), false);
  stack.push(rename(log, 'a', 'b'));
  stack.undo();
  stack.redo();
  stack.clear();
  assert.equal(stack.canUndo(), false);
  assert.deepEqual(log, []);
});
