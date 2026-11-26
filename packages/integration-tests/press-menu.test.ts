/**
 * `<pressable [menu]>`: a menu a press opens under the element, instead of firing `(press)`.
 *
 * The host contract (`NativeMenus.popUpMenu` in `@ng-native/device`, the `NgNativeMenus` module's
 * `popUpMenu(view, entries)`): the view's tag and the menu as `serializeMenu` makes it. The host
 * draws it under the view and sends the item chosen as the view's `topContextMenuSelect` with
 * `{ id }`, as a context menu's. iOS's module takes `setPressMenu(nativeID, entries)` instead, opens
 * the menu on a touch itself, and sends the choice as a `pressMenuSelect` event. A host with neither
 * (Expo Go and the web for now) leaves the press to `(press)`, with one warning in development.
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
import {
  Menus,
  OS,
  menusSource,
  type NativeMenuEntry,
  type NativeMenuEvent,
  type NativeMenus,
} from '@ng-native/device';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';

afterEach(cleanup);

function fakeHost(popsUp: boolean, byNativeId = false) {
  const popUps: { view: number; entries: NativeMenuEntry[] }[] = [];
  const native: NativeMenus = {
    menuBar: !byNativeId,
    appName: 'Notes',
    setMenuBar: () => {},
    setShortcuts: () => {},
    subscribe: () => () => {},
    // Android's module, which takes menus by `nativeID`.
    ...(byNativeId && { setContextMenu: () => {} }),
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

async function open(popsUp: boolean, os: 'macos' | 'linux' | 'android' | 'ios' = 'macos') {
  const host = fakeHost(popsUp, os === 'android' || os === 'ios');
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

describe('a press menu on android', () => {
  it('opens the menu under the view by its tag, instead of firing (press)', async () => {
    const { host, said, press, node } = await open(true, 'android');
    await press();
    assert.deepEqual(said, []);
    assert.equal(host.popUps.length, 1);
    assert.equal(host.popUps[0]!.view, node.reactTag);
    assert.deepEqual(byPlace(host.popUps[0]!.entries), [
      { id: 'action', label: 'Name', checked: true },
      { id: 'action', label: 'Date', checked: false },
    ]);
  });

  it("runs the item chosen, which comes back as the view's topContextMenuSelect", async () => {
    const { host, sort, press, node } = await open(true, 'android');
    await press();
    await fireEvent(node, 'contextMenuSelect', { id: idOf(host.popUps[0]!.entries, 'Date') });
    assert.equal(sort(), 'date');
  });

  it('opens from code', async () => {
    const { host, said, node } = await open(true, 'android');
    await fireEvent.press(screen.getByTestId('opener'));
    assert.deepEqual(said, ['opened true']);
    assert.equal(host.popUps[0]!.view, node.reactTag);
  });
});

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

/**
 * iOS's module: menus by `nativeID`, and the choice as an `ngNativeMenus` event. From iOS 17.4 it
 * opens one from code too (`opens`).
 */
function iosHost(opens = false) {
  const pressMenus: { nativeID: string; entries: NativeMenuEntry[] | null }[] = [];
  const opened: string[] = [];
  let hear: (event: NativeMenuEvent) => void = () => {};
  const native: NativeMenus = {
    menuBar: false,
    appName: 'Notes',
    setMenuBar: () => {},
    setShortcuts: () => {},
    setContextMenu: () => {},
    setTakesLongPress: () => {},
    setPressMenu: (nativeID, entries) =>
      void pressMenus.push({ nativeID, entries: entries && [...entries] }),
    ...(opens && { openPressMenu: (nativeID: string) => void opened.push(nativeID) }),
    subscribe: (listener) => {
      hear = listener;
      return () => {};
    },
  };
  return { native, pressMenus, opened, say: (event: NativeMenuEvent) => hear(event) };
}

async function openOnIos(opens = false) {
  const host = iosHost(opens);
  const said: string[] = [];
  const sort = signal('name');
  const shown = signal(true);
  const present = signal(true);
  const disabled = signal(false);
  await render(
    `@if (present()) {
      <pressable testID="sort" #sorter="pressMenu" [menu]="shown() ? sortMenu : null"
        [contextMenu]="rowMenu" [disabled]="disabled()" (press)="said.push('press')"></pressable>
      <pressable testID="opener" (press)="said.push('opened ' + sorter.open())"></pressable>
    }
    <ng-template #sortMenu>
      <menu-item label="Name" [checked]="sort() === 'name'" (select)="sort.set('name')" />
      <menu-item label="Date" [checked]="sort() === 'date'" (select)="sort.set('date')" />
    </ng-template>
    <ng-template #rowMenu>
      <menu-item label="Delete" (select)="said.push('delete')" />
    </ng-template>`,
    {
      imports: [ContextMenu, MenuItem, PressMenu, Pressable],
      providers: [
        { provide: Menus.SOURCE, useValue: host.native },
        { provide: OS, useValue: 'ios' },
      ],
      componentProperties: { said, sort, shown, present, disabled },
    },
  );
  await settle();
  const node = screen.getByTestId('sort');
  return { host, said, sort, shown, present, disabled, node, nativeID: node.props['nativeID'] };
}

