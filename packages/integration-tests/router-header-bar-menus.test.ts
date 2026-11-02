/**
 * `<native-header-item>` with a `[menu]` or a `[spacing]`: entries of the header config's bar button
 * lists that `RNSScreenStackHeaderConfig.mm` builds apart from a button. An entry with a `menu` and
 * no `buttonId` opens its menu on a tap, as `RNSBarButtonItem.mm` reads it, while one with both
 * sends a press and opens only on a long press. An item with a `menuId` is an action and one without
 * is a submenu, and a tap on an action sends that id back.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render } from '@ng-native/testing';
import type { HeaderMenu } from '../router/src/native-header-item.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

interface Host {
  readonly menu: WritableSignal<HeaderMenu | undefined>;
  readonly settings: WritableSignal<HeaderMenu | undefined>;
  readonly disabled: WritableSignal<boolean>;
  readonly gap: WritableSignal<number | null | undefined>;
  readonly filled: WritableSignal<number | undefined>;
  readonly chosen: string[];
  readonly otherChosen: string[];
  pressed: number;
  saved: number;
}

type Entry = Record<string, unknown>;
interface Menu {
  title?: string;
  items: (Entry & Menu)[];
}

describe('native header bar menus and spacers', () => {
  let HostType: Type<Host>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/header-item.ts');
    HostType = mod['HeaderMenuHost'] as Type<Host>;
  });

  afterEach(() => cleanup());

  async function boot() {
    const app = await render(HostType);
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const left = () => config().props['headerLeftBarButtonItems'] as Entry[] | null | undefined;
    const right = () => config().props['headerRightBarButtonItems'] as Entry[] | null | undefined;
    const menuOf = (entry: Entry | undefined) => entry!['menu'] as Menu;
    const choose = (menuId: unknown) =>
      fireEvent(config(), 'pressHeaderBarButtonMenuItem', { menuId });
    const pass = async () => {
      await app.detectChanges();
    };
    return { ...app, instance: app.instance as Host, config, left, right, menuOf, choose, pass };
  }

  describe('menu', () => {
    it('commits an entry with a menu and no buttonId, so a tap opens it', async () => {
      const { left } = await boot();
      assert.equal('buttonId' in left()![0]!, false);
      assert.equal(left()![0]!['sfSymbolName'], 'ellipsis');
      assert.equal(left()![0]!['accessibilityLabel'], 'More');
      assert.equal(left()![0]!['index'], 0);
    });

    it('commits actions and submenus as native reads them', async () => {
      const { left, menuOf } = await boot();
      const menu = menuOf(left()![0]);
      assert.equal(menu.title, 'Sort');
      const [name, trash, more] = menu.items;
      assert.equal(name!['title'], 'Name');
      assert.equal(name!['sfSymbolName'], 'textformat');
      assert.equal(name!['state'], 'on');
      assert.equal(typeof name!['menuId'], 'string');
      assert.equal(trash!['destructive'], true);
      assert.equal(trash!['disabled'], true);
      assert.equal(more!['title'], 'More');
      assert.equal(more!['sfSymbolName'], 'folder');
      assert.equal(more!['singleSelection'], true);
      assert.equal('menuId' in more!, false, 'a menuId would make native draw it as an action');
      assert.equal(more!.items[0]!['hidden'], true);
      const inline = more!.items[1]!;
      assert.equal(inline['displayInline'], true);
      assert.equal(inline['destructive'], true);
      assert.equal('menuId' in inline, false);
      assert.equal(typeof inline.items[0]!['menuId'], 'string');
    });

    it('sends an action with nothing unset, and leaves an unset menu title out', async () => {
      const { right, menuOf } = await boot();
      const settings = menuOf(right()![0]);
      assert.deepEqual(Object.keys(settings.items[0]!).sort(), ['menuId', 'title', 'type']);
      assert.equal('title' in settings, false);
    });

    it('reports a tap on an action as its id, at any depth, on its own item', async () => {
      const { left, right, menuOf, choose, instance } = await boot();
      const menu = menuOf(left()![0]);
      await choose(menu.items[0]!['menuId']);
      await choose(menu.items[2]!.items[0]!['menuId']);
      await choose(menu.items[2]!.items[1]!.items[0]!['menuId']);
      assert.deepEqual(instance.chosen, ['name', 'deep', 'deeper']);
      assert.deepEqual(instance.otherChosen, []);
      await choose(menuOf(right()![0]).items[0]!['menuId']);
      assert.deepEqual(instance.chosen, ['name', 'deep', 'deeper']);
      assert.deepEqual(instance.otherChosen, ['name']);
      assert.equal(instance.pressed, 0, 'a menu action is no press on the button');
    });

    it('takes an event that names no action for none', async () => {
      const { choose, instance } = await boot();
      // The engine hands what a listener throws to the error handler, which logs it.
      const error = console.error;
      const logged: unknown[] = [];
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        await choose(undefined);
        await choose('someone-else/name');
      } finally {
        console.error = error;
      }
      assert.deepEqual(logged, []);
      assert.deepEqual([instance.chosen, instance.otherChosen], [[], []]);
    });

    it('commits a new menu, and keeps its ids', async () => {
      const { left, menuOf, choose, instance, pass } = await boot();
      const id = menuOf(left()![0]).items[0]!['menuId'];
      instance.menu.set({
        items: [{ type: 'action', id: 'name', title: 'By name', state: 'off' }],
      });
      await pass();
      const [name] = menuOf(left()![0]).items;
      assert.equal(name!['title'], 'By name');
      assert.equal(name!['state'], 'off');
      assert.equal(name!['menuId'], id);
      await choose(id);
      assert.deepEqual(instance.chosen, ['name']);
    });

    // Native keeps the id of each action it drew, so a tap can arrive after the menu changed.
    it('takes a tap left over from an action the menu no longer has for no choice', async () => {
      const { left, menuOf, choose, instance, pass } = await boot();
      const menu = menuOf(left()![0]);
      const gone = menu.items[1]!['menuId'];
      const stays = menu.items[2]!.items[1]!.items[0]!['menuId'];
      instance.menu.set({
        items: [
          {
            type: 'submenu',
            title: 'More',
            items: [{ type: 'action', id: 'deeper', title: 'Deeper' }],
          },
        ],
      });
      await pass();
      await choose(gone);
      assert.deepEqual(instance.chosen, []);
      await choose(stays);
      assert.deepEqual(instance.chosen, ['deeper']);
    });

    it('is a plain button again once the menu goes, and a tap left over is no choice', async () => {
      const { left, menuOf, choose, config, instance, pass } = await boot();
      const id = menuOf(left()![0]).items[0]!['menuId'];
      instance.menu.set(undefined);
      await pass();
      assert.equal('menu' in left()![0]!, false);
      assert.equal(typeof left()![0]!['buttonId'], 'string');
      const error = console.error;
      const logged: unknown[] = [];
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        await choose(id);
      } finally {
        console.error = error;
      }
      assert.deepEqual(logged, []);
      assert.deepEqual(instance.chosen, []);
      await fireEvent(config(), 'pressHeaderBarButtonItem', {
        buttonId: left()![0]!['buttonId'],
      });
      assert.equal(instance.pressed, 1);
    });

    it('stays a button with a menu when it is disabled', async () => {
      const { left, instance, pass } = await boot();
      instance.disabled.set(true);
      await pass();
      assert.equal(left()![0]!['disabled'], true);
      assert.equal(typeof left()![0]!['menu'], 'object');
    });
  });

  describe('spacing', () => {
    const spacers = (entries: Entry[]) => entries.filter((entry) => 'spacing' in entry);

    it('commits an entry with the spacing and its place, and nothing else', async () => {
      const { right } = await boot();
      assert.deepEqual(spacers(right()!), [{ spacing: 12, index: 1 }]);
    });

    it('counts in the place of what follows it', async () => {
      const { right } = await boot();
      assert.deepEqual(
        right()!.map((entry) => [entry['index'], entry['title'] ?? entry['sfSymbolName']]),
        [
          [0, 'gear'],
          [1, undefined],
          [2, 'Save'],
        ],
      );
    });

    it('takes 0 as a spacing', async () => {
      const { instance, pass, right } = await boot();
      instance.gap.set(0);
      await pass();
      assert.deepEqual(spacers(right()!), [{ spacing: 0, index: 1 }]);
    });

    it('commits no view for a spacer, and goes when its spacing does', async () => {
      const { config, instance, pass, right } = await boot();
      const views = () => config().children.length;
      assert.equal(views(), 1, 'only the item with content');
      instance.gap.set(undefined);
      await pass();
      assert.deepEqual(spacers(right()!), []);
    });

    it('takes null as no spacing, which a NaN gap would not be', async () => {
      const { instance, pass, right } = await boot();
      instance.gap.set(null);
      await pass();
      assert.deepEqual(spacers(right()!), []);
    });

    it('leaves an item with content a view, spacing or not', async () => {
      const { right, config } = await boot();
      assert.equal(config().children[0]!.viewName, 'RNSScreenStackHeaderSubview');
      assert.equal(spacers(right()!).length, 1, 'Filled is not a spacer');
    });
  });

  it('says on Android, once, that only iOS draws them', async () => {
    registerPlatformComponents('android');
    const warn = console.warn;
    const said: unknown[] = [];
    console.warn = (...args: unknown[]) => void said.push(args[0]);
    try {
      await boot();
      const text = said.filter((each) => String(each).includes('bar button')).join();
      assert.match(text, /spacing/);
      assert.match(text, /menu/);
    } finally {
      console.warn = warn;
      registerPlatformComponents('ios');
    }
  });
});
