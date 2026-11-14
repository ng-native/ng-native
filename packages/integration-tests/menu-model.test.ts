/**
 * The menu model every OS shares: the default menu bar, how an app's `<menu-bar>` merges into it,
 * the registration token a `<menu-item>` fills, and the other seams `@ng-native/device` holds for
 * packages that cannot import each other: the route-window navigator and the sidebar selection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, signal, type WritableSignal } from '@angular/core';
import {
  MENU_MODEL,
  SIDEBAR_SELECTION,
  WINDOW_NAVIGATOR,
  createMenuModel,
  defaultMenuBar,
  isSeparator,
  mergeMenuBar,
  type MenuEntry,
  type MenuGroupModel,
} from '@ng-native/device';
import { injectService } from '@ng-native/testing';

/** Each menu as its label and its entries' labels, a separator as `-`. */
function outline(groups: readonly MenuGroupModel[]): Record<string, string[]> {
  const labels = (entries: readonly MenuEntry[]) =>
    entries.map((entry) => (isSeparator(entry) ? '-' : entry.label));
  return Object.fromEntries(groups.map((group) => [group.label, labels(group.items)]));
}

const DEFAULTS = defaultMenuBar('Notes');

describe('the default menu bar', () => {
  it('has App, Edit, View, Window and Help, with their standard items and shortcuts', () => {
    assert.deepEqual(outline(DEFAULTS), {
      Notes: [
        'About Notes',
        '-',
        'Settings...',
        '-',
        'Services',
        '-',
        'Hide Notes',
        'Hide Others',
        'Show All',
        '-',
        'Quit Notes',
      ],
      Edit: ['Undo', 'Redo', '-', 'Cut', 'Copy', 'Paste', 'Select All', '-', 'Find'],
      View: ['Back', 'Forward', '-', 'Show Sidebar', 'Enter Full Screen'],
      Window: ['Close Window', 'Minimize', 'Zoom', '-', 'Bring All to Front'],
      Help: [],
    });
    const quit = DEFAULTS[0]!.items.at(-1);
    assert.deepEqual(quit, { label: 'Quit Notes', menuRole: 'quit', shortcut: 'mod+q' });
    const close = DEFAULTS.find((group) => group.menuRole === 'window')!.items[0];
    assert.deepEqual(close, { label: 'Close Window', menuRole: 'close', shortcut: 'mod+w' });
  });
});