describe('a press menu on ios', () => {
  it("lays the menu over the view by its nativeID, and a press doesn't fire (press)", async () => {
    const { host, said, node, nativeID } = await openOnIos();
    assert.equal(typeof nativeID, 'string');
    assert.deepEqual(
      host.pressMenus.map((sent) => ({ ...sent, entries: byPlace(sent.entries ?? undefined) })),
      [
        {
          nativeID,
          entries: [
            { id: 'action', label: 'Name', checked: true },
            { id: 'action', label: 'Date', checked: false },
          ],
        },
      ],
    );
    // React Native's touch, should UIKit not cancel it as the menu opens.
    await fireEvent.press(node);
    await settle();
    assert.deepEqual(said, []);
  });

  it('runs the item chosen, and sends the menu again as it changes', async () => {
    const { host, sort, said, nativeID } = await openOnIos();
    const entries = host.pressMenus[0]!.entries!;
    host.say({ type: 'pressMenuSelect', nativeID: String(nativeID), id: idOf(entries, 'Date') });
    await settle();
    assert.equal(sort(), 'date');
    assert.deepEqual(said, [], "the context menu's item did not run");
    assert.deepEqual(byPlace(host.pressMenus.at(-1)!.entries!), [
      { id: 'action', label: 'Name', checked: false },
      { id: 'action', label: 'Date', checked: true },
    ]);
  });

  it("leaves a choice from the element's context menu to it", async () => {
    const { host, sort, said, nativeID } = await openOnIos();
    const name = idOf(host.pressMenus[0]!.entries!, 'Date');
    host.say({ type: 'contextMenuSelect', nativeID: String(nativeID), id: name });
    await settle();
    assert.equal(sort(), 'name');
    assert.deepEqual(said, []);
  });

  it('takes the menu away while the pressable is disabled, which then fires nothing', async () => {
    const { host, said, sort, disabled, node, nativeID } = await openOnIos();
    const date = idOf(host.pressMenus[0]!.entries!, 'Date');
    disabled.set(true);
    await settle();
    assert.deepEqual(host.pressMenus.at(-1), { nativeID, entries: null });
    await fireEvent.press(node);
    assert.deepEqual(said, []);
    // From a menu still open as it was disabled.
    host.say({ type: 'pressMenuSelect', nativeID: String(nativeID), id: date });
    assert.equal(sort(), 'name');
    disabled.set(false);
    await settle();
    assert.equal(host.pressMenus.at(-1)!.entries?.length, 2);
  });

  it('takes the menu away with [menu], and as the element goes', async () => {
    const { host, said, shown, present, node, nativeID } = await openOnIos();
    shown.set(false);
    await settle();
    assert.deepEqual(host.pressMenus.at(-1), { nativeID, entries: null });
    await fireEvent.press(node);
    await settle();
    assert.deepEqual(said, ['press'], 'with no menu, the press is the press');
    shown.set(true);
    await settle();
    assert.equal(host.pressMenus.at(-1)!.entries?.length, 2);
    present.set(false);
    await settle();
    assert.deepEqual(host.pressMenus.at(-1), { nativeID, entries: null });
  });

  it('opens nothing from code, and warns once', async () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
      const { said } = await openOnIos();
      await fireEvent.press(screen.getByTestId('opener'));
      await fireEvent.press(screen.getByTestId('opener'));
      assert.deepEqual(said, ['opened false', 'opened false']);
      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]), /iOS .* no way to open one from code/);
    } finally {
      console.warn = warn;
    }
  });

  // After the warning test: the warning is given once in a run.
  it('fires (press) where the module has no setPressMenu', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const host = fakeHost(false, true);
      const said: string[] = [];
      await render(
        `<pressable testID="sort" [menu]="menu" (press)="said.push('press')"></pressable>
        <ng-template #menu><menu-item label="Name" /></ng-template>`,
        {
          imports: [MenuItem, PressMenu, Pressable],
          providers: [
            { provide: Menus.SOURCE, useValue: host.native },
            { provide: OS, useValue: 'ios' },
          ],
          componentProperties: { said },
        },
      );
      await settle();
      const node = screen.getByTestId('sort');
      await fireEvent.press(node);
      assert.deepEqual(said, ['press']);
    } finally {
      console.warn = warn;
    }
  });
});

