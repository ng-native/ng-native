/**
 * Route resources on a page's inputs, on a native stack and in a native tab, compared with what
 * Angular's own RouterOutlet binds for the same routes: a blocking resource reaches its input as
 * the resource's value, a non-blocking one as the resource itself, and a later change lands when
 * it does under RouterOutlet.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { provideLocationMocks } from '@angular/common/testing';
import { inject, type InjectionToken, type Type } from '@angular/core';
import {
  NavigationEnd,
  Router,
  provideRouter,
  withComponentInputBinding,
  withRouterResources,
  type Routes,
} from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { ROUTE_INPUT_BINDER } from '../router/src/bind-route-inputs.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

interface Page {
  user(): string | undefined;
  feed(): { value(): unknown } | undefined;
  q(): string | undefined;
}

describe('route resources on inputs', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/route-resource-inputs.ts');
  });

  afterEach(() => cleanup());

  /**
   * Open `url` under `shell`, natively or under RouterOutlet, and say what the page shows and
   * what its inputs held when each later navigation ended, before anything after it ran.
   */
  async function open(shell: string, routes: string, url: string, native: boolean, extra = []) {
    const features = [withComponentInputBinding(), withRouterResources()] as const;
    const table = mod[routes] as Routes;
    const app = await render(mod[shell] as Type<unknown>, {
      providers: [
        ...(native
          ? [provideNativeRouter(table, ...features)]
          : [provideRouter(table, ...features), provideLocationMocks()]),
        ...extra,
      ],
    });
    const router = app.componentRef.injector.get(Router);
    const pages = mod['pages'] as Page[];
    pages.length = 0;
    const atEnd: (string | undefined)[] = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) atEnd.push(pages.at(-1)?.q());
    });
    await router.navigateByUrl(url);
    await idle();
    const page = () =>
      flatten(app.fabric.committed)
        .map((node) => node.props['text'])
        .filter((text): text is string => typeof text === 'string' && text.startsWith('page'));
    return { page, router, pages, atEnd };
  }

  for (const [where, shell, routes, url] of [
    ['on a native stack', 'StackShell', 'stackRoutes', '/page/7'],
    ['in a native tab', 'TabsShell', 'tabRoutes', '/page'],
  ] as const) {
    describe(where, () => {
      it('binds a blocking resource as its value and a non-blocking one as the resource', async () => {
        const angular = await open('AngularShell', routes, url, false);
        const expected = angular.page();
        const id = url === '/page' ? '' : '7';
        const key = id || 'tab';
        assert.deepEqual(
          expected,
          [`page id=${id} user=user ${key} feed=feed ${key} q=`],
          'RouterOutlet',
        );
        const angularPage = angular.pages.at(-1)!;
        cleanup();

        const native = await open(shell, routes, url, true);
        assert.deepEqual(native.page(), expected);
        const nativePage = native.pages.at(-1)!;
        assert.equal(nativePage.user(), angularPage.user());
        assert.equal(typeof nativePage.feed()?.value, 'function', 'the resource itself');
        assert.equal(nativePage.feed()?.value(), angularPage.feed()?.value());
      });

      it('lands a later change a microtask after the navigation, as RouterOutlet does', async () => {
        const later = async (native: boolean, extra: never[] = []) => {
          const app = await open(native ? shell : 'AngularShell', routes, url, native, extra);
          await app.router.navigateByUrl(url + '?q=later');
          await idle();
          return { atEnd: app.atEnd, page: app.page() };
        };
        const angular = await later(false);
        cleanup();
        const native = await later(true);
        assert.deepEqual(angular.atEnd, [undefined, undefined], 'not yet set when it ends');
        assert.deepEqual(native, angular);
      });
    });
  }

  it("releases each page from Angular's binder once it is gone", async () => {
    // The binder keeps every page it binds in maps until it is released, ComponentRef and all.
    type Binder = Record<
      'bindActivatedRouteToOutletComponent' | 'unsubscribeFromRouteData',
      Function
    >;
    const token = (withComponentInputBinding().ɵproviders[0] as { provide: InjectionToken<Binder> })
      .provide;
    const bound = new Set<unknown>();
    const app = await open('StackShell', 'stackRoutes', '/page/7', true, [
      {
        provide: ROUTE_INPUT_BINDER,
        useFactory: () => {
          const real = inject(token);
          return {
            bindActivatedRouteToOutletComponent: (page: unknown, injector: unknown) => {
              bound.add(page);
              real.bindActivatedRouteToOutletComponent.call(real, page, injector);
            },
            unsubscribeFromRouteData: (page: unknown) => {
              bound.delete(page);
              real.unsubscribeFromRouteData.call(real, page);
            },
          };
        },
      },
    ] as never);
    assert.deepEqual(app.page(), ['page id=7 user=user 7 feed=feed 7 q='], 'through the wrapper');
    assert.equal(bound.size, 2, 'home and the page');

    await app.router.navigateByUrl('/');
    await idle();
    assert.equal(bound.size, 1, 'the page popped off the stack is released');
  });

  it('falls back to its own binding when the binder lacks the methods it calls', async () => {
    const binder = { options: { queryParams: false } };
    const app = await open('StackShell', 'stackRoutes', '/page/7?q=from-query', true, [
      { provide: ROUTE_INPUT_BINDER, useValue: binder },
    ] as never);
    // Query params, path params and data still bind, by the binder's options; resources do not.
    assert.deepEqual(app.page(), ['page id=7 user= feed= q=']);
    assert.equal(app.pages.at(-1)!.user(), undefined);
  });
});
