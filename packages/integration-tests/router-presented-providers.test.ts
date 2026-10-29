/**
 * The instances a page of another tab, presented over the one in front, shares with the guards and
 * resolvers of the routes it sits inside. Angular makes one injector for a route with providers,
 * so an ancestor's guard, the page's own guards and its resolvers get one instance of a service
 * that ancestor provides, in the presented copy as in the tab.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, inject, InjectionToken, type Type } from '@angular/core';
import { ActivatedRoute, Router, type Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/presented-front.ts');
});

/** A service the tab's route provides, which a guard writes and the page's resolver reads. */
const SESSION = new InjectionToken<object>('session');
/** What the tab's route and the page each provide, the page's over the tab's. */
const POLICY = new InjectionToken<string>('policy');

type Seen = { who: string; session: object; policy: string }[];

function routes(seen: Seen): Routes {
  const record = (who: string) => () => {
    seen.push({ who, session: inject(SESSION), policy: inject(POLICY) });
    return true;
  };
  return [
    {
      path: '',
      component: mod['Bar'] as Type<unknown>,
      providers: [{ provide: POLICY, useValue: 'app' }],
      children: [
        { path: '', pathMatch: 'full', redirectTo: 'home' },
        { path: 'home', component: mod['Home'] as Type<unknown> },
        {
          path: 'library',
          component: mod['TabStack'] as Type<unknown>,
          providers: [
            { provide: SESSION, useFactory: () => ({}) },
            { provide: POLICY, useValue: 'library' },
          ],
          canActivate: [record('tab guard')],
          canActivateChild: [record('tab child guard')],
          resolve: { tab: record('tab resolver') },
          data: { section: 'music' },
          children: [
            { path: '', component: mod['Library'] as Type<unknown> },
            {
              path: ':id',
              component: mod['Album'] as Type<unknown>,
              providers: [{ provide: POLICY, useValue: 'album' }],
              canActivate: [record('page guard')],
              resolve: { seen: record('page resolver') },
            },
          ],
        },
      ],
    },
  ];
}

async function boot(seen: Seen) {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(routes(seen)),
      { provide: ErrorHandler, useValue: { handleError: () => {} } },
    ],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  assert.equal(router.url, '/home');
  return { router, navigation };
}

/** The deepest route of `outlet` under the root, and the outlet each route on the way is in. */
function deepest(router: Router, outlet: string): { route: ActivatedRoute; outlets: string[] } {
  let route = router.routerState.root.children.find((child) => child.outlet === outlet)!;
  const outlets = [route.outlet];
  while (route.firstChild) {
    route = route.firstChild;
    outlets.push(route.outlet);
  }
  return { route, outlets };
}

describe('a page of another tab presented over the one in front', () => {
  for (const visited of [false, true]) {
    it(`shares its tab's provider instances with that tab's guards${visited ? ', the page seen in its tab before' : ''}`, async () => {
      const seen: Seen = [];
      const { router, navigation } = await boot(seen);
      if (visited) {
        await router.navigateByUrl('/library/6');
        await settle();
        await router.navigateByUrl('/home');
        await settle();
        seen.length = 0;
      }

      await navigation.present('/library/7', { as: 'formSheet' });
      await settle();
      assert.equal(router.url, '/home(presented:library/7)');

      assert.deepEqual(
        seen.map(({ who, policy }) => [who, policy]),
        [
          ['tab guard', 'library'],
          ['tab child guard', 'library'],
          ['page guard', 'album'],
          ['tab resolver', 'library'],
          ['page resolver', 'album'],
        ],
        "each runs with its own route's providers over those above it",
      );
      const [first, ...rest] = seen.map(({ session }) => session);
      for (const [index, session] of rest.entries()) {
        assert.equal(session, first, `${seen[index + 1]!.who}: one instance, as in the tab`);
      }

      const presented = deepest(router, 'presented');
      assert.equal(presented.route.component, mod['Album'], 'the page is what is presented');
      assert.ok(
        presented.outlets.every((outlet) => outlet === 'presented'),
        `every route of the copy is in the presented outlet: ${presented.outlets.join(', ')}`,
      );
      assert.equal(presented.route.snapshot.paramMap.get('id'), '7');
      assert.deepEqual(
        presented.route.snapshot.data,
        { section: 'music', tab: true, seen: true },
        'with the data of the routes above it, and its own resolved',
      );
      assert.equal(
        deepest(router, 'primary').route.component,
        mod['Home'],
        'and home stays where it was under it',
      );

      if (visited) {
        const tab = seen[0]!.session;
        seen.length = 0;
        navigation.back();
        await settle();
        await settle();
        await router.navigateByUrl('/library/6');
        await settle();
        assert.ok(
          seen.every(({ session }) => session !== tab),
          'the copy has injectors of its own, not those of the page in its tab',
        );
      }
    });
  }
});
