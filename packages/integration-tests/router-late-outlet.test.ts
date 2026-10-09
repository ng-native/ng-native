/**
 * A `<native-stack-outlet>` created after the first navigation has finished: an app that holds
 * its outlet behind a condition until something is ready. The router has activated nothing, since
 * there was no outlet, so the outlet takes the route the router is on as it is created, as
 * Angular's own `RouterOutlet` does.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/late-outlet.ts');
});

const shell = async () => {
  const app = await render(mod['LateShell'] as Type<{ ready: { set(value: boolean): void } }>, {
    providers: [provideNativeRouter(mod['lateRoutes'] as Routes)],
  });
  // The first navigation has finished by now, with no outlet to activate.
  for (let turn = 0; turn < 5; turn++) await settle();
  return app;
};

it('shows the route the router is on when the outlet is created after the navigation', async () => {
  const app = await shell();
  assert.ok(app.getByText('Loading'));
  app.instance.ready.set(true);
  await app.detectChanges();
  assert.ok(await app.findByText('Home page'));
  assert.equal(app.queryByText('Loading'), null);
});

it('navigates from there as an outlet that was there from the start does', async () => {
  const app = await shell();
  app.instance.ready.set(true);
  await app.detectChanges();
  await app.findByText('Home page');
  const nav = app.componentRef.injector.get(NativeNavigation);
  await nav.push('/detail');
  for (let turn = 0; turn < 5; turn++) await settle();
  assert.ok(app.getByText('Detail page'));
  nav.back();
  for (let turn = 0; turn < 5; turn++) await settle();
  assert.equal(app.queryByText('Detail page'), null);
  assert.ok(app.getByText('Home page'));
});

it('shows the current tab when a tabs outlet is created after the navigation', async () => {
  const app = await render(mod['LateTabs'] as Type<{ ready: { set(value: boolean): void } }>, {
    providers: [provideNativeRouter(mod['lateTabRoutes'] as Routes)],
  });
  for (let turn = 0; turn < 5; turn++) await settle();
  app.instance.ready.set(true);
  await app.detectChanges();
  assert.ok(await app.findByText('Home page'));
});
