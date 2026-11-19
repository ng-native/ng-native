/**
 * `<split-view>`, `<sidebar>`, `<sidebar-section>` and `<sidebar-item>`.
 *
 * The contract for the desktop host, which draws them on macOS:
 *
 * - `<split-view>` is `NgNativeSplitView`. Its children are the sidebar, then one
 *   `NgNativeSplitContent` holding everything else: the content pane. The first in a window is its
 *   NSSplitViewController; a nested or second one is a plain NSSplitView.
 * - `<sidebar>` is `NgNativeSidebar`, with the props `collapsed`, `paneMinWidth`, `paneMaxWidth`
 *   (renamed, as Fabric's view props read `minWidth` as a style) and `autosaveName`. The host owns
 *   its width and sends `topSidebarCollapse` with `{ collapsed }` when the user collapses or opens
 *   it. The events are named so that no Angular output of the same name hears them as well.
 * - `<sidebar-section>` is `NgNativeSidebarSection`, with `title` and `collapsible`. Neighbouring
 *   sections in one parent are one source list.
 * - `<sidebar-item>` is `NgNativeSidebarItem`, with `label`, `badge` (a string), `sfSymbol`,
 *   `drawable` and `selected`. It has no children unless it is a custom row, whose views the host
 *   puts in a cell of its own. A click that selects the row sends `topSidebarSelect` to the item.
 *
 * On an iPad the iOS host draws the split view, its sidebar and its content (below). On every other
 * OS they are drawn here from views: two columns, or at a compact width a stack
 * whose root is the sidebar. On Android the columns wait for Material's expanded width, 840dp, as
 * its list-detail layout does; below that it is the stack.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import {
  registerPlatformComponents,
  registerViewName,
  registeredViewName,
} from '@ng-native/fabric';
import { HardwareBack, Screen, nativeSplitViews, type ScreenSource } from '@ng-native/device';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Signalish<T> = { (): T; set(value: T): void };
type Fixture = {
  collapsed: Signalish<boolean>;
  mailTitle: Signalish<string | undefined>;
  mailCollapsible: Signalish<boolean>;
  inbox: Signalish<boolean>;
  sent: Signalish<boolean>;
  unread: Signalish<number>;
  chosen: Signalish<string>;
  bumps: Signalish<number>;
  split: () => { showSidebar(): boolean };
};
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/sidebar.ts');
  Fixture = mod['SidebarFixture'] as Type<Fixture>;
});

afterEach(cleanup);

const touch = async (node: FakeFabricNode) => {
  await fireEvent(node, 'touchStart', { touches: [{}], changedTouches: [{}] });
  await fireEvent(node, 'touchEnd', { touches: [], changedTouches: [{}] });
  await settle();
};

const screenOf = (width: number): ScreenSource => ({
  current: () => ({ window: { width, height: 800 }, screen: { width, height: 800 } }),
  subscribe: () => () => {},
});

describe('on macOS', () => {
  before(() => registerPlatformComponents('macos'));
  after(() => registerPlatformComponents('ios'));

  it('commits the host views, with the sidebar first and the rest in the content pane', async () => {
    const { getByTestId } = await render(Fixture);
    const split = getByTestId('split');
    assert.equal(split.viewName, 'NgNativeSplitView');
    assert.deepEqual(
      split.children.map((child) => child.viewName),
      ['NgNativeSidebar', 'NgNativeSplitContent'],
    );
    assert.equal(split.children[1]!.children[0], getByTestId('content'));
  });

  it("commits the sidebar's inputs as the pane's props", async () => {
    const { getByTestId } = await render(Fixture);
    const sidebar = getByTestId('sidebar');
    assert.equal(sidebar.props['collapsed'], false);
    assert.equal(sidebar.props['paneMinWidth'], 180);
    assert.equal(sidebar.props['paneMaxWidth'], 400);
    assert.equal(sidebar.props['autosaveName'], 'main');
    assert.equal(sidebar.props['minWidth'], undefined, 'not a style the host would lay out by');
    assert.equal(sidebar.props['width'], undefined, 'the host owns the width');
  });

  it('commits sections and items as the source list, with no drawn rows', async () => {
    const { getByTestId } = await render(Fixture);
    const mail = getByTestId('mail');
    assert.equal(mail.viewName, 'NgNativeSidebarSection');
    assert.equal(mail.props['title'], 'Mailboxes');
    assert.equal(mail.props['collapsible'], true);
    const inbox = getByTestId('inbox');
    assert.equal(inbox.viewName, 'NgNativeSidebarItem');
    assert.equal(inbox.props['label'], 'Inbox');
    assert.equal(inbox.props['badge'], '3');
    assert.equal(inbox.props['sfSymbol'], 'tray');
    assert.equal(inbox.props['selected'], true);
    assert.equal(inbox.children.length, 0, 'a default row is drawn by the host');
    assert.equal(getByTestId('sent').props['sfSymbol'], 'paperplane');
    assert.equal(getByTestId('sent').props['selected'], false);
    assert.equal(getByTestId('storage').children.length, 1, 'a custom row keeps its views');
  });

  it('lets the content of a custom row fill the cell the host puts it in', async () => {
    const { getByTestId } = await render(Fixture);
    const row = getByTestId('storage').props;
    assert.notEqual(row['flexDirection'], 'row', 'a column, whose content stretches across');
    assert.notEqual(row['alignItems'], 'center');
    assert.equal(row['paddingLeft'] ?? row['paddingHorizontal'] ?? row['padding'], undefined);
  });

  it('selects an item the host reports, deselecting the others', async () => {
    const { instance, getByTestId, fabric } = await render(Fixture);
    let selects = 0;
    instance.chosen.set = ((set) => (value: string) => (selects++, set(value)))(
      instance.chosen.set,
    );
    fabric.emit(getByTestId('sent'), 'topSidebarSelect', {});
    await settle();
    assert.equal(instance.chosen(), 'sent');
    assert.equal(selects, 1, 'once: the native event is not also an output of the same name');
    assert.equal(instance.sent(), true);
    assert.equal(instance.inbox(), false, 'one row of a sidebar is selected at a time');
    assert.equal(getByTestId('sent').props['selected'], true);
    assert.equal(getByTestId('inbox').props['selected'], false);
  });

  it('leaves a click in a custom row to the row, and the touch to the source list', async () => {
    const { instance, getByTestId } = await render(Fixture);
    await touch(getByTestId('bump'));
    assert.equal(instance.bumps(), 1);
    await touch(getByTestId('inbox'));
    assert.equal(instance.chosen(), '', 'the host selects, not the responder');
  });

  it('follows the collapsed state the host reports, and sends the one the app sets', async () => {
    const { instance, getByTestId, fabric, rerender } = await render(Fixture);
    fabric.emit(getByTestId('sidebar'), 'topSidebarCollapse', { collapsed: true });
    await settle();
    assert.equal(instance.collapsed(), true);
    assert.equal(getByTestId('sidebar').props['collapsed'], true);
    instance.collapsed.set(false);
    await rerender();
    assert.equal(getByTestId('sidebar').props['collapsed'], false);
  });

  it("ignores a collapse reported for a sidebar inside this one's content", async () => {
    const { instance, getByTestId, fabric } = await render(Fixture);
    fabric.emit(getByTestId('search'), 'topSidebarCollapse', { collapsed: true });
    await settle();
    assert.equal(instance.collapsed(), false);
  });
});

describe('on Linux', () => {
  before(() => registerPlatformComponents('linux'));
  after(() => registerPlatformComponents('ios'));

  it('commits sections and items as the source list the GTK host draws, with no drawn rows', async () => {
    const { getByTestId } = await render(Fixture);
    assert.equal(getByTestId('split').viewName, 'NgNativeSplitView');
    const mail = getByTestId('mail');
    assert.equal(mail.viewName, 'NgNativeSidebarSection');
    assert.equal(mail.props['title'], 'Mailboxes');
    assert.equal(mail.props['collapsible'], true);
    const inbox = getByTestId('inbox');
    assert.equal(inbox.viewName, 'NgNativeSidebarItem');
    assert.equal(inbox.props['label'], 'Inbox');
    assert.equal(inbox.props['badge'], '3');
    assert.equal(inbox.props['selected'], true);
    assert.equal(inbox.children.length, 0, 'a default row is drawn by the host');
    assert.equal(getByTestId('sent').props['selected'], false);
    assert.equal(mail.children.length, 2, 'no drawn title row');
  });
});

describe('drawn, beside the content', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`is two columns of views on ${os}`, async () => {
      registerPlatformComponents(os);
      try {
        const wide = [{ provide: Screen.SOURCE, useValue: screenOf(1024) }];
        const { getByTestId, getByText } = await render(Fixture, { providers: wide });
        const split = getByTestId('split');
        assert.equal(split.viewName, 'View');
        assert.equal(split.props['flexDirection'], 'row');
        const sidebar = getByTestId('sidebar');
        assert.equal(sidebar.props['width'], 240);
        assert.equal(sidebar.props['minWidth'], 180);
        assert.equal(sidebar.props['maxWidth'], 400);
        assert.equal(sidebar.props['paneMinWidth'], undefined);
        assert.ok(getByText('Mailboxes'));
        assert.ok(getByText('Inbox'));
        assert.ok(getByText('3'), 'the badge');
        assert.equal(getByTestId('inbox').props['label'], undefined);
        assert.equal(getByTestId('storage').props['flexDirection'], 'row', 'a drawn row');
      } finally {
        registerPlatformComponents('ios');
      }
    });
  }

  it('selects an item on a press, deselecting the others', async () => {
    const wide = [{ provide: Screen.SOURCE, useValue: screenOf(1024) }];
    const { instance, getByTestId } = await render(Fixture, { providers: wide });
    await touch(getByTestId('sent'));
    assert.equal(instance.chosen(), 'sent');
    assert.equal(instance.sent(), true);
    assert.equal(instance.inbox(), false);
  });

  it('hides a collapsed sidebar', async () => {
    const wide = [{ provide: Screen.SOURCE, useValue: screenOf(1024) }];
    const { instance, queryByTestId, rerender } = await render(Fixture, { providers: wide });
    instance.collapsed.set(true);
    await rerender();
    assert.equal(queryByTestId('sidebar'), null, 'display: none leaves it out of the commit');
    assert.ok(queryByTestId('content'));
  });

  it("shows and hides a collapsible section's items from its title", async () => {
    const wide = [{ provide: Screen.SOURCE, useValue: screenOf(1024) }];
    const { instance, getByText, queryByTestId } = await render(Fixture, { providers: wide });
    instance.inbox.set(true);
    await touch(getByText('Mailboxes'));
    assert.equal(queryByTestId('inbox'), null);
    await touch(getByText('Mailboxes'));
    assert.ok(queryByTestId('inbox'));
    assert.equal(instance.inbox(), true, 'the selection survives the section collapsing');
  });

  for (const [what, take] of [
    ['is no longer collapsible', (instance: Fixture) => instance.mailCollapsible.set(false)],
    ['loses its title', (instance: Fixture) => instance.mailTitle.set(undefined)],
  ] as const) {
    it(`shows a collapsed section's items once it ${what}`, async () => {
      // With no title to press, nothing could show them again.
      const wide = [{ provide: Screen.SOURCE, useValue: screenOf(1024) }];
      const { instance, getByText, queryByTestId, rerender } = await render(Fixture, {
        providers: wide,
      });
      await touch(getByText('Mailboxes'));
      assert.equal(queryByTestId('inbox'), null);
      take(instance);
      await rerender();
      assert.ok(queryByTestId('inbox'));
    });
  }
});

describe('drawn, at a compact width', () => {
  const narrow = () => [{ provide: Screen.SOURCE, useValue: screenOf(390) }];

  it('is a stack whose root is the sidebar', async () => {
    const { getByTestId, queryByTestId } = await render(Fixture, { providers: narrow() });
    assert.notEqual(getByTestId('split').props['flexDirection'], 'row');
    assert.equal(getByTestId('sidebar').props['width'], undefined, 'the full width');
    assert.equal(getByTestId('sidebar').props['flex'], 1);
    assert.equal(queryByTestId('content'), null, 'the content waits for a choice');
  });

  it('shows the content once an item is chosen, and the sidebar again on back', async () => {
    let back: () => boolean = () => false;
    const source = { subscribe: (handler: () => boolean) => ((back = handler), () => {}) };
    const { getByTestId, queryByTestId } = await render(Fixture, {
      providers: [...narrow(), { provide: HardwareBack.SOURCE, useValue: source }],
    });
    await touch(getByTestId('sent'));
    assert.equal(queryByTestId('sidebar'), null);
    assert.ok(queryByTestId('content'));
    assert.equal(back(), true, 'back returns to the sidebar');
    await settle();
    assert.ok(queryByTestId('sidebar'));
    assert.equal(queryByTestId('content'), null);
    assert.equal(back(), false, 'and from the sidebar leaves the app');
  });
});

describe('drawn on Android', () => {
  after(() => registerPlatformComponents('ios'));

  // Material's window size classes: a list pane beside the content from the expanded class, 840dp.
  for (const [os, width, columns] of [
    ['android', 839, false],
    ['android', 840, true],
    ['ios', 800, true],
  ] as const) {
    it(`is ${columns ? 'two columns' : 'a stack'} at ${width} wide on ${os}`, async () => {
      registerPlatformComponents(os);
      const { getByTestId } = await render(Fixture, {
        providers: [{ provide: Screen.SOURCE, useValue: screenOf(width) }],
      });
      assert.equal(getByTestId('split').props['flexDirection'] === 'row', columns);
    });
  }
});

/**
 * On an iPad with `@ng-native/components`' pod, whose `NgNativeSplitViews` module has the constant
 * `available`, the iOS host draws `<split-view>` as a UISplitViewController: `NgNativeSplitView`
 * with the sidebar column (`NgNativeSidebar`, whose props and `topSidebarCollapse` are macOS's)
 * and the content column (`NgNativeSplitContent`). Each column's size comes back into layout from
 * the host, which collapses the two into a stack itself at a compact width. Sections and items
 * stay drawn here, inside the sidebar column. A choice in the sidebar sends the split view the
 * command `showContent`, and `showSidebar()` sends `showSidebar`, which push and pop the content
 * where the columns are collapsed. Without the module (an iPhone, Expo Go) it is drawn, as above.
 */
