/**
 * The copy a page's route gets at the root's presented outlet, so `present()` can show a page of
 * one tab over another: what it keeps of the routes the page sat inside, and which configs it
 * leaves alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DefaultUrlSerializer, type Route, type Router, type Routes } from '@angular/router';
import { PRESENTED, presentedCommands } from '../router/src/presented-route.ts';

class Bar {}
class Stack {}
class List {}
class Detail {}

const signedIn = () => true;
const mayRead = () => true;
const owner = () => true;

const serializer = new DefaultUrlSerializer();
const routerWith = (config: Routes) =>
  ({ config, parseUrl: (url: string) => serializer.parse(url) }) as unknown as Router;
/** The routes of the copy last made, from the root route to the page's. */
function copied(router: Router): Route[] {
  const chain = [router.config.at(-1)!];
  while (chain.at(-1)!.children) chain.push(chain.at(-1)!.children![0]!);
  return chain;
}

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
  it('is the page under its whole path, inside a copy of each route above it', async () => {
    const router = routerWith(tabs());
    assert.deepEqual(await presentedCommands(router, '/invoices/7'), [
      { outlets: { [PRESENTED]: ['invoices', '7'] } },
    ]);
    const bar = router.config.at(-1) as Route;
    assert.deepEqual(
      { ...bar, children: undefined },
      {
        path: 'invoices/:id',
        pathMatch: undefined,
        outlet: PRESENTED,
        providers: undefined,
        canActivate: [signedIn],
        canActivateChild: undefined,
        resolve: undefined,
        data: undefined,
        children: undefined,
      },
      'the bar s route, without the bar',
    );
    const stack = bar.children![0]!;
    assert.deepEqual(
      { ...stack, children: undefined },
      {
        path: '',
        pathMatch: undefined,
        outlet: PRESENTED,
        providers: [{ provide: 'feature', useValue: 'invoices' }],
        canActivate: undefined,
        canActivateChild: [mayRead],
        resolve: undefined,
        data: { section: 'billing' },
        children: undefined,
      },
      'the tab s route, without its stack',
    );
    const page = stack.children![0]!;
    assert.equal(page.component, Detail);
    assert.equal(page.path, '');
    assert.equal(page.outlet, PRESENTED);
    assert.deepEqual(page.canActivate, [owner]);
    assert.deepEqual(page.data, { kind: 'detail' });
  });

  it('is made once for a path, however many times a page of it is presented', async () => {
    const router = routerWith(tabs());
    await presentedCommands(router, '/invoices/7');
    await presentedCommands(router, '/invoices/8');
    assert.equal(router.config.length, 2);
    await presentedCommands(router, '/invoices');
    assert.equal(router.config.length, 3, 'and once more for a page under another path');
  });

  it('is made though a route of the primary outlet has the same path', async () => {
    const router = routerWith([...tabs(), { path: 'invoices/:id', component: List }]);
    await presentedCommands(router, '/invoices/7');
    const copy = router.config.at(-1) as Route;
    assert.equal(copy.outlet, PRESENTED);
    assert.equal(copied(router).at(-1)!.component, Detail);
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
    const presenting = presentedCommands(router, '/orders/7');
    router.config = lazy(owner);
    release();
    assert.deepEqual(await presenting, [{ outlets: { [PRESENTED]: ['orders', '7'] } }]);
    assert.equal(router.config.length, 2);
    assert.deepEqual(copied(router)[1]!.canActivate, [owner]);
  });

  it('is the first screen of a tab, for the tab s own url', async () => {
    const router = routerWith(tabs());
    await presentedCommands(router, '/invoices');
    assert.equal((router.config.at(-1) as Route).path, 'invoices');
    assert.equal(copied(router).at(-1)!.component, List);
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
      assert.deepEqual(await presentedCommands(router, `/orders/${id}`), [
        { outlets: { [PRESENTED]: ['orders', id] } },
      ]);
    }
    const [, orders, page] = copied(router);
    assert.equal(router.config.at(-1)!.path, 'orders/:id');
    assert.deepEqual(orders!.canActivate, [signedIn]);
    assert.equal(page!.component, Detail);
    assert.equal(page!.loadChildren, undefined);
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
      assert.equal(await presentedCommands(router, '/lazy/1'), null);
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
      assert.equal(await presentedCommands(router, '/admin/1'), null);
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
      assert.equal(await presentedCommands(router, path), null, JSON.stringify(config[0]!.path));
      assert.equal(router.config.length, 1, 'and adds nothing');
    }
  });
});
