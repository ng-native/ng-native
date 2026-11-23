/**
 * `<pressable [menu]>`: a menu a press opens under the element, instead of firing `(press)`.
 *
 * The host contract (`NativeMenus.popUpMenu` in `@ng-native/device`, the `NgNativeMenus` module's
 * `popUpMenu(view, entries)`): the view's tag and the menu as `serializeMenu` makes it. The host
 * draws it under the view and sends the item chosen as the view's `topContextMenuSelect` with
 * `{ id }`, as a context menu's. A host without the method (iOS, Android, Expo Go and the web for
 * now) leaves the press to `(press)`, with one warning in development.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { signal } from '@angular/core';
import {
  ContextMenu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  PressMenu,
  Pressable,
  Text,
} from '@ng-native/components';
import { Menus, OS, menusSource, type NativeMenuEntry, type NativeMenus } from '@ng-native/device';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';

afterEach(cleanup);

function fakeHost(popsUp: boolean) {
  const popUps: { view: number; entries: NativeMenuEntry[] }[] = [];
  const native: NativeMenus = {
    menuBar: true,
    appName: 'Notes',
    setMenuBar: () => {},
    setShortcuts: () => {},
    subscribe: () => () => {},
    ...(popsUp && {
      popUpMenu: (view: number, entries: readonly NativeMenuEntry[]) =>
        void popUps.push({ view, entries: [...entries] }),
    }),
  };
  return { native, popUps };
}

const template = `
  <pressable testID="sort" #sorter="pressMenu" [menu]="sortMenu" [contextMenu]="rowMenu" (press)="said.push('press')">
    <text>Sort</text>
  </pressable>
  <pressable testID="opener" (press)="said.push('opened ' + sorter.open())"></pressable>
  <ng-template #sortMenu>
    @if (byName()) {
      <menu-item label="Name" [checked]="sort() === 'name'" (select)="sort.set('name')" />
    }
    <menu-item label="Date" [checked]="sort() === 'date'" (select)="sort.set('date')" />
  </ng-template>
  <ng-template #rowMenu>
    <menu-item label="Delete" (select)="said.push('delete')" />
  </ng-template>
`;

async function open(popsUp: boolean, os: 'macos' | 'linux' = 'macos') {
  const host = fakeHost(popsUp);
  const said: string[] = [];
  const sort = signal('name');
  const byName = signal(true);
  const app = await render(template, {
    imports: [ContextMenu, MenuGroup, MenuItem, MenuSeparator, PressMenu, Pressable, Text],
    providers: [
      { provide: Menus.SOURCE, useValue: host.native },
      { provide: OS, useValue: os },
    ],
    componentProperties: { said, sort, byName },
  });
  await settle();
  const press = async () => {
    await fireEvent.press(screen.getByTestId('sort'));
    await settle();
  };
  return { host, said, sort, byName, app, press, node: screen.getByTestId('sort') };
}

/** An entry's id as `action` where it is its handler's (`a12`). */
const byPlace = (entries: readonly NativeMenuEntry[] | undefined) =>
  entries?.map((entry) =>
    'id' in entry && /^a\d+$/.test(entry.id) ? { ...entry, id: 'action' } : entry,
  );
const idOf = (entries: readonly NativeMenuEntry[] | undefined, label: string) =>
  (entries?.find((entry) => 'label' in entry && entry.label === label) as { id: string }).id;

