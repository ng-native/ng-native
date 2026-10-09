/**
 * `NativeNavigation.back()` called while the navigation that shows the page is still in flight: a
 * page that finds it should not be shown and leaves as it appears, from an effect in its
 * constructor. No outlet has anywhere to go back to yet, so the back waits for the navigation.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/gated-page.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function pushed(url: string) {
  const app = await render(mod['GateShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['gateRoutes'] as Routes)],
  });
  await app.findByText('Home');
  await app.componentRef.injector.get(NativeNavigation).push(url);
  for (let turn = 0; turn < 8; turn++) await settle();
  const screens = flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
  return { url: app.componentRef.injector.get(Router).url, screens: screens.length };
}

for (const url of ['/effect', '/render']) {
  it(`goes back from a page that leaves as it appears (${url})`, async () => {
    (mod['allowed'] as { set(value: boolean): void }).set(false);
    assert.deepEqual(await pushed(url), { url: '/', screens: 1 });
  });
}

it('stays on a page whose effect does not ask to leave', async () => {
  (mod['allowed'] as { set(value: boolean): void }).set(true);
  assert.deepEqual(await pushed('/effect'), { url: '/effect', screens: 2 });
});
