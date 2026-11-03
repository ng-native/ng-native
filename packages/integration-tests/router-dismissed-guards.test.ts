/**
 * A screen native has already dismissed, and the `canDeactivate` guards of its routes: the router
 * follows without asking them. Dragging a `formSheet` down on Android dismisses it whatever the
 * screen's `preventNativeDismiss` says, and the screen does not come back, so a refusal would leave
 * the router on a page nobody can see.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { InjectionToken, type Type } from '@angular/core';
import { Router, type Route, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let tabs: Record<string, unknown>;
let sheets: Record<string, unknown>;
before(async () => {
  tabs = await compileFixture('fixtures/presented-front.ts');
  sheets = await compileFixture('fixtures/guarded-sheet.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** A guard that refuses until `allow` is set, and counts how often it was asked. */
function refusing() {
  const guard = Object.assign(
    () => {
      guard.runs++;
      return guard.allow;
    },
    { runs: 0, allow: false },
  );
  return guard;
}

async function boot(root: Type<unknown>, config: Routes) {
  const app = await render(root, { providers: [provideNativeRouter(config)] });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
  const sheet = () => screens().find((node) => node.props['stackPresentation'] === 'formSheet');
  return { router, navigation, screens, sheet };
}

describe('a sheet of another tab that native dismissed', () => {
  function routes(library: Partial<Route>, album: Partial<Route> = {}): Routes {
    return [
      {
        path: '',
        component: tabs['Bar'] as Type<unknown>,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          { path: 'home', component: tabs['Home'] as Type<unknown> },
          {
            path: 'library',
            component: tabs['TabStack'] as Type<unknown>,
            children: [
              { path: '', component: tabs['Library'] as Type<unknown> },
              { path: ':id', component: tabs['Album'] as Type<unknown>, ...album },
            ],
            ...library,
          },
        ],
      },
    ];
  }

  for (const place of ['its own route', 'a route above it']) {
    it(`goes past a refusing guard on ${place}`, async () => {
      const guard = refusing();
      const guarded = { canDeactivate: [guard] };
      const config = place === 'its own route' ? routes({}, guarded) : routes(guarded);
      const app = await boot(tabs['Shell'] as Type<unknown>, config);
      await app.navigation.present('/library/7', { as: 'formSheet' });
      await settled();

      await fireEvent(app.sheet()!, 'dismissed', { dismissCount: 1 });
      await settled();
      assert.equal(app.router.url, '/home');
      assert.equal(app.sheet(), undefined);
      assert.equal(guard.runs, 0, 'the guard was not asked');

      // The page presented again is a new one, and its guard decides for it.
      await app.navigation.present('/library/7', { as: 'formSheet' });
      await settled();
      await fireEvent(app.sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
      await settled();
      assert.equal(guard.runs, 1);
      assert.equal(app.router.url, '/home(presented:library/7)');
    });
  }
});

