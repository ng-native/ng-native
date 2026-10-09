/**
 * Angular's route preloading, passed through `provideNativeRouter` as any router feature is. It
 * starts from the router's bootstrap listener, which `mount` runs, so a lazy route's code loads
 * after start-up rather than on the first tap of its tab.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { PreloadAllModules, withPreloading, type Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/guarded-sheet.ts');
});

async function lazyLoadsAfterStart(...features: ReturnType<typeof withPreloading>[]) {
  let loads = 0;
  const routes: Routes = [
    ...(mod['guardRoutes'] as Routes),
    {
      path: 'later',
      loadComponent: () => {
        loads++;
        return Promise.resolve(mod['GuardHome'] as Type<unknown>);
      },
    },
  ];
  await render(mod['GuardShell'] as Type<unknown>, {
    providers: [provideNativeRouter(routes, ...features)],
  });
  for (let turn = 0; turn < 4; turn++) await settle();
  return loads;
}

it('loads a lazy route nobody navigated to when preloading is on', async () => {
  assert.equal(await lazyLoadsAfterStart(withPreloading(PreloadAllModules)), 1);
});

it('leaves it until its first navigation without preloading', async () => {
  assert.equal(await lazyLoadsAfterStart(), 0);
});