for (const os of ['macos', 'linux'] as const) {
  describe(`a press menu on ${os}`, () => {
    it('opens the menu under the view on a press, instead of firing (press)', async () => {
      const { host, said, press, node } = await open(true, os);
      assert.equal(host.popUps.length, 0, 'nothing opens before the press');
      await press();
      assert.deepEqual(said, []);
      assert.equal(host.popUps.length, 1);
      assert.equal(host.popUps[0]!.view, node.reactTag, "the pressable's own view");
      assert.deepEqual(byPlace(host.popUps[0]!.entries), [
        { id: 'action', label: 'Name', checked: true },
        { id: 'action', label: 'Date', checked: false },
      ]);
    });

    it('runs the item chosen, and opens with the items as they are now', async () => {
      const { host, sort, press, node } = await open(true, os);
      await press();
      await fireEvent(node, 'contextMenuSelect', { id: idOf(host.popUps[0]!.entries, 'Date') });
      assert.equal(sort(), 'date');
      await press();
      assert.deepEqual(byPlace(host.popUps[1]!.entries), [
        { id: 'action', label: 'Name', checked: false },
        { id: 'action', label: 'Date', checked: true },
      ]);
    });

    it('keeps a one-way [checked] item as the app has it when chosen again', async () => {
      const { host, sort, press, node } = await open(true, os);
      await press();
      await fireEvent(node, 'contextMenuSelect', { id: idOf(host.popUps[0]!.entries, 'Name') });
      assert.equal(sort(), 'name');
      await press();
      assert.deepEqual(byPlace(host.popUps[1]!.entries), [
        { id: 'action', label: 'Name', checked: true },
        { id: 'action', label: 'Date', checked: false },
      ]);
    });

    it('leaves the context menu on the same element its own', async () => {
      const { host, said, sort, node } = await open(true, os);
      const rowMenu = node.props['contextMenu'] as NativeMenuEntry[];
      assert.deepEqual(byPlace(rowMenu), [{ id: 'action', label: 'Delete' }]);
      await fireEvent(node, 'contextMenuSelect', { id: idOf(rowMenu, 'Delete') });
      assert.deepEqual(said, ['delete']);
      assert.equal(sort(), 'name', 'no item of the press menu ran');
      assert.deepEqual(host.popUps, []);
    });

    it('runs nothing for a choice from the menu as it was before an item went', async () => {
      const { host, sort, byName, press, node } = await open(true, os);
      sort.set('date');
      await settle();
      await press();
      const name = idOf(host.popUps[0]!.entries, 'Name');
      byName.set(false);
      await settle();
      await fireEvent(node, 'contextMenuSelect', { id: name });
      assert.equal(sort(), 'date');
    });
  });
}

describe('a press menu with no host to draw it', () => {
  it('fires (press), and warns once', async () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
      const { said, press } = await open(false);
      await press();
      await press();
      assert.deepEqual(said, ['press', 'press']);
      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]), /\[menu\]/);
    } finally {
      console.warn = warn;
    }
  });
});

describe('a long press on an element with a press menu', () => {
  it('fires (longPress), and opens nothing', async () => {
    const host = fakeHost(true);
    const said: string[] = [];
    await render(
      `<pressable testID="sort" [menu]="menu" (longPress)="said.push('long')"></pressable>
      <ng-template #menu><menu-item label="Name" /></ng-template>`,
      {
        imports: [MenuItem, PressMenu, Pressable],
        providers: [
          { provide: Menus.SOURCE, useValue: host.native },
          { provide: OS, useValue: 'macos' },
        ],
        componentProperties: { said },
      },
    );
    await settle();
    const sort = screen.getByTestId('sort');
    await fireEvent(sort, 'touchStart', { touches: [{}], changedTouches: [{}] });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await fireEvent(sort, 'touchEnd', { touches: [], changedTouches: [{}] });
    assert.deepEqual(said, ['long']);
    assert.equal(host.popUps.length, 0);
  });
});

describe('a press menu with no item to show', () => {
  it('fires (press), and opens nothing', async () => {
    const host = fakeHost(true);
    const said: string[] = [];
    await render(
      `<pressable testID="sort" [menu]="none" (press)="said.push('press')"></pressable>
      <ng-template #none><menu-separator /></ng-template>`,
      {
        imports: [MenuSeparator, PressMenu, Pressable],
        providers: [
          { provide: Menus.SOURCE, useValue: host.native },
          { provide: OS, useValue: 'macos' },
        ],
        componentProperties: { said },
      },
    );
    await settle();
    await fireEvent.press(screen.getByTestId('sort'));
    assert.deepEqual(said, ['press']);
    assert.deepEqual(host.popUps, []);
  });
});

describe('PressMenu.open()', () => {
  it('opens the menu from code, and says whether it did', async () => {
    const { host, said } = await open(true);
    await fireEvent.press(screen.getByTestId('opener'));
    assert.deepEqual(said, ['opened true']);
    assert.equal(host.popUps.length, 1);
  });

  it('says it opened none where the host draws no press menu', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const { said } = await open(false);
      await fireEvent.press(screen.getByTestId('opener'));
      assert.deepEqual(said, ['opened false']);
    } finally {
      console.warn = warn;
    }
  });
});

describe("the menus' platform source", () => {
  it('passes popUpMenu through from a module that has it, and none from one without', () => {
    const calls: unknown[] = [];
    const host = globalThis as Record<string, unknown>;
    const withIt = { popUpMenu: (view: number, entries: unknown) => calls.push([view, entries]) };
    const modules: Record<string, unknown> = { NgNativeMenus: withIt };
    host['require'] = (id: string) =>
      id === 'react-native'
        ? { TurboModuleRegistry: { get: (name: string) => modules[name] } }
        : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      menusSource()!.popUpMenu?.(7, []);
      assert.deepEqual(calls, [[7, []]]);
      modules['NgNativeMenus'] = {};
      assert.equal(menusSource()!.popUpMenu, undefined);
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
    }
  });
});
