/**
 * An icon's SVG markup, `{ svg }`, on the surfaces besides a button, a sidebar row and a tab: a
 * `<native-header-item>` bar button and its menu, a `<menu-item>` and `<menu-group>` in any menu
 * (a `[contextMenu]` here; `<menu-bar>`, `[menu]` and the Dock serialize the same entries), and a
 * `<tray-icon>` and its menu. Each reaches the desktop host as `svgIcon`, which it draws as a
 * symbol.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Tray, type NativeTray, type NativeTrayIcon } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import type { ButtonIcon } from '@ng-native/components';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

type Fixture = { icon: WritableSignal<ButtonIcon> };
let Fixture: Type<Fixture>;
let pencil: string;

before(async () => {
  registerScreenComponents();
  const mod = await compileFixture('fixtures/svg-icon-surfaces.ts');
  Fixture = mod['SvgIconSurfacesFixture'] as Type<Fixture>;
  pencil = mod['pencil'] as string;
});

let warned: string[] = [];
const warn = console.warn;
beforeEach(() => {
  warned = [];
  console.warn = (message: unknown) => void warned.push(String(message));
});
afterEach(() => {
  console.warn = warn;
  cleanup();
  registerPlatformComponents('ios');
});

type Entry = Record<string, unknown> & { items?: Entry[]; menu?: Entry };

async function start() {
  let icons: readonly NativeTrayIcon[] = [];
  const tray: NativeTray = {
    setIcons: (sent) => void (icons = sent),
    subscribe: () => () => {},
  };
  const app = await render(Fixture, { providers: [{ provide: Tray.SOURCE, useValue: tray }] });
  await settle();
  const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
  const right = () => (config().props['headerRightBarButtonItems'] as Entry[])[0]!;
  const left = () => (config().props['headerLeftBarButtonItems'] as Entry[])[0]!;
  const contextMenu = () => app.getByTestId('note').props['contextMenu'] as Entry[];
  return { ...app, right, left, contextMenu, tray: () => icons[0]! };
}

for (const os of ['macos', 'linux'] as const) {
  describe(`on ${os}`, () => {
    beforeEach(() => registerPlatformComponents(os));

    it('commits a header bar button and its menu entries with their markup as svgIcon', async () => {
      const { left, right, instance, rerender } = await start();
      assert.equal(left()['svgIcon'], pencil);
      assert.equal(left()['sfSymbolName'], undefined);
      assert.equal(typeof left()['buttonId'], 'string', 'an icon alone makes a bar button');
      const [rename, archive, move] = right().menu!.items!;
      assert.equal(right()['svgIcon'], pencil);
      assert.equal(rename!['svgIcon'], pencil);
      assert.equal(archive!['svgIcon'], undefined);
      assert.equal(move!['svgIcon'], pencil, 'a submenu has its icon too');

      instance.icon.set({ sfSymbol: 'pencil' });
      await rerender();
      assert.equal(left()['sfSymbolName'], 'pencil');
      assert.equal(left()['svgIcon'], undefined, 'taken away for a symbol');
      assert.equal(right().menu!.items![0]!['sfSymbolName'], 'pencil');
      assert.equal(right().menu!.items![0]!['svgIcon'], undefined);
      assert.deepEqual(warned, []);
    });

    it('sends a menu item and group with their markup as svgIcon, and a string icon as a drawable', async () => {
      const { contextMenu, instance, rerender } = await start();
      const [rename, archive, move] = contextMenu();
      assert.equal(rename!['svgIcon'], pencil);
      assert.equal(rename!['icon'], undefined);
      assert.equal(archive!['icon'], 'ic_archive');
      assert.equal(archive!['svgIcon'], undefined);
      assert.equal(move!['svgIcon'], pencil);

      instance.icon.set({ sfSymbol: 'pencil' });
      await rerender();
      assert.equal(contextMenu()[0]!['sfSymbol'], 'pencil');
      assert.equal(contextMenu()[0]!['svgIcon'], undefined);
      assert.equal(
        contextMenu()[3]!['sfSymbol'],
        'star',
        'the sfSymbol input wins over an icon of one',
      );
      instance.icon.set({ drawable: 'ic_edit' });
      await rerender();
      assert.equal(contextMenu()[0]!['icon'], 'ic_edit');
      assert.deepEqual(warned, []);
    });

    it('sends a tray icon and its menu items with their markup as svgIcon', async () => {
      const { tray, instance, rerender } = await start();
      assert.equal(tray().svgIcon, pencil);
      assert.equal(tray().sfSymbol, undefined);
      assert.equal((tray().menu![0] as Entry)['svgIcon'], pencil);
      instance.icon.set({ sfSymbol: 'pencil' });
      await rerender();
      await settle();
      assert.equal(tray().sfSymbol, 'pencil');
      assert.equal(tray().svgIcon, undefined);
    });

    it("says once when the markup is the icon's name", async () => {
      const { instance, rerender } = await start();
      instance.icon.set({ svg: `lucidePencil${os}` });
      await rerender();
      await settle();
      const said = warned.filter((message) => message.includes(`lucidePencil${os}`));
      assert.equal(said.length, 1, warned.join('\n'));
    });
  });
}

describe('on iOS', () => {
  it('sends the markup, which it draws on no bar button or menu, and says so once for each', async () => {
    registerPlatformComponents('ios');
    const { left } = await start();
    assert.equal(left()['svgIcon'], pencil);
    assert.equal(warned.filter((message) => message.includes('<native-header-item>')).length, 1);
    assert.equal(warned.filter((message) => message.includes('<menu-item>')).length, 1);
  });
});
