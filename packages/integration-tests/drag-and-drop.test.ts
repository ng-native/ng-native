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
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { OS } from '@ng-native/device';
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
