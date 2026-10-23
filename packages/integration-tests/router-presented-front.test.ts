/**
 * `SCREEN_IN_FRONT` for a tab's page while a sheet covers it. A page of another tab presented over
 * the tab bar goes on the app's own stack, as a modal from a root route does, so the page under it
 * is behind in both cases.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, type Signal, type Type } from '@angular/core';
import { Router, type Route, type Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/presented-front.ts');
});

async function boot() {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(mod['routes'] as Routes),
      // A page that fails to render is reported here, and the navigation to it rejects.
      { provide: ErrorHandler, useValue: { handleError: () => {} } },
    ],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  const home = mod['home'] as { inFront: Signal<boolean> };
  assert.equal(router.url, '/home');
  assert.equal(home.inFront(), true);
  return { router, navigation, home };
}

describe('the tab under a presented screen', () => {
  it('control: a modal presented on the app stack covers the tab', async () => {
    const { router, navigation, home } = await boot();
    await navigation.present('/detail/1', { as: 'modal' });
    await settle();
    assert.equal(router.url, '/detail/1');
    assert.equal(home.inFront(), false, 'home is covered by the modal');
  });

  it('a page of another tab presented over home puts home behind', async () => {
    const { router, navigation, home } = await boot();
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/home(presented:library/7)');
    assert.equal(home.inFront(), false, 'home is covered by the sheet');

    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/home');
    assert.equal(home.inFront(), true, 'and in front again once the sheet is gone');
  });

  it('leaves home in front when the page presented over it fails to render', async () => {
    // Nothing covers home then: the page is gone before it was ever shown.
    const { router, navigation, home } = await boot();
    await assert.rejects(navigation.present('/library/broken', { as: 'formSheet' }), /failed/);
    await settle();
    assert.equal(router.url, '/home');
    assert.equal(home.inFront(), true);
  });
});

describe('a page of another tab presented after the routes are reset', () => {
  it('is presented over home again, its route copied into the new config', async () => {
    const { router, navigation } = await boot();
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/home');

    router.resetConfig(mod['routes'] as Routes);
    await navigation.present('/library/8', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/home(presented:library/8)');
  });
});

describe('a page of another tab presented while the routes are reset', () => {
  it('copies the route from the routes the router has once its lazy children load', async () => {
    let release: () => void = () => {};
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const tab = (extra: Partial<Route>): Routes => [
      {
        path: '',
        component: mod['Bar'] as Type<unknown>,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          { path: 'home', component: mod['Home'] as Type<unknown> },
          {
            path: 'library',
            component: mod['TabStack'] as Type<unknown>,
            loadChildren: () =>
              loaded.then(() => [
                { path: '', component: mod['Library'] as Type<unknown> },
                { path: ':id', component: mod['Album'] as Type<unknown> },
              ]),
            ...extra,
          },
        ],
      },
    ];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(tab({})),
        { provide: ErrorHandler, useValue: { handleError: () => {} } },
      ],
    });
    await settle();
    const router = app.componentRef.injector.get(Router);
    const navigation = app.componentRef.injector.get(NativeNavigation);
    assert.equal(router.url, '/home');

    const presenting = navigation.present('/library/8', { as: 'formSheet' });
    await settle();
    router.resetConfig(tab({ canActivate: [() => false] }));
    release();
    await presenting.catch(() => false);
    await settle();

    assert.equal(router.url, '/home', 'the guard of the routes in place keeps the page out');
  });
});
