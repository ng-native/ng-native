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
 * - Android and iOS read no prop React Native's view does not know, so their host has
 *   `setContextMenu(nativeID, entries)` (null to take it away): the view is found by its
 *   `nativeID`, which the element is given where the app gave it none. Android's view sends
 *   `topContextMenuSelect` itself; iOS's host sends `{ type: 'contextMenuSelect', nativeID, id }`
 *   on `ngNativeMenus` instead, which reaches the element as `topContextMenuSelect`.
 * - Android's module is an Expo module: its constants are properties, and it sends the same events
 *   through its own `addListener('ngNativeMenus', ...)`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, signal, type Type, type WritableSignal } from '@angular/core';
import {
  Menus,
  OS,
  menusSource,
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
  renaming: WritableSignal<boolean>;
  copy: () => { select: { subscribe(listener: () => void): { unsubscribe(): void } } } | undefined;
  said: string[];
};
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/menus.ts');
  Fixture = mod['MenusFixture'] as Type<Fixture>;
});

afterEach(cleanup);

type Group = { label: string; menuRole?: string; items: NativeMenuEntry[] };

function fakeHost(menuBar: boolean, drawsContextMenus = false, leavesLongPresses = false) {
  const bars: Group[][] = [];
  const contextMenus = new Map<string, NativeMenuEntry[] | null>();
  const longPressTakers = new Set<string>();
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
    ...(drawsContextMenus && {
      setContextMenu: (nativeId: string, entries: readonly NativeMenuEntry[] | null) =>
        void contextMenus.set(nativeId, entries && [...entries]),
    }),
    ...(leavesLongPresses && {
      setTakesLongPress: (nativeId: string, takes: boolean) =>
        void (takes ? longPressTakers.add(nativeId) : longPressTakers.delete(nativeId)),
    }),
  };
  return {
    native,
    contextMenus,
    longPressTakers,
    bar: () => bars.at(-1)!,
    bars,
    shortcuts: () => shortcuts.at(-1)!,
    send: async (event: NativeMenuEvent) => {
      listeners.forEach((listener) => listener(event));
      await settle();
    },
  };
}

async function open(os: 'macos' | 'android' | 'ios', menuBar: boolean, drawsContextMenus = false) {
  registerPlatformComponents(os);
  const host = fakeHost(menuBar, drawsContextMenus);
  const app = await render(Fixture, {
    providers: [
      { provide: Menus.SOURCE, useValue: host.native },
      { provide: OS, useValue: os },
    ],
  });
  await settle();
  return { host, app, said: app.instance.said };
}

/** Menu entries with each item's id as `action`, where it is its handler's (`a12`). */
const byPlace = (entries: readonly NativeMenuEntry[] | null | undefined) =>
  entries?.map((entry) =>
    'id' in entry && /^a\d+$/.test(entry.id) ? { ...entry, id: 'action' } : entry,
  );
