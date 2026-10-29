/**
 * The page's own route in the presented copy is built from Angular's public `Route` fields: each
 * one that matters for a page is carried, and nothing else Angular put on the route comes along.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Route, Router } from '@angular/router';
import { PAGE_FIELDS, presentedCommands } from '../router/src/presented-route.ts';

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

/** The page's route as the presented outlet copies it, from a tab route that holds `page`. */
async function copyOf(page: Route): Promise<Record<string, unknown>> {
  const config: Route[] = [{ path: 'tab', children: [page] }];
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
  return config[1]!.children![0]! as Record<string, unknown>;
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
