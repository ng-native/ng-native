/**
 * Menus and shortcuts as elements: `<menu-bar>`, `<menu-group>`, `<menu-item>`, `<menu-separator>`,
 * `[shortcut]` with `(shortcutPress)`, and `[contextMenu]`, through `Menus` to a fake host.
 *
 * The host contract (`NativeMenus` in `@ng-native/device`, the `NgNativeMenus` module):
 * - `setMenuBar(groups)` takes the whole merged bar each time it changes, where the host draws a
 *   bar (constant `menuBar`: macOS and iPadOS). Each item has an `id`, its `shortcut` read for the
 *   OS as `{ key, meta, ctrl, alt, shift }`, and its `menuRole`, `disabled`, `checked`,
 *   `destructive`, `subtitle`, `sfSymbol`, `icon`, `inline` and `items`. A role item is the OS's
 *   own unless it is `handled`, when the host sends its `menuSelect` instead.
 * - `setShortcuts(shortcuts)` takes `{ id, chord, label, group }` for every `[shortcut]`, and on an
 *   OS with no bar, every bar item with a shortcut and a handler too (hardware keyboards, and
 *   Android's Keyboard Shortcuts helper).
 * - Events on `ngNativeMenus`: `{ type: 'menuSelect', id }` and
 *   `{ type: 'shortcut', id, textInputFocused }`.
 * - A view with `[contextMenu]` takes a `contextMenu` prop in the same entry form (null without
 *   one) and sends `topContextMenuSelect` with `{ id }`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import {
  Menus,
  OS,
  type NativeMenuEntry,
  type NativeMenuEvent,
  type NativeMenus,
  type NativeShortcut,
} from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = {
  showBar: WritableSignal<boolean>;
  showOpen: WritableSignal<boolean>;
  dirty: WritableSignal<boolean>;
  wrap: WritableSignal<boolean>;
  said: string[];
};
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/menus.ts');
  Fixture = mod['MenusFixture'] as Type<Fixture>;
});

afterEach(cleanup);

type Group = { label: string; menuRole?: string; items: NativeMenuEntry[] };

function fakeHost(menuBar: boolean) {
  const bars: Group[][] = [];
  const shortcuts: NativeShortcut[][] = [];
  const listeners = new Set<(event: NativeMenuEvent) => void>();
  const native: NativeMenus = {
    menuBar,
    appName: 'Notes',
    setMenuBar: (groups) => void bars.push(groups as Group[]),
    setShortcuts: (list) => void shortcuts.push([...list]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    native,
    bar: () => bars.at(-1)!,
    bars,
    shortcuts: () => shortcuts.at(-1)!,
    send: async (event: NativeMenuEvent) => {
      listeners.forEach((listener) => listener(event));
      await settle();
    },
  };
}

async function open(os: 'macos' | 'android' | 'ios', menuBar: boolean) {
  registerPlatformComponents(os);
  const host = fakeHost(menuBar);
  const app = await render(Fixture, {
    providers: [
      { provide: Menus.SOURCE, useValue: host.native },
      { provide: OS, useValue: os },
    ],
  });
  await settle();
  return { host, app, said: app.instance.said };
}

/** A group's items as labels, a separator as `-`. */
const labels = (group: Group | undefined) =>
  group?.items.map((item) => ('separator' in item ? '-' : item.label));
const item = (group: Group | undefined, label: string) =>
  group?.items.find((one) => 'label' in one && one.label === label) as
    Exclude<NativeMenuEntry, { separator: true }> | undefined;