describe('merging an app menu bar', () => {
  it('hides Settings... until the app gives it a handler', () => {
    const merged = mergeMenuBar(DEFAULTS, []);
    assert.deepEqual(outline(merged)['Notes'], [
      'About Notes',
      '-',
      'Services',
      '-',
      'Hide Notes',
      'Hide Others',
      'Show All',
      '-',
      'Quit Notes',
    ]);
    const open = () => {};
    const withSettings = mergeMenuBar(DEFAULTS, [
      { label: 'Prefs', items: [{ label: 'Preferences...', menuRole: 'settings', select: open }] },
    ]);
    const app = withSettings[0]!.items;
    assert.equal(outline(withSettings)['Notes']![2], 'Preferences...', 'where Settings... was');
    assert.equal((app[2] as { select?: () => void }).select, open);
    const noHandler = mergeMenuBar(DEFAULTS, [
      { label: 'Prefs', items: [{ label: 'Settings...', menuRole: 'settings' }] },
    ]);
    assert.ok(!outline(noHandler)['Notes']!.includes('Settings...'));
  });

  it('replaces a role default with the app item, where the default is, and moves it there', () => {
    const about = () => {};
    const merged = mergeMenuBar(DEFAULTS, [
      {
        label: 'Note',
        items: [
          { label: 'New Note', shortcut: 'mod+n' },
          { label: 'About this app', menuRole: 'about', select: about },
        ],
      },
    ]);
    assert.equal(outline(merged)['Notes']![0], 'About this app');
    assert.deepEqual(outline(merged)['Note'], ['New Note'], 'no longer in its own group');
  });

  it('adds a menuRole group to its standard menu, and puts the others after View', () => {
    const merged = mergeMenuBar(DEFAULTS, [
      { label: 'Ignored', menuRole: 'edit', items: [{ label: 'Transform' }] },
      { label: 'Format', items: [{ label: 'Bold', shortcut: 'mod+b' }] },
      { label: 'Note', items: [{ label: 'Pin' }] },
      { label: 'File', menuRole: 'file', items: [{ label: 'Print...', menuRole: 'print' }] },
    ]);
    assert.deepEqual(
      merged.map((group) => group.label),
      ['Notes', 'File', 'Edit', 'View', 'Format', 'Note', 'Window', 'Help'],
    );
    assert.deepEqual(outline(merged)['Edit']!.slice(-3), ['Find', '-', 'Transform']);
    assert.deepEqual(outline(merged)['File'], ['Print...', '-', 'Close Window']);
    assert.deepEqual(outline(merged)['Window'], ['Minimize', 'Zoom', '-', 'Bring All to Front']);
  });

  it('moves Close Window to the end of an app File menu, unless the app gave its own', () => {
    const close = () => {};
    const merged = mergeMenuBar(DEFAULTS, [
      { label: 'File', menuRole: 'file', items: [{ label: 'New', shortcut: 'mod+n' }] },
      { label: 'Note', items: [{ label: 'Close Note', menuRole: 'close', select: close }] },
    ]);
    assert.deepEqual(outline(merged)['File'], ['New', '-', 'Close Note']);
    assert.ok(!outline(merged)['Window']!.includes('Close Window'));
    const kept = mergeMenuBar(DEFAULTS, [{ label: 'Note', items: [{ label: 'Pin' }] }]);
    assert.equal(outline(kept)['Window']![0], 'Close Window', 'in Window with no File menu');
  });

  it('leaves out a group whose items all replaced defaults, separators and all', () => {
    const merged = mergeMenuBar(DEFAULTS, [
      {
        label: 'Tools',
        items: [{ separator: true }, { label: 'Copy', menuRole: 'copy' }, { separator: true }],
      },
    ]);
    assert.deepEqual(
      merged.map((group) => group.label),
      ['Notes', 'Edit', 'View', 'Window', 'Help'],
      'and no empty Tools menu',
    );
  });

  it('replaces a role inside a submenu too', () => {
    const defaults: MenuGroupModel[] = [
      {
        label: 'Edit',
        menuRole: 'edit',
        items: [{ label: 'More', items: [{ label: 'Find', menuRole: 'find' }] }],
      },
    ];
    const merged = mergeMenuBar(defaults, [
      { label: 'X', items: [{ label: 'Search', menuRole: 'find' }] },
    ]);
    const more = merged[0]!.items[0] as { items: readonly MenuEntry[] };
    assert.deepEqual(outline([{ label: 'More', items: more.items }])['More'], ['Search']);
  });
});

describe('the menu model a menu provides', () => {
  it('lists what registered, in order, follows a change and drops what went', () => {
    const model = createMenuModel();
    const first = signal<MenuEntry>({ label: 'One' });
    const second = signal<MenuEntry>({ label: 'Two' });
    model.register(first);
    const drop = model.register(second);
    assert.deepEqual(model.entries(), [{ label: 'One' }, { label: 'Two' }]);
    first.set({ label: 'One', checked: true });
    assert.deepEqual(model.entries()[0], { label: 'One', checked: true });
    drop();
    assert.deepEqual(model.entries(), [{ label: 'One', checked: true }]);
  });

  it('is provided by a menu, not the root, so an item outside one finds none', () => {
    assert.equal(injectService(Injector).get(MENU_MODEL, null), null);
  });
});

describe('the seams for packages that cannot import each other', () => {
  it('has no window navigator without a router, and the one the router provides with it', () => {
    assert.equal(injectService(WINDOW_NAVIGATOR), null);
    const navigator = {
      window: () => ({ component: class {}, providers: [] }),
      navigate: async () => true,
      clear: async () => true,
    };
    const provided = injectService(WINDOW_NAVIGATOR, {
      providers: [{ provide: WINDOW_NAVIGATOR, useValue: navigator }],
    });
    assert.equal(provided, navigator);
  });

  it('has a sidebar selection only where a sidebar item provides one, and shares it', () => {
    assert.equal(injectService(Injector).get(SIDEBAR_SELECTION, null), null);
    const item = Injector.create({
      providers: [{ provide: SIDEBAR_SELECTION, useFactory: () => signal(false) }],
    });
    const written: WritableSignal<boolean> = item.get(SIDEBAR_SELECTION);
    written.set(true);
    assert.equal(item.get(SIDEBAR_SELECTION)(), true, 'the router writes what the item reads');
  });
});
