/**
 * Android's Back on a page that refuses a native dismissal, presented from another tab: the page
 * is on the app's own stack, through the root's presented outlet, and must refuse the press there
 * as it does in its own tab.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

interface Album {
  attempts: () => number;
}

describe("Android's Back on a page that refuses it, presented from another tab", () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;
  let handlers: (() => boolean)[];

  const pressBack = async (): Promise<boolean> => {
    const taken = [...handlers].reverse().some((handler) => handler());
    for (let turn = 0; turn < 5; turn++) await settle();
    return taken;
  };

  const album = () => (mod['albums'] as Album[]).at(-1)!;

  before(async () => {
    mod = await compileFixture('fixtures/guarded-album.ts');
  });

  beforeEach(async () => {
    handlers = [];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['guardedAlbumRoutes'] as Routes),
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (handler: () => boolean) => {
              handlers.push(handler);
              return () => handlers.splice(handlers.indexOf(handler), 1);
            },
          },
        },
      ],
    });
    router = app.componentRef.injector.get(Router);
    navigation = app.componentRef.injector.get(NativeNavigation);
    await settle();
  });

  afterEach(() => cleanup());

  it('keeps the sheet up on the tab in front', async () => {
    await router.navigateByUrl('/library');
    await settle();
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/library/7');

    assert.equal(await pressBack(), true, 'the press is taken, not passed to the platform');
    assert.equal(router.url, '/library/7', 'the sheet is still up');
    assert.equal(album().attempts(), 1, 'the page heard the attempt');
  });

  it("keeps the sheet up on Android's Back", async () => {
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/home(presented:library/7)');

    assert.equal(await pressBack(), true, 'the press is taken, not passed to the platform');
    assert.equal(router.url, '/home(presented:library/7)', 'the sheet is still up');
    assert.equal(album().attempts(), 1, 'the page heard the attempt');
  });

  it('still lets the page leave through NativeNavigation.back()', async () => {
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    navigation.back();
    for (let turn = 0; turn < 5; turn++) await settle();
    assert.equal(router.url, '/home');
  });
});
