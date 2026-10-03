/**
 * The copy a page's route gets at the root's presented outlet, so `present()` can show a page of
 * one tab over another: what it keeps of the routes the page sat inside, and which configs it
 * leaves alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Route, Router, Routes } from '@angular/router';
import { PRESENTED, presentedCommands } from '../router/src/presented-route.ts';

class Bar {}
class Stack {}
class List {}
class Detail {}

const signedIn = () => true;
const mayRead = () => true;
const owner = () => true;

const routerWith = (config: Routes) => ({ config }) as unknown as Router;

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
  it('is the page under its whole path, with the guards, providers and data above it', () => {
    const router = routerWith(tabs());
    assert.deepEqual(presentedCommands(router, '/invoices/7'), [
      { outlets: { [PRESENTED]: ['invoices', '7'] } },
    ]);
    const copy = router.config.at(-1) as Route;
    assert.equal(copy.outlet, PRESENTED);
    assert.equal(copy.path, 'invoices/:id');
    assert.equal(copy.component, Detail, 'the page, and neither the bar nor the tab s stack');
    assert.deepEqual(copy.canActivate, [signedIn, mayRead, owner]);
    assert.deepEqual(copy.providers, [{ provide: 'feature', useValue: 'invoices' }]);
    assert.deepEqual(copy.data, { section: 'billing', kind: 'detail' });
  });

  it('is made once for a path, however many times a page of it is presented', () => {
    const router = routerWith(tabs());
    presentedCommands(router, '/invoices/7');
    presentedCommands(router, '/invoices/8');
    assert.equal(router.config.length, 2);
  });

  it('is the first screen of a tab, for the tab s own url', () => {
    const router = routerWith(tabs());
    presentedCommands(router, '/invoices');
    assert.equal((router.config.at(-1) as Route).component, List);
    assert.equal((router.config.at(-1) as Route).path, 'invoices');
  });

  it('leaves alone a url it cannot follow through the config', () => {
    for (const config of [
      [{ path: 'old', redirectTo: 'new' }],
      [{ path: '**', component: Detail }],
      [{ matcher: () => null, component: Detail }],
      [{ path: 'lazy', loadChildren: async () => [] }],
      [{ path: 'other', component: Detail }],
    ] as Routes[]) {
      const router = routerWith(config);
      const path = `/${config[0]!.path === '**' ? 'anything' : (config[0]!.path ?? 'x')}/1`;
      assert.equal(presentedCommands(router, path), null, JSON.stringify(config[0]!.path));
      assert.equal(router.config.length, 1, 'and adds nothing');
    }
  });
});