describe('the menu bar on macOS', () => {
  after(() => registerPlatformComponents('ios'));

  it('merges the app menus into the defaults, with ids and shortcuts read for the OS', async () => {
    const { host } = await open('macos', true);
    const bar = host.bar();
    assert.deepEqual(
      bar.map((group) => group.label),
      ['Notes', 'File', 'Edit', 'View', 'Format', 'Window', 'Help'],
    );
    const file = bar[1];
    assert.deepEqual(labels(file), ['New', '-', 'Save', '-', 'Close Window']);
    assert.deepEqual(item(file, 'New')?.shortcut, {
      key: 'n',
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    assert.equal(item(file, 'Save')?.disabled, true);
    assert.ok(labels(bar[0])?.includes('Settings...'), 'Settings... shows, with a handler');
    // A role item with no (select) is not handled: the host still does Copy itself.
    const copy = item(bar[2], 'Copy Note');
    assert.equal(copy?.menuRole, 'copy', 'the app item replaced the default Copy');
    assert.equal(copy?.handled, undefined);
    assert.equal(item(bar[0], 'Settings...')?.handled, true);
  });

  it('gives Back and Forward the OS keys for them, not a mod chord', async () => {
    const { host } = await open('macos', true);
    const view = host.bar().find((group) => group.label === 'View');
    assert.deepEqual(item(view, 'Back')?.shortcut, {
      key: '[',
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    assert.equal(item(view, 'Forward')?.shortcut?.key, ']');
  });

  it('hands the OS back and forward commands to whoever listens, with their window', async () => {
    const { host, app } = await open('macos', true);
    const heard: unknown[] = [];
    const stop = app.componentRef.injector
      .get(Menus)
      .onNavigate((direction, surface) => heard.push([direction, surface]));
    await host.send({ type: 'navigate', direction: 'back', surface: 11 });
    stop();
    await host.send({ type: 'navigate', direction: 'forward' });
    assert.deepEqual(heard, [['back', 11]]);
  });

  it('runs what the item chosen does, and toggles a checked one', async () => {
    const { host, app, said } = await open('macos', true);
    await host.send({ type: 'menuSelect', id: item(host.bar()[1], 'New')!.id });
    await host.send({ type: 'menuSelect', id: item(host.bar()[0], 'Settings...')!.id });
    assert.deepEqual(said, ['new', 'settings']);
    await host.send({ type: 'menuSelect', id: item(host.bar()[4], 'Wrap Lines')!.id });
    assert.equal(app.instance.wrap(), true);
    assert.equal(item(host.bar()[4], 'Wrap Lines')?.checked, true, 'sent again, checked');
  });

  it('follows the items: a shown item takes its place, and a re-enabled one is sent', async () => {
    const { host, app } = await open('macos', true);
    app.instance.showOpen.set(true);
    app.instance.dirty.set(true);
    await app.detectChanges();
    assert.deepEqual(labels(host.bar()[1]), ['New', 'Open', '-', 'Save', '-', 'Close Window']);
    assert.equal(item(host.bar()[1], 'Save')?.disabled, undefined);
  });

  it('goes back to the defaults as the menu bar goes', async () => {
    const { host, app } = await open('macos', true);
    app.instance.showBar.set(false);
    await app.detectChanges();
    assert.deepEqual(
      host.bar().map((group) => group.label),
      ['Notes', 'Edit', 'View', 'Window', 'Help'],
    );
    assert.ok(!labels(host.bar()[0])?.includes('Settings...'), 'no handler, no Settings...');
  });
});

describe('shortcuts', () => {
  after(() => registerPlatformComponents('ios'));

  it('sends every [shortcut] with its label, and fires the one pressed', async () => {
    const { host, said } = await open('macos', true);
    const search = host.shortcuts().find((one) => one.label === 'Search')!;
    assert.equal(search.chord.key, 'k');
    assert.equal(search.chord.meta, true);
    await host.send({ type: 'shortcut', id: search.id, textInputFocused: false });
    assert.deepEqual(said, ['search']);
  });

  it('leaves an editing key to a focused text input', async () => {
    const { host, said } = await open('macos', true);
    const all = host.shortcuts().find((one) => one.label === 'Select Every Note')!;
    await host.send({ type: 'shortcut', id: all.id, textInputFocused: true });
    assert.deepEqual(said, []);
    await host.send({ type: 'shortcut', id: all.id, textInputFocused: false });
    assert.deepEqual(said, ['all']);
  });

  it('has the menu items shortcuts on Android, with Ctrl, and draws no bar', async () => {
    const { host, said } = await open('android', false);
    assert.equal(host.bars.length, 0, 'no menu bar on a phone');
    const shortcuts = host.shortcuts();
    const fresh = shortcuts.find((one) => one.label === 'New')!;
    assert.deepEqual(
      { ...fresh.chord, group: fresh.group },
      { key: 'n', meta: false, ctrl: true, alt: false, shift: false, group: 'File' },
    );
    assert.equal(
      shortcuts.find((one) => one.label === 'Save'),
      undefined,
      'a disabled item has no shortcut',
    );
    await host.send({ type: 'shortcut', id: fresh.id });
    assert.deepEqual(said, ['new']);
  });

  it('stops listening as the element with the shortcut goes', async () => {
    const { host, app } = await open('android', false);
    app.instance.showBar.set(false);
    await app.detectChanges();
    assert.equal(
      host.shortcuts().find((one) => one.label === 'New'),
      undefined,
    );
  });
});

describe('a context menu', () => {
  after(() => registerPlatformComponents('ios'));

  it('commits its items as the view contextMenu prop, and runs the one chosen', async () => {
    const { said } = await open('ios', false);
    const row = screen.getByTestId('row');
    const menu = row.props['contextMenu'] as NativeMenuEntry[];
    assert.deepEqual(menu, [
      { id: '0', label: 'Rename', sfSymbol: 'pencil', icon: 'ic_edit' },
      { id: '1', label: 'Delete', destructive: true },
    ]);
    const { fireEvent } = await import('@ng-native/testing');
    await fireEvent(row, 'contextMenuSelect', { id: '1' });
    assert.deepEqual(said, ['delete']);
  });

  for (const [os, fires] of [
    ['android', false],
    ['ios', false],
    ['macos', true],
  ] as const) {
    it(`${fires ? 'still fires' : 'takes'} the long press on ${os}`, async () => {
      const { said } = await open(os, os === 'macos');
      const row = screen.getByTestId('row');
      const { fireEvent } = await import('@ng-native/testing');
      await fireEvent(row, 'touchStart', { touches: [{}], changedTouches: [{}] });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await fireEvent(row, 'touchEnd', { touches: [], changedTouches: [{}] });
      assert.deepEqual(said, fires ? ['long'] : []);
    });
  }
});
