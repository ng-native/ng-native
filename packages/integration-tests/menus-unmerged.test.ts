/**
 * A `<menu-group>` named as a default menu (File, View...) but with no `menuRole` is drawn as a
 * second menu of that name beside the default one, so `Menus` says so, once.
 */
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Menus, OS, type NativeMenus } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/menus-unmerged.ts');
});
after(() => {
  cleanup();
  registerPlatformComponents('ios');
});

it('warns once that a File group with no menuRole is a second File menu, and not of its own groups', async () => {
  registerPlatformComponents('macos');
  const bars: (readonly { label: string }[])[] = [];
  const native: NativeMenus = {
    menuBar: true,
    appName: 'Atlas',
    setMenuBar: (groups) => void bars.push(groups),
    setShortcuts: () => {},
    subscribe: () => () => {},
  };
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  try {
    await render(mod['UnmergedMenus'] as Type<unknown>, {
      providers: [
        { provide: Menus.SOURCE, useValue: native },
        { provide: OS, useValue: 'macos' },
      ],
    });
    await settle();
  } finally {
    console.warn = warn;
  }
  const mine = warnings.filter((line) => line.includes('menuRole'));
  assert.equal(mine.length, 1, mine.join('\n'));
  assert.match(mine[0]!, /<menu-group label="File"> has no menuRole/);
  assert.match(mine[0]!, /menuRole="file"/);
  // The menu bar does show two File menus, which is what the warning is about.
  assert.equal(bars.at(-1)!.filter((group) => group.label === 'File').length, 2);
});
