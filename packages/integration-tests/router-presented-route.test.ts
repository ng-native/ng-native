/**
 * The copy a page's route gets at the root's presented outlet, so `present()` can show a page of
 * one tab over another: what it keeps of the routes the page sat inside, and which configs it
 * leaves alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEnvironmentInjector,
  inject,
  InjectionToken,
  Injector,
  runInInjectionContext,
  type EnvironmentInjector,
} from '@angular/core';
import {
  DefaultUrlSerializer,
  type CanActivateFn,
  type Route,
  type Router,
  type Routes,
} from '@angular/router';
import { PRESENTED, presentedCommands } from '../router/src/presented-route.ts';

class Bar {}
class Stack {}
class List {}
class Detail {}

const signedIn = () => true;
const mayRead = () => true;
const owner = () => true;

const serializer = new DefaultUrlSerializer();
const ROOT = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector);
const routerWith = (config: Routes) =>
  ({ config, parseUrl: (url: string) => serializer.parse(url) }) as unknown as Router;

const tabs = (): Routes => [
  {
    path: '',
    component: Bar,
    canActivate: [signedIn],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'invoices',
        component: Stack,
        canActivateChild: [mayRead],
        providers: [{ provide: 'feature', useValue: 'invoices' }],
        data: { section: 'billing' },
        children: [
          { path: '', component: List },
          { path: ':id', component: Detail, canActivate: [owner], data: { kind: 'detail' } },
        ],
      },
    ],
  },
];

describe('the route a presented page gets at the root', () => {
  it("runs an ancestor's guard with the providers down to its route, not a page's below", async () => {
    const POLICY = new InjectionToken<string>('policy');
    const seen: string[] = [];
    const strict: CanActivateFn = () => (seen.push(inject(POLICY)), true);
    const router = routerWith([
      {
        path: 'admin',
        component: Stack,
        canActivate: [strict],
        providers: [{ provide: POLICY, useValue: 'strict' }],
        children: [
          { path: 'users', component: List, providers: [{ provide: POLICY, useValue: 'lenient' }] },
        ],
      },
    ]);
    const root = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector);
    await presentedCommands(router, '/admin/users', root);
    const copy = router.config.at(-1) as Route;
    // As Angular runs a route's guards: in an injector made of the route's providers.
    const scope = createEnvironmentInjector(copy.providers ?? [], root);
    for (const guard of copy.canActivate ?? []) {
      runInInjectionContext(scope, () => (guard as CanActivateFn)(null!, null!));
    }
    assert.deepEqual(seen, ['strict']);
  });

  it("runs an ancestor's guard given as a token, from the providers down to its route", async () => {
    const GUARD = new InjectionToken<{ canActivate(): boolean }>('guard');
    const seen: string[] = [];
    const router = routerWith([
      {
        path: 'admin',
        component: Stack,
        canActivate: [GUARD],
        providers: [{ provide: GUARD, useValue: { canActivate: () => (seen.push('ran'), true) } }],
        children: [{ path: 'users', component: List, providers: [{ provide: 'x', useValue: 1 }] }],
      },
    ]);
    await presentedCommands(router, '/admin/users', ROOT);
    const copy = router.config.at(-1) as Route;
    const scope = createEnvironmentInjector(copy.providers ?? [], ROOT);
    for (const guard of copy.canActivate ?? []) {
      runInInjectionContext(scope, () => (guard as CanActivateFn)(null!, null!));
    }
    assert.deepEqual(seen, ['ran']);
  });

  it('is the page under its whole path, with the guards, providers and data above it', async () => {
    const router = routerWith(tabs());
    assert.deepEqual(await presentedCommands(router, '/invoices/7', ROOT), [
      { outlets: { [PRESENTED]: ['invoices', '7'] } },
    ]);
    const copy = router.config.at(-1) as Route;
    assert.equal(copy.outlet, PRESENTED);
    assert.equal(copy.path, 'invoices/:id');
    assert.equal(copy.component, Detail, 'the page, and neither the bar nor the tab s stack');
    // signedIn is run with the providers down to its route's, which the copy's are not: see below.
    assert.equal(copy.canActivate?.length, 3);
    assert.deepEqual(copy.canActivate?.slice(1), [mayRead, owner]);
    assert.deepEqual(copy.providers, [{ provide: 'feature', useValue: 'invoices' }]);
    assert.deepEqual(copy.data, { section: 'billing', kind: 'detail' });
  });

  it('is made once for a path, however many times a page of it is presented', async () => {
    const router = routerWith(tabs());
    await presentedCommands(router, '/invoices/7', ROOT);
    await presentedCommands(router, '/invoices/8', ROOT);
    assert.equal(router.config.length, 2);
    await presentedCommands(router, '/invoices', ROOT);
    assert.equal(router.config.length, 3, 'and once more for a page under another path');
  });

  it('is made though a route of the primary outlet has the same path', async () => {
    const router = routerWith([...tabs(), { path: 'invoices/:id', component: List }]);
    await presentedCommands(router, '/invoices/7', ROOT);
    const copy = router.config.at(-1) as Route;
    assert.equal(copy.outlet, PRESENTED);
    assert.equal(copy.component, Detail);
  });

  it('is made from the routes in place when they are reset while lazy children load', async () => {
    let release: () => void = () => {};
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const lazy = (guard: () => boolean): Routes => [
      {
        path: '',
        component: Bar,
        children: [
          {
            path: 'orders',
            canActivate: [guard],
            loadChildren: () => loaded.then(() => [{ path: ':id', component: Detail }]),
          },
        ],
      },
    ];
    const router = routerWith(lazy(signedIn));
    const presenting = presentedCommands(router, '/orders/7', ROOT);
    router.config = lazy(owner);
    release();
    assert.deepEqual(await presenting, [{ outlets: { [PRESENTED]: ['orders', '7'] } }]);
    assert.equal(router.config.length, 2);
    assert.deepEqual((router.config.at(-1) as Route).canActivate, [owner]);
  });

  it('is the first screen of a tab, for the tab s own url', async () => {
    const router = routerWith(tabs());
    await presentedCommands(router, '/invoices', ROOT);
    assert.equal((router.config.at(-1) as Route).component, List);
    assert.equal((router.config.at(-1) as Route).path, 'invoices');
  });

  it('is a page inside a lazily loaded route, whose routes it loads to find it', async () => {
    let loads = 0;
    const load = async () => {
      loads++;
      return { default: [{ path: ':id', component: Detail, data: { kind: 'detail' } }] };
    };
    const router = routerWith([
      {
        path: '',
        component: Bar,
        children: [{ path: 'orders', loadChildren: load, canActivate: [signedIn] }],
      },
    ]);
    for (const id of ['7', '8']) {
      assert.deepEqual(await presentedCommands(router, `/orders/${id}`, ROOT), [
        { outlets: { [PRESENTED]: ['orders', id] } },
      ]);
    }
    const copy = router.config.at(-1) as Route;
    assert.equal(copy.path, 'orders/:id');
    assert.equal(copy.component, Detail);
    assert.equal(copy.loadChildren, undefined);
    assert.deepEqual(copy.canActivate, [signedIn]);
    assert.equal(loads, 1, 'loaded once for the copy, however many times it is presented');
    assert.equal(router.config.length, 2);
  });

  it('leaves alone lazy routes that are not plain routes, or that fail to load', async () => {
    class FeatureModule {}
    for (const loadChildren of [
      async () => FeatureModule,
      async () => {
        throw new Error('offline');
      },
    ]) {
      const router = routerWith([{ path: 'lazy', loadChildren }] as Routes);
      assert.equal(await presentedCommands(router, '/lazy/1', ROOT), null);
      assert.equal(router.config.length, 1);
    }
  });

  it('leaves alone a page whose route, or one above it, has a canMatch guard', async () => {
    const allowed = () => false;
    for (const config of [
      [{ path: 'admin', canMatch: [allowed], children: [{ path: ':id', component: Detail }] }],
      [{ path: 'admin', children: [{ path: ':id', component: Detail, canMatch: [allowed] }] }],
      // A later route that would match is not taken in its place: the guard decides that.
      [
        { path: 'admin/:id', component: Detail, canMatch: [allowed] },
        { path: ':section/:id', component: List },
      ],
    ] as Routes[]) {
      const router = routerWith(config);
      assert.equal(await presentedCommands(router, '/admin/1', ROOT), null);
      assert.equal(router.config.length, config.length, 'and adds nothing');
    }
  });

  it('leaves alone a url it cannot follow through the config', async () => {
    for (const config of [
      [{ path: 'old', redirectTo: 'new' }],
      [{ path: '**', component: Detail }],
      [{ matcher: () => null, component: Detail }],
      [{ path: 'other', component: Detail }],
    ] as Routes[]) {
      const router = routerWith(config);
      const path = `/${config[0]!.path === '**' ? 'anything' : (config[0]!.path ?? 'x')}/1`;
      assert.equal(
        await presentedCommands(router, path, ROOT),
        null,
        JSON.stringify(config[0]!.path),
      );
      assert.equal(router.config.length, 1, 'and adds nothing');
    }
  });
});
