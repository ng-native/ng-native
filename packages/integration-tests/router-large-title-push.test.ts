/**
 * A large-title page pushed onto a stack whose root page has no header.
 *
 * The root's screen has the hidden stand-in header, so the stack's bar is hidden, and
 * react-native-screens turns on large titles only once the push has started: on iOS the bar then
 * animates in from its compact layout and the large title drops into place (#1394). The page's
 * header asks `LargeTitleBarModule` in `@ng-native/expo` to lay the hidden bar out with a large
 * title first, and it has to ask before the commit that pushes the page, so the call reaches the
 * main thread ahead of that commit's mount.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const screens = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName === 'RNSScreen');

const stackTag = (fabric: FakeFabric) =>
  flatten(fabric.committed).find((node) => node.viewName === 'RNSScreenStack')?.reactTag;

/** Each `prepareLargeTitle`, with the screens committed when it was asked. */
interface Asked {
  stack: number;
  screensCommitted: number;
}

let mod: Record<string, unknown>;

before(async () => {
  mod = await compileFixture('fixtures/large-title-push.ts');
});

const global = globalThis as { expo?: unknown };

/** Runs `body` with `modules` as Expo's native modules, restoring them after. */
async function withModules(
  modules: Record<string, unknown> | undefined,
  body: () => Promise<void>,
) {
  const earlier = global.expo;
  if (modules) global.expo = { modules };
  else delete global.expo;
  try {
    await body();
  } finally {
    if (earlier === undefined) delete global.expo;
    else global.expo = earlier;
  }
}

async function boot(routes = 'routes') {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod[routes] as Routes)],
  });
  const router = app.componentRef.injector.get(Router);
  await router.navigateByUrl('/');
  await settle();
  return { fabric: app.fabric, router };
}

/** A fake `NgNativeStackBar` that notes what was committed when each call came. */
function fakeStackBar(fabric: () => FakeFabric | undefined) {
  const asked: Asked[] = [];
  const module = {
    prepareLargeTitle(stack: number) {
      const committed = fabric();
      asked.push({ stack, screensCommitted: committed ? screens(committed).length : 0 });
      return Promise.resolve();
    },
  };
  return { asked, module };
}

describe('a large-title page pushed under a root page with no header', () => {
  afterEach(() => {
    (mod['detailHidden'] as WritableSignal<boolean>).set(false);
    cleanup();
  });

  it('has the stack bar laid out for a large title before the commit that pushes it', async () => {
    let fabric: FakeFabric | undefined;
    const { asked, module } = fakeStackBar(() => fabric);
    await withModules({ NgNativeStackBar: module }, async () => {
      const app = await boot();
      fabric = app.fabric;
      assert.equal(screens(fabric).length, 1, 'the root screen');
      assert.deepEqual(asked, [], 'nothing asked for a root with no large title');

      await app.router.navigateByUrl('/detail');
      await settle();
      assert.equal(screens(fabric).length, 2, 'the detail screen is pushed');
      assert.deepEqual(asked, [{ stack: stackTag(fabric), screensCommitted: 1 }]);
    });
  });

  it('asks nothing for a page with an inline title, or a hidden large title', async () => {
    let fabric: FakeFabric | undefined;
    const { asked, module } = fakeStackBar(() => fabric);
    await withModules({ NgNativeStackBar: module }, async () => {
      const app = await boot();
      fabric = app.fabric;
      await app.router.navigateByUrl('/plain');
      await settle();
      assert.equal(screens(fabric).length, 2);
      await app.router.navigateByUrl('/');
      await settle();

      (mod['detailHidden'] as WritableSignal<boolean>).set(true);
      await app.router.navigateByUrl('/detail');
      await settle();
      assert.equal(screens(fabric).length, 2);
      assert.deepEqual(asked, []);
    });
  });

  it('asks about a stack only once it has been committed, for a root page with a large title', async () => {
    let fabric: FakeFabric | undefined;
    const { asked, module } = fakeStackBar(() => fabric);
    await withModules({ NgNativeStackBar: module }, async () => {
      fabric = (await boot('largeRootRoutes')).fabric;
      assert.equal(screens(fabric).length, 1);
      // Whether the stack commits before its root page renders depends on how soon the first
      // navigation lands. Either way native is only asked about the stack it has.
      for (const { stack } of asked) assert.equal(stack, stackTag(fabric));
    });
  });

  it('asks nothing on Android, which has no large title', async () => {
    let fabric: FakeFabric | undefined;
    const { asked, module } = fakeStackBar(() => fabric);
    registerPlatformComponents('android');
    try {
      await withModules({ NgNativeStackBar: module }, async () => {
        const app = await boot();
        fabric = app.fabric;
        await app.router.navigateByUrl('/detail');
        await settle();
        assert.equal(screens(fabric).length, 2);
        assert.deepEqual(asked, []);
      });
    } finally {
      registerPlatformComponents('ios');
    }
  });

  it('pushes the page all the same without the native module, as in Expo Go', async () => {
    for (const modules of [undefined, {}, { NgNativeStackBar: {} }]) {
      await withModules(modules, async () => {
        const app = await boot();
        await app.router.navigateByUrl('/detail');
        await settle();
        assert.equal(screens(app.fabric).length, 2);
        cleanup();
      });
    }
  });

  it('pushes the page all the same when the native call fails', async () => {
    const module = { prepareLargeTitle: () => Promise.reject(new Error('no stack')) };
    await withModules({ NgNativeStackBar: module }, async () => {
      const app = await boot();
      await app.router.navigateByUrl('/detail');
      await settle();
      assert.equal(screens(app.fabric).length, 2);
    });
  });
});