/** The id of the entry labelled `label`. */
const idOf = (entries: readonly NativeMenuEntry[] | null | undefined, label: string) =>
  (entries?.find((entry) => 'label' in entry && entry.label === label) as { id: string }).id;

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
    assert.deepEqual(labels(file), ['New', '-', 'Save', '-', 'Close Window', '-', 'Print...']);
    assert.deepEqual(item(file, 'Print...')?.menuRole, 'print');
    assert.equal(item(file, 'Print...')?.shortcut?.key, 'p');
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
    assert.deepEqual(labels(host.bar()[1]), [
      'New',
      'Open',
      '-',
      'Save',
      '-',
      'Close Window',
      '-',
      'Print...',
    ]);
    assert.equal(item(host.bar()[1], 'Save')?.disabled, undefined);
  });

  it('goes back to the defaults as the menu bar goes', async () => {
    const { host, app } = await open('macos', true);
    app.instance.showBar.set(false);
    await app.detectChanges();
    assert.deepEqual(
      host.bar().map((group) => group.label),
      ['Notes', 'File', 'Edit', 'View', 'Window', 'Help'],
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

describe('a shortcut with no host to send it to', () => {
  it('is still checked, as it is first given and as it changes', async () => {
    const errors: unknown[] = [];
    const key = signal('mod+k');
    const { Shortcut, View } = await import('@ng-native/components');
    const app = await render(`<view [shortcut]="key()" (shortcutPress)="0"></view>`, {
      imports: [Shortcut, View],
      providers: [
        { provide: Menus.SOURCE, useValue: null },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => errors.push(error) },
        },
      ],
      componentProperties: { key },
    });
    await settle();
    assert.deepEqual(errors, []);
    key.set('hyper+k');
    // Thrown out of change detection, or handed to the ErrorHandler: either way, said.
    const failure = await app.detectChanges().then(
      () => settle().then(() => errors[0]),
      (error: unknown) => error,
    );
    assert.match(String(failure), /no modifier 'hyper'/);
  });
});

describe('a role item listened to later', () => {
  after(() => registerPlatformComponents('ios'));

  it("is the app's while something listens to its select, and the OS's again after", async () => {
    const { host, app, said } = await open('macos', true);
    const copy = () => item(host.bar()[2], 'Copy Note');
    assert.equal(copy()?.handled, undefined);
    const subscription = app.instance.copy()!.select.subscribe(() => said.push('copy'));
    await app.detectChanges();
    assert.equal(copy()?.handled, true);
    await host.send({ type: 'menuSelect', id: copy()!.id });
    assert.deepEqual(said, ['copy']);
    const another = app.instance.copy()!.select.subscribe(() => {});
    subscription.unsubscribe();
    subscription.unsubscribe();
    await app.detectChanges();
    assert.equal(copy()?.handled, true, 'one listener stopped twice leaves the other');
    another.unsubscribe();
    await app.detectChanges();
    assert.equal(copy()?.handled, undefined);
  });
});

describe('a context menu', () => {
  after(() => registerPlatformComponents('ios'));

  it('commits its items as the view contextMenu prop, and runs the one chosen', async () => {
    const { said } = await open('ios', false);
    const row = screen.getByTestId('row');
    const menu = row.props['contextMenu'] as NativeMenuEntry[];
    assert.deepEqual(byPlace(menu), [
      { id: 'action', label: 'Rename', sfSymbol: 'pencil', icon: 'ic_edit' },
      { id: 'action', label: 'Delete', destructive: true },
    ]);
    const { fireEvent } = await import('@ng-native/testing');
    await fireEvent(row, 'contextMenuSelect', { id: idOf(menu, 'Delete') });
    assert.deepEqual(said, ['delete']);
  });

  it('runs nothing for a choice from the menu as it was before an item went', async () => {
    const { app, said } = await open('macos', false);
    const row = screen.getByTestId('row');
    const rename = idOf(row.props['contextMenu'] as NativeMenuEntry[], 'Rename');
    app.instance.renaming.set(false);
    await app.detectChanges();
    const { fireEvent } = await import('@ng-native/testing');
    await fireEvent(row, 'contextMenuSelect', { id: rename });
    assert.deepEqual(said, [], 'Delete, now first, is not run in its place');
  });

  // Android's and iOS's hosts draw the menu on a long press where they have `setContextMenu`, and
  // the long press is then the menu's. macOS opens it with a right-click.
  for (const [os, hostDraws, fires] of [
    ['android', true, false],
    ['android', false, true],
    ['ios', true, false],
    ['ios', false, true],
    ['macos', false, true],
  ] as const) {
    const where = os !== 'macos' && !hostDraws ? ' with no host to draw it' : '';
    it(`${fires ? 'still fires' : 'takes'} the long press on ${os}${where}`, async () => {
      const { said } = await open(os, os === 'macos', hostDraws);
      const row = screen.getByTestId('row');
      const { fireEvent } = await import('@ng-native/testing');
      await fireEvent(row, 'touchStart', { touches: [{}], changedTouches: [{}] });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await fireEvent(row, 'touchEnd', { touches: [], changedTouches: [{}] });
      assert.deepEqual(said, fires ? ['long'] : []);
    });
  }
});

// Each menu shows no item, from the start or (`dropped`) once its last item goes.
const itemless = [
  ['has no items', '@if (pinned()) { <menu-item label="Pin" /> }', false],
  [
    'shows only a separator and an empty section',
    '<menu-separator /><menu-group label="Share" inline>@if (pinned()) { <menu-item label="Pin" /> }</menu-group>',
    false,
  ],
  [
    'loses the last item of a section that stays',
    '<menu-group label="Share" inline>@if (pinned()) { <menu-item label="Pin" /> }</menu-group>',
    true,
  ],
] as const;

for (const os of ['android', 'ios'] as const)
  for (const [what, items, dropped] of itemless) {
    it(`leaves the long press to (longPress) where the menu on ${os} ${what}`, async () => {
      registerPlatformComponents(os);
      try {
        const host = fakeHost(false, true);
        const said: string[] = [];
        const pinned = signal(dropped);
        const { ContextMenu, MenuGroup, MenuItem, MenuSeparator, Pressable } =
          await import('@ng-native/components');
        await render(
          `<pressable testID="row" [contextMenu]="menu" (longPress)="said.push('long')"></pressable>
        <ng-template #menu>${items}</ng-template>`,
          {
            imports: [ContextMenu, MenuGroup, MenuItem, MenuSeparator, Pressable],
            providers: [
              { provide: Menus.SOURCE, useValue: host.native },
              { provide: OS, useValue: os },
            ],
            componentProperties: { said, pinned },
          },
        );
        await settle();
        const row = screen.getByTestId('row');
        const sent = () => host.contextMenus.get(row.props['nativeID'] as string);
        if (dropped) {
          assert.notEqual(sent(), null, 'the menu while its item is there');
          pinned.set(false);
          await settle();
        }
        assert.equal(sent(), null);
        const { fireEvent } = await import('@ng-native/testing');
        await fireEvent(row, 'touchStart', { touches: [{}], changedTouches: [{}] });
        await new Promise((resolve) => setTimeout(resolve, 600));
        await fireEvent(row, 'touchEnd', { touches: [], changedTouches: [{}] });
        assert.deepEqual(said, ['long']);
      } finally {
        registerPlatformComponents('ios');
      }
    });
  }

for (const os of ['android', 'ios'] as const) {
  describe(`a context menu on ${os}`, () => {
    after(() => registerPlatformComponents('ios'));

    it('names the view and sends its menu to the host by that name', async () => {
      const { host } = await open(os, false, true);
      const row = screen.getByTestId('row');
      const id = row.props['nativeID'];
      assert.equal(typeof id, 'string');
      assert.deepEqual(byPlace(host.contextMenus.get(id as string)), [
        { id: 'action', label: 'Rename', icon: 'ic_edit', sfSymbol: 'pencil' },
        { id: 'action', label: 'Delete', destructive: true },
      ]);
    });

    it('sends nothing by name to a host without setContextMenu, and names nothing', async () => {
      await open(os, false, false);
      assert.equal(screen.getByTestId('row').props['nativeID'], undefined);
    });

    it('keeps a nativeID the app gave, and takes the menu away as the element goes', async () => {
      registerPlatformComponents(os);
      const host = fakeHost(false, true);
      const { ContextMenu, MenuItem, View } = await import('@ng-native/components');
      const app = await render(
        `@if (shown()) {
          <view testID="target" nativeID="note-7" [contextMenu]="menu"></view>
        }
        <ng-template #menu><menu-item label="Pin" /></ng-template>`,
        {
          imports: [View, ContextMenu, MenuItem],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: os },
          ],
          componentProperties: { shown: signal(true) },
        },
      );
      await settle();
      assert.equal(screen.getByTestId('target').props['nativeID'], 'note-7');
      assert.deepEqual(byPlace(host.contextMenus.get('note-7')), [{ id: 'action', label: 'Pin' }]);
      (app.instance as unknown as { shown: WritableSignal<boolean> }).shown.set(false);
      await app.detectChanges();
      assert.equal(host.contextMenus.get('note-7'), null);
    });

    it('follows a nativeID the app binds late, renames and takes away', async () => {
      registerPlatformComponents(os);
      const host = fakeHost(false, true);
      const id = signal<string | null>(null);
      const { ContextMenu, MenuItem, View } = await import('@ng-native/components');
      const app = await render(
        `<view testID="target" [nativeID]="id()" [contextMenu]="menu"></view>
        <ng-template #menu><menu-item label="Pin" /></ng-template>`,
        {
          imports: [View, ContextMenu, MenuItem],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: os },
          ],
          componentProperties: { id },
        },
      );
      await settle();
      const given = screen.getByTestId('target').props['nativeID'] as string;
      assert.deepEqual(byPlace(host.contextMenus.get(given)), [{ id: 'action', label: 'Pin' }]);
      const held = () =>
        [...host.contextMenus].filter(([, entries]) => entries !== null).map(([name]) => name);

      id.set('note-1');
      await app.detectChanges();
      await settle();
      assert.equal(screen.getByTestId('target').props['nativeID'], 'note-1');
      assert.deepEqual(held(), ['note-1'], 'the bound id holds the menu, the given one none');

      id.set('note-2');
      await app.detectChanges();
      await settle();
      assert.deepEqual(held(), ['note-2'], 'a rename moves the menu');

      id.set(null);
      await app.detectChanges();
      await settle();
      const back = screen.getByTestId('target').props['nativeID'];
      assert.equal(back, given, 'the element is named again once the app takes its id away');
      assert.deepEqual(held(), [given], 'and the menu goes back to that name');
    });
  });
}

