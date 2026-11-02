/**
 * The page's own route in the presented copy, and the copy of each route it sits inside, are built
 * from Angular's public `Route` fields: each one that matters there is carried, and nothing else
 * Angular put on the route comes along.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Route, Router } from '@angular/router';
import { ANCESTOR_FIELDS, PAGE_FIELDS, presentedCommands } from '../router/src/presented-route.ts';

class Page {}
const guard = () => true;

/** A value for each field the copy keeps. */
const KEPT: Record<string, unknown> = {
  title: 'Album',
  component: Page,
  loadComponent: () => Page,
  canActivate: [guard],
  canActivateChild: [guard],
  canDeactivate: [guard],
  data: { kind: 'album' },
  resolve: { album: () => 1 },
  resources: () => ({}),
  runGuardsAndResolvers: 'always',
  providers: [],
};

/** A value for each field the copy of a route above the page keeps. */
const KEPT_ABOVE: Record<string, unknown> = {
  title: 'Albums',
  canActivate: [guard],
  canActivateChild: [guard],
  canDeactivate: [guard],
  data: { kind: 'albums' },
  resolve: { albums: () => 1 },
  resources: () => ({}),
  runGuardsAndResolvers: 'always',
  providers: [],
};

/** The routes the presented outlet copies, from a route `tab` that holds `page`. */
async function copiesOf(
  page: Route,
  tab: Partial<Route> = {},
): Promise<{ tab: Record<string, unknown>; page: Record<string, unknown> }> {
  const config: Route[] = [{ path: 'tab', ...tab, children: [page] }];
  const router = {
    config,
    parseUrl: () => ({
      root: {
        segments: [],
        children: {
          primary: {
            segments: [
              { path: 'tab', parameters: {} },
              { path: 'album', parameters: {} },
            ],
            children: {},
          },
        },
      },
    }),
  } as unknown as Router;
  assert.ok(await presentedCommands(router, 'tab/album'));
  return {
    tab: config[1] as Record<string, unknown>,
    page: config[1]!.children![0]! as Record<string, unknown>,
  };
}

/** The page's route as the presented outlet copies it, from a tab route that holds `page`. */
async function copyOf(page: Route): Promise<Record<string, unknown>> {
  return (await copiesOf(page)).page;
}

describe('the presented copy of a page route', () => {
  it('has a value for each field it keeps, and for no other', () => {
    const kept = Object.entries(PAGE_FIELDS)
      .filter(([, keep]) => keep)
      .map(([field]) => field);
    assert.deepEqual(Object.keys(KEPT).sort(), kept.sort());
  });

  for (const [field, value] of Object.entries(KEPT)) {
    it(`carries ${field}`, async () => {
      const route: Route = {
        path: 'album',
        ...(field === 'loadComponent' ? {} : { component: Page }),
      };
      const copy = await copyOf({ ...route, [field]: value } as Route);
      assert.strictEqual(copy[field], value);
    });
  }

  it('carries no field outside the public ones', async () => {
    const copy = await copyOf({
      path: 'album',
      component: Page,
      _made: 'by Angular',
    } as Route);
    assert.deepEqual(Object.keys(copy).sort(), ['component', 'outlet', 'path', 'pathMatch']);
  });
});

describe('the presented copy of a route above the page', () => {
  it('has a value for each field it keeps, and for no other', () => {
    const kept = Object.entries(ANCESTOR_FIELDS)
      .filter(([, keep]) => keep)
      .map(([field]) => field);
    assert.deepEqual(Object.keys(KEPT_ABOVE).sort(), kept.sort());
  });

  for (const [field, value] of Object.entries(KEPT_ABOVE)) {
    it(`carries ${field}`, async () => {
      const { tab } = await copiesOf({ path: 'album', component: Page }, { [field]: value });
      // Wrapped, as the guard is given no component there: router-presented-guards.test.ts.
      if (field === 'canDeactivate') assert.equal((tab[field] as unknown[]).length, 1);
      else assert.strictEqual(tab[field], value);
    });
  }

  it('carries no field outside the public ones, nor its component', async () => {
    const { tab } = await copiesOf({ path: 'album', component: Page }, {
      component: Page,
      _made: 'by Angular',
    } as Partial<Route>);
    assert.deepEqual(Object.keys(tab).sort(), ['children', 'outlet', 'path', 'pathMatch']);
  });
});