describe('a screen on the same stack that native dismissed', () => {
  function guardedAt(path: string, guard: () => boolean, inner = false): Routes {
    return (sheets['guardRoutes'] as Routes).map((route) => {
      if (route.path !== path) return route;
      if (!inner) return { ...route, canDeactivate: [guard] };
      const [first, ...rest] = route.children!;
      return { ...route, children: [{ ...first, canDeactivate: [guard] }, ...rest] };
    });
  }

  it('goes past a refusing guard on a sheet', async () => {
    const guard = refusing();
    const app = await boot(sheets['GuardShell'] as Type<unknown>, guardedAt('editor', guard));
    await app.navigation.present('/editor', { as: 'formSheet' });
    await settled();

    await fireEvent(app.sheet()!, 'dismissed', { dismissCount: 1 });
    await settled();
    assert.equal(app.router.url, '/');
    assert.equal(app.sheet(), undefined);
    assert.equal(guard.runs, 0);
  });

  it('goes past a refusing guard on the route showing inside the sheet', async () => {
    const guard = refusing();
    const app = await boot(
      sheets['GuardShell'] as Type<unknown>,
      guardedAt('compose', guard, true),
    );
    await app.navigation.present('/compose', { as: 'formSheet' });
    await settled();

    await fireEvent(app.sheet()!, 'dismissed', { dismissCount: 1 });
    await settled();
    assert.equal(app.router.url, '/');
    assert.equal(guard.runs, 0);
  });

  it('goes past a refusing guard on a pushed screen swiped back', async () => {
    const guard = refusing();
    const app = await boot(sheets['GuardShell'] as Type<unknown>, guardedAt('editor', guard));
    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(app.screens().length, 2);

    await fireEvent(app.screens().at(-1)!, 'dismissed', { dismissCount: 1 });
    await settled();
    assert.equal(app.router.url, '/');
    assert.equal(app.screens().length, 1);
    assert.equal(guard.runs, 0);
  });

  it('goes past the guards of every screen one native pop took off', async () => {
    const editor = refusing();
    const compose = refusing();
    const config = guardedAt('compose', compose, true).map((route) =>
      route.path === 'editor' ? { ...route, canDeactivate: [editor] } : route,
    );
    const app = await boot(sheets['GuardShell'] as Type<unknown>, config);
    editor.allow = true;
    await app.router.navigateByUrl('/editor');
    await settled();
    await app.router.navigateByUrl('/compose');
    await settled();
    assert.equal(app.screens().length, 4, 'two pushed, and the one inside the second');
    editor.allow = false;
    const asked = editor.runs;

    // The outer stack's top screen, not the one in the stack inside it.
    await fireEvent(app.screens()[2]!, 'dismissed', { dismissCount: 2 });
    await settled();
    assert.equal(app.router.url, '/');
    assert.equal(app.screens().length, 1);
    assert.equal(editor.runs, asked);
    assert.equal(compose.runs, 0);
  });

  it('still asks the guard of a screen native has not dismissed', async () => {
    const guard = refusing();
    const app = await boot(sheets['GuardShell'] as Type<unknown>, guardedAt('editor', guard));
    await app.router.navigateByUrl('/editor');
    await settled();
    await fireEvent(app.screens().at(-1)!, 'dismissed', { dismissCount: 1 });
    await settled();

    // The same route pushed again is a new screen, which its guard holds.
    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(await app.router.navigateByUrl('/'), false);
    assert.equal(guard.runs, 1);
    assert.equal(app.router.url, '/editor');
  });

  it('asks a guard given as a token of a screen native has not dismissed', async () => {
    let runs = 0;
    const token = new InjectionToken('refusing', {
      providedIn: 'root',
      factory: () => ({ canDeactivate: () => (runs++, false) }),
    });
    const app = await boot(
      sheets['GuardShell'] as Type<unknown>,
      guardedAt('editor', token as never),
    );
    await app.router.navigateByUrl('/editor');
    await settled();
    await fireEvent(app.screens().at(-1)!, 'dismissed', { dismissCount: 1 });
    await settled();
    assert.equal(runs, 0);

    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(await app.router.navigateByUrl('/'), false);
    assert.equal(runs, 1);
  });

  it("wraps a route's guards once, however often its screens are dismissed", async () => {
    const app = await boot(sheets['GuardShell'] as Type<unknown>, guardedAt('editor', refusing()));
    const editor = app.router.config.find((route) => route.path === 'editor')!;
    const guards: unknown[] = [];
    for (let time = 0; time < 2; time++) {
      await app.router.navigateByUrl('/editor');
      await settled();
      await fireEvent(app.screens().at(-1)!, 'dismissed', { dismissCount: 1 });
      await settled();
      assert.equal(app.router.url, '/');
      guards.push(editor.canDeactivate![0]);
    }
    assert.equal(guards[1], guards[0]);
  });
});