for (const os of ['android', 'ios'] as const) {
  describe(`a long press inside a context menu's element on ${os}`, () => {
    after(() => registerPlatformComponents('ios'));

    async function openRow(host: ReturnType<typeof fakeHost>) {
      registerPlatformComponents(os);
      const shown = signal(true);
      const said: string[] = [];
      const { ContextMenu, MenuItem, Pressable, View } = await import('@ng-native/components');
      const app = await render(
        `@if (shown()) {
          <view testID="row" [contextMenu]="menu">
            <pressable testID="handle" (longPress)="said.push('reorder')"></pressable>
            <pressable testID="plain" (press)="said.push('open')"></pressable>
          </view>
        }
        <ng-template #menu><menu-item label="Pin" /></ng-template>`,
        {
          imports: [View, ContextMenu, MenuItem, Pressable],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: os },
          ],
          componentProperties: { shown, said },
        },
      );
      await settle();
      return { app, shown, said };
    }

    it('tells the host that a pressable with its own (longPress) takes the long press', async () => {
      const host = fakeHost(false, true, true);
      const { app, shown, said } = await openRow(host);
      const handle = screen.getByTestId('handle').props['nativeID'];
      assert.equal(typeof handle, 'string');
      assert.deepEqual([...host.longPressTakers], [handle]);
      assert.equal(screen.getByTestId('plain').props['nativeID'], undefined);
      const { fireEvent } = await import('@ng-native/testing');
      const target = screen.getByTestId('handle');
      await fireEvent(target, 'touchStart', { touches: [{}], changedTouches: [{}] });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await fireEvent(target, 'touchEnd', { touches: [], changedTouches: [{}] });
      assert.deepEqual(said, ['reorder'], 'the menu is not on the pressable, so it fires');
      shown.set(false);
      await app.detectChanges();
      assert.deepEqual([...host.longPressTakers], [], 'and takes it back as the pressable goes');
    });

    // The host opens the innermost menu after its own long-press timeout, which can be later than
    // a pressable around it fires its (longPress): that pressable leaves the hold to the menu.
    it('leaves a long press on a menu inside a pressable to the menu', async () => {
      registerPlatformComponents(os);
      const host = fakeHost(false, true, true);
      const said: string[] = [];
      const pinnable = signal(true);
      const { ContextMenu, MenuItem, Pressable, View } = await import('@ng-native/components');
      const app = await render(
        `<pressable testID="card" [delayLongPress]="50" (longPress)="said.push('card')">
          <view testID="row" [contextMenu]="menu">
            <pressable testID="off" [disabled]="true" (longPress)="0"></pressable>
          </view>
          <view testID="plain"></view>
        </pressable>
        <ng-template #menu>
          @if (pinnable()) {
            <menu-item label="Pin" />
          }
        </ng-template>`,
        {
          imports: [View, ContextMenu, MenuItem, Pressable],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: os },
          ],
          componentProperties: { said, pinnable },
        },
      );
      await settle();
      const { fireEvent } = await import('@ng-native/testing');
      const hold = async (testId: string) => {
        const target = screen.getByTestId(testId);
        await fireEvent(target, 'touchStart', { touches: [{}], changedTouches: [{}] });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await fireEvent(target, 'touchEnd', { touches: [], changedTouches: [{}] });
      };
      await hold('row');
      assert.deepEqual(said, [], 'the menu on the row takes the hold');
      await hold('plain');
      assert.deepEqual(said, ['card'], 'outside the menu the pressable keeps it');
      await hold('off');
      assert.deepEqual(
        said,
        ['card', 'card'],
        'a view inside the menu that takes the long press opens no menu, as the host decides',
      );
      pinnable.set(false);
      await app.detectChanges();
      await settle();
      await hold('row');
      assert.deepEqual(said, ['card', 'card', 'card'], 'nor does a menu whose items went');
    });

    it('decides who owns the hold as the press begins, not when a delayed press-in starts', async () => {
      registerPlatformComponents(os);
      const host = fakeHost(false, true, true);
      const said: string[] = [];
      const pinnable = signal(false);
      const { ContextMenu, MenuItem, Pressable, View } = await import('@ng-native/components');
      const app = await render(
        `<pressable testID="card" [delayPressIn]="80" [delayLongPress]="50" (longPress)="said.push('card')">
          <view testID="row" [contextMenu]="menu"></view>
        </pressable>
        <ng-template #menu>
          @if (pinnable()) {
            <menu-item label="Pin" />
          }
        </ng-template>`,
        {
          imports: [View, ContextMenu, MenuItem, Pressable],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: os },
          ],
          componentProperties: { said, pinnable },
        },
      );
      await settle();
      const { fireEvent } = await import('@ng-native/testing');
      const target = screen.getByTestId('row');
      await fireEvent(target, 'touchStart', { touches: [{}], changedTouches: [{}] });
      // The menu arrives while the press-in waits: the host, which decided as the touch began, opens
      // nothing, so the pressable keeps the long press it had then.
      pinnable.set(true);
      await app.detectChanges();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await fireEvent(target, 'touchEnd', { touches: [], changedTouches: [{}] });
      assert.deepEqual(said, ['card']);
    });

    it('names nothing for a host that cannot be told, nor where there is no host', async () => {
      await openRow(fakeHost(false, true, false));
      assert.equal(screen.getByTestId('handle').props['nativeID'], undefined);
      cleanup();
      registerPlatformComponents(os);
      const { Pressable } = await import('@ng-native/components');
      await render(`<pressable testID="handle" (longPress)="0"></pressable>`, {
        imports: [Pressable],
        providers: [
          { provide: Menus.SOURCE, useValue: null },
          { provide: OS, useValue: os },
        ],
      });
      await settle();
      assert.equal(screen.getByTestId('handle').props['nativeID'], undefined);
    });
  });
}

