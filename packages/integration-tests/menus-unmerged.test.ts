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

/** The warnings the fixture gives on a host that does, or does not, draw a menu bar. */
async function warningsOn(menuBar: boolean) {
  registerPlatformComponents('macos');
  const bars: (readonly { label: string }[])[] = [];
  const native: NativeMenus = {
    menuBar,
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
    cleanup();
  }
  return { bars, warnings: warnings.filter((line) => line.includes('menuRole')) };
}

it('warns once that a File group with no menuRole is a second File menu, and of no other group', async () => {
  const { bars, warnings } = await warningsOn(true);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0]!, /<menu-group label="File"> has no menuRole/);
  assert.match(warnings[0]!, /menuRole="file"/);
  const labels = bars.at(-1)!.map((group) => group.label);
  // The menu bar does show two File menus, which is what the warning is about; the View group,
  // whose one item moved into the default View menu, is not drawn at all.
  assert.equal(labels.filter((label) => label === 'File').length, 2);
  assert.equal(labels.filter((label) => label === 'View').length, 1);
});

it('says nothing where no menu bar is drawn', async () => {
  const { warnings } = await warningsOn(false);
  assert.deepEqual(warnings, []);
});
