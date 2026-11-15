/**
 * The options of `withComponentInputBinding()` on a native stack, as `RouterOutlet` binds by them:
 * `queryParams: false` leaves query params off the inputs, and `unmatchedInputBehavior:
 * 'undefinedIfStale'` keeps an input's default until its key has been in the route.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, withComponentInputBinding, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('withComponentInputBinding options on a native stack', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/route-input-options.ts');
  });

  afterEach(() => cleanup());

  async function open(options: Parameters<typeof withComponentInputBinding>[0], url: string) {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding(options))],
    });
    await settle();
    await app.componentRef.injector.get(NativeNavigation).push(url);
    await idle();
    const page = () =>
      flatten(app.fabric.committed)
        .map((node) => node.props['text'])
        .filter((text): text is string => typeof text === 'string' && text.startsWith('page'));
    return { page, router: app.componentRef.injector.get(Router) };
  }

  it('binds query params to inputs by default', async () => {
    const { page } = await open({}, '/page/1?q=from-query');
    assert.deepEqual(page(), ['page 1 q=from-query label=']);
  });

  it('leaves query params off the inputs with queryParams: false', async () => {
    const { page, router } = await open({ queryParams: false }, '/page/1?q=from-query');
    assert.deepEqual(page(), ['page 1 q= label=']);

    await router.navigateByUrl('/page/1?q=changed');
    await idle();
    assert.deepEqual(page(), ['page 1 q= label='], 'nor when the query changes');
  });

  it("keeps an input's default until its key is in the route with 'undefinedIfStale'", async () => {
    const options = { unmatchedInputBehavior: 'undefinedIfStale' } as const;
    const { page, router } = await open(options, '/page/1');
    assert.deepEqual(page(), ['page 1 q=default-q label=default-label']);

    await router.navigateByUrl('/page/1?q=from-query');
    await idle();
    assert.deepEqual(page(), ['page 1 q=from-query label=default-label']);

    await router.navigateByUrl('/page/1');
    await idle();
    assert.deepEqual(
      page(),
      ['page 1 q= label=default-label'],
      'a key that has gone is written as undefined, so the old value does not stay',
    );
  });
});