describe('a context menu chosen on iOS', () => {
  after(() => registerPlatformComponents('ios'));

  it("runs the item the host's module says was chosen in the view by that name", async () => {
    const { host, said } = await open('ios', false, true);
    const id = screen.getByTestId('row').props['nativeID'] as string;
    const menu = host.contextMenus.get(id);
    await host.send({ type: 'contextMenuSelect', nativeID: id, id: idOf(menu, 'Rename') });
    await host.send({
      type: 'contextMenuSelect',
      nativeID: 'someone-else',
      id: idOf(menu, 'Delete'),
    });
    assert.deepEqual(said, ['rename']);
  });

  it('runs nothing for a choice from the menu as it was before an item went', async () => {
    const { host, app, said } = await open('ios', false, true);
    const id = screen.getByTestId('row').props['nativeID'] as string;
    const rename = idOf(host.contextMenus.get(id), 'Rename');
    app.instance.renaming.set(false);
    await app.detectChanges();
    await host.send({ type: 'contextMenuSelect', nativeID: id, id: rename });
    assert.deepEqual(said, []);
  });
});

describe('a context menu written with control flow', () => {
  it('keeps an item an @if shows in its place in the template', async () => {
    const { ContextMenu, MenuItem, View } = await import('@ng-native/components');
    await render(
      `<view testID="target" [contextMenu]="menu"></view>
      <ng-template #menu>
        <menu-item label="A" />
        @if (true) {
          <menu-item label="B" />
        }
        <menu-item label="C" />
      </ng-template>`,
      { imports: [View, ContextMenu, MenuItem] },
    );
    const entries = screen.getByTestId('target').props['contextMenu'] as { label: string }[];
    assert.deepEqual(
      entries.map((entry) => entry.label),
      ['A', 'B', 'C'],
    );
  });
});