describe('a press menu on ios 17.4 and later', () => {
  it('opens the menu by its nativeID on a press, instead of firing (press)', async () => {
    const { host, said, node, nativeID } = await openOnIos(true);
    await fireEvent.press(node);
    await settle();
    assert.deepEqual(host.opened, [nativeID]);
    assert.deepEqual(said, []);
    assert.equal(host.pressMenus.at(-1)!.entries?.length, 2, 'the menu is still sent');
  });

  it('opens from code, and says it did', async () => {
    const { host, said, nativeID } = await openOnIos(true);
    await fireEvent.press(screen.getByTestId('opener'));
    assert.deepEqual(said, ['opened true']);
    assert.deepEqual(host.opened, [nativeID]);
  });

  it('opens nothing while the pressable is disabled, or with no menu', async () => {
    const { host, said, disabled, shown } = await openOnIos(true);
    disabled.set(true);
    await settle();
    await fireEvent.press(screen.getByTestId('opener'));
    disabled.set(false);
    shown.set(false);
    await settle();
    await fireEvent.press(screen.getByTestId('opener'));
    assert.deepEqual(said, ['opened false', 'opened false']);
    assert.deepEqual(host.opened, []);
  });

  it('opens the menu by the nativeID the app gives the element later', async () => {
    const host = iosHost(true);
    const id = signal<string | undefined>(undefined);
    await render(
      `<pressable testID="sort" [nativeID]="id()" [menu]="menu"></pressable>
      <ng-template #menu><menu-item label="Name" /></ng-template>`,
      {
        imports: [MenuItem, PressMenu, Pressable],
        providers: [
          { provide: Menus.SOURCE, useValue: host.native },
          { provide: OS, useValue: 'ios' },
        ],
        componentProperties: { id },
      },
    );
    await settle();
    id.set('sort-button');
    await settle();
    await fireEvent.press(screen.getByTestId('sort'));
    assert.deepEqual(host.opened, ['sort-button']);
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
  it('passes openPressMenu through only from a module whose constants say it opens one', () => {
    const opened: string[] = [];
    const host = globalThis as Record<string, unknown>;
    let opens: boolean | undefined = true;
    const module = {
      getConstants: () => ({ opensPressMenus: opens }),
      setPressMenu: () => {},
      openPressMenu: (nativeID: string) => void opened.push(nativeID),
    };
    host['require'] = (id: string) =>
      id === 'react-native' ? { TurboModuleRegistry: { get: () => module } } : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      menusSource()!.openPressMenu?.('sort');
      assert.deepEqual(opened, ['sort']);
      // Before iOS 17.4, which has no way to open a menu from code.
      opens = false;
      assert.equal(menusSource()!.openPressMenu, undefined);
      opens = undefined;
      assert.equal(menusSource()!.openPressMenu, undefined);
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
    }
  });

  it('passes popUpMenu through from a module that has it, and none from one without', () => {
    const calls: unknown[] = [];
    const host = globalThis as Record<string, unknown>;
    const withIt = {
      popUpMenu: (view: number, entries: unknown) => calls.push([view, entries]),
      setPressMenu: (nativeID: string, entries: unknown) => calls.push([nativeID, entries]),
    };
    const modules: Record<string, unknown> = { NgNativeMenus: withIt };
    host['require'] = (id: string) =>
      id === 'react-native'
        ? { TurboModuleRegistry: { get: (name: string) => modules[name] } }
        : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      menusSource()!.popUpMenu?.(7, []);
      menusSource()!.setPressMenu?.('sort', null);
      assert.deepEqual(
        [...calls],
        [
          [7, []],
          ['sort', null],
        ],
      );
      modules['NgNativeMenus'] = {};
      assert.equal(menusSource()!.popUpMenu, undefined);
      assert.equal(menusSource()!.setPressMenu, undefined);
      // Android's Expo module.
      delete modules['NgNativeMenus'];
      host['expo'] = { modules: { NgNativeMenus: withIt } };
      menusSource()!.popUpMenu?.(8, []);
      assert.deepEqual(calls.at(-1), [8, []]);
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
      delete host['expo'];
    }
  });
});
