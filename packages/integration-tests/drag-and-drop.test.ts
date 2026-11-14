/**
 * Drag and drop on macOS and iPadOS: `(fileDragEnter)`, `(fileDragLeave)` and `(fileDrop)` take
 * files, text and URLs dragged onto a view, and `[dragItem]` lets a view be dragged out to Finder,
 * another app or another view. Both are directives in `@ng-native/components`.
 *
 * The host contract, which no other test records:
 *
 * | Committed prop | Value                                    | Events the host sends            |
 * | -------------- | ---------------------------------------- | -------------------------------- |
 * | `fileDrop`     | `true` while the view takes drops        | `topDropEnter`, `topDropLeave`,  |
 * |                |                                          | `topDropPerform`                 |
 * | `dragItem`     | `{ files, text, url }`, or null for none | none                             |
 *
 * - The drop events carry `{ files, text, urls }`: `files` an array of `{ uri, name }` (each file's
 *   `file://` url and its name), `text` the dragged plain text or null, and `urls` every dragged
 *   url that is not a file. `topDropEnter` carries what is being dragged, as far as the OS shows it
 *   before the drop. A drop ends the drag without `topDropLeave`.
 * - `dragItem.files` are `file://` urls, `text` and `url` are a string or null. The host starts a
 *   drag session (NSDraggingSession, UIDragInteraction) from a mouse drag or a long press on the
 *   view with every representation it has.
 * - A view with either prop is never flattened away.
 * - The events are not `topFileDrop` and its siblings, which a `(fileDrop)` binding also listens
 *   for, so the directive's output fires once and not twice.
 * - Neither prop is committed on Android or in the web host, where both are absent; iPhone's host
 *   ignores them.
 * - React Native's iOS view reads neither prop and sends no event it does not know, so on iOS,
 *   where the host has the `NgNativeDragAndDrop` module (`NativeDragAndDrop` in
 *   `@ng-native/device`), the view is named by a `nativeID` as `[contextMenu]` names it, and the
 *   module takes `setFileDrop(nativeID, takes)` and `setDragItem(nativeID, item)` in the props'
 *   form. It sends `{ type, nativeID, files, text, urls }` on `ngNativeDragAndDrop`, `type` being
 *   `dropEnter`, `dropLeave` or `dropPerform`, which run the bindings as the view's events would.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { describe } from 'node:test';
import { signal, type Type, type WritableSignal } from '@angular/core';
import { DragAndDrop, OS, type NativeDragAndDrop, type NativeDropEvent } from '@ng-native/device';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

type Fixture = {
  heard(): string[];
  item: WritableSignal<{ files?: string[]; text?: string; url?: string } | null>;
};
let Fixture: Type<Fixture>;
before(async () => {
  const mod = await compileFixture('fixtures/drag-and-drop.ts');
  Fixture = mod['DragAndDrop'] as Type<Fixture>;
});

const NOTES = {
  files: [{ uri: 'file:///Users/me/notes.md', name: 'notes.md' }],
  text: null,
  urls: [],
};

it('opts a view with any of the drop bindings into drops, and no other view', async () => {
  await render(Fixture, { providers: [{ provide: OS, useValue: 'macos' }] });
  assert.equal(screen.getByTestId('target').props['fileDrop'], true);
  assert.equal(screen.getByTestId('enter-only').props['fileDrop'], true);
  assert.equal(screen.getByTestId('plain').props['fileDrop'], undefined);
});

it('runs each drop binding once, with the files, text and urls dragged', async () => {
  const { componentRef } = await render(Fixture, {
    providers: [{ provide: OS, useValue: 'macos' }],
  });
  const target = screen.getByTestId('target');
  await fireEvent(target, 'dropEnter', NOTES);
  await fireEvent(target, 'dropLeave', {});
  await fireEvent(target, 'dropPerform', {
    files: [],
    text: 'Hello',
    urls: ['https://example.com/'],
  });
  await settle();
  assert.deepEqual(componentRef.instance.heard(), [
    'enter notes.md file:///Users/me/notes.md',
    'leave',
    'drop Hello | https://example.com/',
  ]);
});

it('fills in what a host leaves out of a drop', async () => {
  const { componentRef } = await render(Fixture, {
    providers: [{ provide: OS, useValue: 'macos' }],
  });
  await fireEvent(screen.getByTestId('target'), 'dropPerform', { text: 'Hi' });
  await settle();
  assert.deepEqual(componentRef.instance.heard(), ['drop Hi']);
});

it('drives the drop bindings from userEvent.dropFiles', async () => {
  const { componentRef } = await render(Fixture, {
    providers: [{ provide: OS, useValue: 'macos' }],
  });
  await userEvent.dropFiles(screen.getByTestId('target'), ['/Users/me/my notes.md']);
  assert.deepEqual(componentRef.instance.heard(), [
    'enter my notes.md file:///Users/me/my%20notes.md',
    'drop my notes.md file:///Users/me/my%20notes.md',
  ]);
});

it('commits a drag item as file urls, text and a url, and takes it away with null', async () => {
  const { componentRef } = await render(Fixture, { providers: [{ provide: OS, useValue: 'ios' }] });
  const source = () => screen.getByTestId('source').props['dragItem'];
  assert.equal(source(), undefined);
  componentRef.instance.item.set({ files: ['/Users/me/a b.md', 'file:///tmp/c.md'] });
  await settle();
  assert.deepEqual(source(), {
    files: ['file:///Users/me/a%20b.md', 'file:///tmp/c.md'],
    text: null,
    url: null,
  });
  componentRef.instance.item.set({ text: 'Hello', url: 'https://example.com/' });
  await settle();
  assert.deepEqual(source(), { files: [], text: 'Hello', url: 'https://example.com/' });
  componentRef.instance.item.set(null);
  await settle();
  assert.equal(source(), null);
});

it('commits neither prop on Android, where drag and drop is absent', async () => {
  const { componentRef } = await render(Fixture, {
    providers: [{ provide: OS, useValue: 'android' }],
  });
  componentRef.instance.item.set({ text: 'Hello' });
  await settle();
  assert.equal(screen.getByTestId('target').props['fileDrop'], undefined);
  assert.equal(screen.getByTestId('source').props['dragItem'], undefined);
});

describe("on iOS, through the host's module", () => {
  function fakeModule() {
    const calls: string[] = [];
    const listeners = new Set<(event: NativeDropEvent) => void>();
    const native: NativeDragAndDrop = {
      setFileDrop: (id, takes) => void calls.push(`drop ${id} ${takes}`),
      setDragItem: (id, item) => void calls.push(`drag ${id} ${JSON.stringify(item)}`),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const send = async (event: NativeDropEvent) => {
      listeners.forEach((listener) => listener(event));
      await settle();
    };
    return { native, calls, send };
  }

  async function open(os: 'ios' | 'macos') {
    const host = fakeModule();
    const { componentRef } = await render(Fixture, {
      providers: [
        { provide: OS, useValue: os },
        { provide: DragAndDrop.SOURCE, useValue: host.native },
      ],
    });
    await settle();
    const id = (testID: string) => screen.getByTestId(testID).props['nativeID'] as string;
    return { host, fixture: componentRef.instance, id };
  }

  it('names each view and tells the module which take drops and what each offers', async () => {
    const { host, fixture, id } = await open('ios');
    assert.equal(screen.getByTestId('plain').props['nativeID'], undefined);
    assert.ok(host.calls.includes(`drop ${id('target')} true`));
    assert.ok(host.calls.includes(`drop ${id('enter-only')} true`));
    assert.ok(host.calls.includes(`drag ${id('source')} null`));
    host.calls.length = 0;
    fixture.item.set({ files: ['/tmp/a b.md'], url: 'https://example.com/' });
    await settle();
    const offered = JSON.stringify({
      files: ['file:///tmp/a%20b.md'],
      text: null,
      url: 'https://example.com/',
    });
    assert.deepEqual(host.calls.sort(), [
      `drag ${id('both')} ${offered}`,
      `drag ${id('source')} ${offered}`,
    ]);
  });

  it('gives a view with both a drop and a drag one name', async () => {
    const { host, id } = await open('ios');
    const both = id('both');
    assert.ok(host.calls.includes(`drop ${both} true`));
    assert.ok(host.calls.includes(`drag ${both} null`));
    assert.equal(new Set(['target', 'enter-only', 'source', 'both'].map(id)).size, 4);
  });

  it("runs each binding once from the module's events for its view, and none for another", async () => {
    const { host, fixture, id } = await open('ios');
    const target = id('target');
    await host.send({ type: 'dropEnter', nativeID: target, ...NOTES });
    await host.send({ type: 'dropLeave', nativeID: target });
    await host.send({ type: 'dropPerform', nativeID: target, text: 'Hello' });
    await host.send({ type: 'dropPerform', nativeID: 'elsewhere', text: 'Nope' });
    assert.deepEqual(fixture.heard(), [
      'enter notes.md file:///Users/me/notes.md',
      'leave',
      'drop Hello',
    ]);
  });

  it('takes the drop and the drag away as the element goes', async () => {
    const host = fakeModule();
    const shown = signal(true);
    const { FileDrop, DragItem, View } = await import('@ng-native/components');
    const app = await render(
      `@if (shown()) {
        <view nativeID="tray" (fileDrop)="dropped()" [dragItem]="{ text: 'Hi' }"></view>
      }`,
      {
        imports: [View, FileDrop, DragItem],
        providers: [
          { provide: OS, useValue: 'ios' },
          { provide: DragAndDrop.SOURCE, useValue: host.native },
        ],
        componentProperties: { shown, dropped: () => host.calls.push('dropped') },
      },
    );
    await settle();
    host.calls.length = 0;
    shown.set(false);
    await app.detectChanges();
    await host.send({ type: 'dropPerform', nativeID: 'tray', text: 'Late' });
    assert.deepEqual(host.calls.sort(), ['drag tray null', 'drop tray false']);
  });

  it('leaves macOS to the props, naming nothing and calling no module', async () => {
    const { host } = await open('macos');
    assert.deepEqual(host.calls, []);
    assert.equal(screen.getByTestId('target').props['nativeID'], undefined);
    assert.equal(screen.getByTestId('target').props['fileDrop'], true);
  });
});