describe('on iPadOS', () => {
  /** A device for one call: React Native with `turbo` as its modules. */
  function onDevice<T>(turbo: Record<string, unknown>, run: () => T): T {
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) =>
      id === 'react-native'
        ? { TurboModuleRegistry: { get: (name: string) => turbo[name] } }
        : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      return run();
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
    }
  }

  const iPad = { NgNativeSplitViews: { getConstants: () => ({ available: true }) } };
  const iPhone = { NgNativeSplitViews: { getConstants: () => ({ available: false }) } };
  const elements = [
    'split-view',
    'split-view-content',
    'sidebar',
    'sidebar-section',
    'sidebar-item',
  ];

  it("names the host's views where the module says it draws them, and views elsewhere", () => {
    registerPlatformComponents('ios');
    const names = (turbo: Record<string, unknown>) =>
      onDevice(turbo, () => elements.map((element) => registeredViewName(element)));
    assert.deepEqual(names(iPad), [
      'NgNativeSplitView',
      'NgNativeSplitContent',
      'NgNativeSidebar',
      'View',
      'View',
    ]);
    assert.deepEqual(names(iPhone), ['View', 'View', 'View', 'View', 'View']);
    assert.deepEqual(names({}), ['View', 'View', 'View', 'View', 'View'], 'Expo Go');
    registerPlatformComponents('android');
    try {
      assert.equal(
        onDevice(iPad, () => registeredViewName('split-view')),
        'View',
      );
    } finally {
      registerPlatformComponents('ios');
    }
  });

  it('never asks for the module off iOS, where it is missing and the asking is logged', () => {
    const asked: string[] = [];
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) =>
      id === 'react-native'
        ? {
            Platform: { OS: 'macos' },
            TurboModuleRegistry: {
              get: (name: string) => {
                asked.push(name);
                return null;
              },
            },
          }
        : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      assert.equal(nativeSplitViews(), false);
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
    }
    assert.deepEqual(asked, []);
  });

  /** Render as the iPad does: the names its module gives, for the length of one test. */
  let undo: (() => void)[] = [];
  const asIPad = () => {
    undo = [
      registerViewName('split-view', { ios: 'NgNativeSplitView', android: 'View' }),
      registerViewName('split-view-content', { ios: 'NgNativeSplitContent', android: 'View' }),
      registerViewName('sidebar', { ios: 'NgNativeSidebar', android: 'View' }),
    ];
  };
  afterEach(() => {
    for (const one of undo.reverse()) one();
    undo = [];
  });

  it('commits the split view controller, its columns, and the drawn rows in the sidebar', async () => {
    asIPad();
    const { getByTestId, getByText } = await render(Fixture, {
      providers: [{ provide: Screen.SOURCE, useValue: screenOf(1024) }],
    });
    const split = getByTestId('split');
    assert.equal(split.viewName, 'NgNativeSplitView');
    assert.notEqual(split.props['flexDirection'], 'row', 'the host places the columns');
    assert.deepEqual(
      split.children.map((child) => child.viewName),
      ['NgNativeSidebar', 'NgNativeSplitContent'],
    );
    const sidebar = getByTestId('sidebar');
    assert.equal(sidebar.props['collapsed'], false);
    assert.equal(sidebar.props['paneMinWidth'], 180);
    assert.equal(sidebar.props['paneMaxWidth'], 400);
    assert.equal(sidebar.props['width'], undefined, 'the host owns the width');
    assert.equal(sidebar.props['minWidth'], undefined);
    assert.equal(getByTestId('inbox').viewName, 'View', 'a row drawn here');
    assert.ok(getByText('Inbox'));
  });

  it('keeps both columns at a compact width, where the host collapses them', async () => {
    asIPad();
    const { getByTestId, queryByTestId } = await render(Fixture, {
      providers: [{ provide: Screen.SOURCE, useValue: screenOf(390) }],
    });
    assert.ok(queryByTestId('content'));
    assert.equal(getByTestId('sidebar').props['flex'], undefined);
  });

  it('follows the collapsed state the host reports, and sends the one the app sets', async () => {
    asIPad();
    const { instance, getByTestId, fabric, rerender } = await render(Fixture);
    fabric.emit(getByTestId('sidebar'), 'topSidebarCollapse', { collapsed: true });
    await settle();
    assert.equal(instance.collapsed(), true);
    assert.ok(getByTestId('sidebar'), 'still committed: the host hides the column');
    instance.collapsed.set(false);
    await rerender();
    assert.equal(getByTestId('sidebar').props['collapsed'], false);
  });

  it('asks the host to show the content on a choice, and the sidebar on showSidebar()', async () => {
    asIPad();
    const { instance, getByTestId, fabric } = await render(Fixture);
    await touch(getByTestId('sent'));
    assert.equal(instance.chosen(), 'sent');
    const sent = fabric.commands.filter((command) => command.viewName === 'NgNativeSplitView');
    assert.deepEqual(
      sent.map((command) => command.name),
      ['showContent'],
    );
    assert.equal(sent[0]!.node?.reactTag, getByTestId('split').reactTag);
    instance.split().showSidebar();
    assert.deepEqual(
      fabric.commands
        .filter((command) => command.viewName === 'NgNativeSplitView')
        .map((command) => command.name),
      ['showContent', 'showSidebar'],
    );
  });
});
