/**
 * A tab tap whose navigation is still loading (a guard that waits, or lazy code), and a second
 * tap that arrives before it finishes. The last tap is the one the user meant.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/gated-tabs.ts', import.meta.url)));
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

async function start(routes: string) {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod[routes] as Routes)],
  });
  await idle();
  const router = app.componentRef.injector.get(Router);
  const host = () =>
    flatten(app.fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
  let provenance = 0;
  const report = async (key: string, actionOrigin: string) => {
    await fireEvent(host(), 'tabSelected', {
      selectedScreenKey: key,
      provenance: ++provenance,
      actionOrigin,
    });
    await idle();
  };
  /** The user tapping a tab. */
  const tap = (key: string) => report(key, 'user');
  /** Native reporting a selection the outlet asked for, as it reports every change. */
  const echo = (key: string) => report(key, 'programmatic-js');
  const selected = () =>
    (host().props['navStateRequest'] as { selectedScreenKey: string }).selectedScreenKey;
  return { router, tap, echo, selected };
}

it('stays on the tab tapped last when the tap before it is still loading', async () => {
  const gate = mod['gate'] as { open: (() => void) | null };
  const { router, tap, selected } = await start('gatedRoutes');
  assert.equal(router.url, '/home');

  await tap('search');
  assert.ok(gate.open, 'the search tab is still waiting on its guard');
  await tap('home');
  gate.open?.();
  await idle();

  assert.equal(router.url, '/home');
  assert.equal(selected(), 'home');
});

it('lets a navigation from code finish when native reports the tab in front meanwhile', async () => {
  const gate = mod['gate'] as { open: (() => void) | null };
  const { router, echo, selected } = await start('gatedRoutes');
  const arrived = router.navigateByUrl('/search');
  await idle();
  assert.ok(gate.open, 'the navigation is still waiting on its guard');
  await echo('home');
  gate.open?.();
  await idle();

  assert.equal(await arrived, true);
  assert.equal(router.url, '/search');
  assert.equal(selected(), 'search');
});