describe("the menus' platform source", () => {
  /** A device for one call: React Native with `turbo` as its modules, and Expo's `modules`. */
  function onDevice<T>(
    turbo: Record<string, unknown>,
    modules: Record<string, unknown> | undefined,
    run: () => T,
  ): T {
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) =>
      id === 'react-native'
        ? { TurboModuleRegistry: { get: (name: string) => turbo[name] } }
        : undefined;
    host['nativeFabricUIManager'] = {};
    host['expo'] = modules && { modules };
    try {
      return run();
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
      delete host['expo'];
    }
  }

  it("reaches Android's Expo module: constants as properties, events from its emitter", () => {
    const calls: unknown[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const expoModule = {
      menuBar: false,
      appName: 'Notes',
      setShortcuts: (list: unknown) => void calls.push(['shortcuts', list]),
      setContextMenu: (id: string, entries: unknown) => void calls.push(['menu', id, entries]),
      setTakesLongPress: (id: string, takes: boolean) => void calls.push(['takes', id, takes]),
      addListener: (name: string, listener: (event: unknown) => void) => {
        assert.equal(name, 'ngNativeMenus');
        listeners.push(listener);
        return { remove: () => void listeners.splice(listeners.indexOf(listener), 1) };
      },
    };
    const source = onDevice({}, { NgNativeMenus: expoModule }, menusSource)!;
    assert.equal(source.menuBar, false);
    assert.equal(source.appName, 'Notes');
    source.setShortcuts([]);
    source.setContextMenu?.('row', null);
    source.setTakesLongPress?.('handle', true);
    assert.deepEqual(calls, [
      ['shortcuts', []],
      ['menu', 'row', null],
      ['takes', 'handle', true],
    ]);
    const heard: unknown[] = [];
    const stop = source.subscribe((event) => heard.push(event));
    listeners.forEach((listener) => listener({ type: 'shortcut', id: 's0' }));
    stop();
    assert.deepEqual(heard, [{ type: 'shortcut', id: 's0' }]);
    assert.equal(listeners.length, 0, 'stopped listening');
  });

  it('prefers a TurboModule, which has no setContextMenu unless it says so', () => {
    const turbo = { getConstants: () => ({ menuBar: true, appName: 'Mac' }) };
    const source = onDevice({ NgNativeMenus: turbo }, { NgNativeMenus: {} }, menusSource)!;
    assert.equal(source.menuBar, true);
    assert.equal(source.setContextMenu, undefined);
    assert.equal(source.setTakesLongPress, undefined);
  });

  it('is absent with neither module', () => {
    assert.equal(onDevice({}, undefined, menusSource), null);
  });
});
