/**
 * A page presented over the tab in front, and the `canDeactivate` guards that decide whether it
 * can go: the routes above it have no component in the copy the page is presented through.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, InjectionToken, inject, type Type } from '@angular/core';
import { Router, type Route, type Routes } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/presented-front.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

function routes(library: Partial<Route>, album: Partial<Route> = {}): Routes {
  return [
    {
      path: '',
      component: mod['Bar'] as Type<unknown>,
      children: [
        { path: '', pathMatch: 'full', redirectTo: 'home' },
        { path: 'home', component: mod['Home'] as Type<unknown> },
        {
          path: 'library',
          component: mod['TabStack'] as Type<unknown>,
          children: [
            { path: '', component: mod['Library'] as Type<unknown> },
            { path: ':id', component: mod['Album'] as Type<unknown>, ...album },
          ],
          ...library,
        },
      ],
    },
  ];
}

async function boot(library: Partial<Route>, album?: Partial<Route>) {
  const errors: unknown[] = [];
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(routes(library, album)),
      { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
    ],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  const sheet = () =>
    flatten(app.fabric.committed).find(
      (node) => node.viewName === 'RNSScreen' && node.props['stackPresentation'] === 'formSheet',
    );
  return { router, navigation, sheet, errors };
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('a guard above a presented page that fails on its null component', () => {
  const fails = new TypeError('the guard read its component');
  const readsComponent = (stack: { blocked: boolean }) => !stack.blocked;

  /** Presents the page under `canDeactivate`, and asks to go back from it. */
  async function dismissed(canDeactivate: Route['canDeactivate']) {
    const app = await boot({ canDeactivate });
    await app.navigation.present('/library/7', { as: 'formSheet' });
    await settled();
    assert.equal(app.router.url, '/home(presented:library/7)');
    app.navigation.back();
    await settled();
    return app;
  }

  it('lets the page go, and reports the failure', async () => {
    const { router, errors } = await dismissed([readsComponent]);
    assert.equal(router.url, '/home');
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof TypeError);
  });

  it('lets it go when the guard fails asynchronously', async () => {
    const { router, errors } = await dismissed([() => Promise.reject(fails)]);
    assert.equal(router.url, '/home');
    assert.deepEqual(errors, [fails]);
  });

  it('lets it go when the guard answers with an observable that fails', async () => {
    const { router, errors } = await dismissed([() => throwError(() => fails)]);
    assert.equal(router.url, '/home');
    assert.deepEqual(errors, [fails]);
  });

  it('still refuses when a guard answers no, whichever way it answers', async () => {
    for (const refusal of [false, Promise.resolve(false), of(false)]) {
      const { router, errors } = await dismissed([() => refusal]);
      assert.equal(router.url, '/home(presented:library/7)');
      assert.deepEqual(errors, []);
      cleanup();
    }
  });

  it('takes only the first answer of an observable', async () => {
    let stopped = false;
    const answers = new Observable<boolean>((subscriber) => {
      subscriber.next(true);
      return () => (stopped = true);
    });
    const { router } = await dismissed([() => answers]);
    assert.equal(router.url, '/home');
    assert.equal(stopped, true, 'and stops listening');
  });

  it('runs a guard given as a token', async () => {
    const refusing = new InjectionToken('refusing', {
      providedIn: 'root',
      factory: () => ({ canDeactivate: () => false }),
    });
    const { router } = await dismissed([refusing]);
    assert.equal(router.url, '/home(presented:library/7)');
  });

  it('runs in an injection context, as the router runs a guard', async () => {
    const { router } = await dismissed([() => !inject(Router).url.includes('presented')]);
    assert.equal(router.url, '/home(presented:library/7)');
  });

  it('control: in the tab the guard is given its component', async () => {
    const seen: unknown[] = [];
    const { router } = await boot({
      canDeactivate: [
        (stack: unknown) => {
          seen.push(stack);
          return true;
        },
      ],
    });
    await router.navigateByUrl('/library/7');
    await settled();
    await router.navigateByUrl('/home');
    await settled();
    assert.equal(router.url, '/home');
    assert.ok(seen[0] instanceof (mod['TabStack'] as Type<unknown>));
  });
});

describe('a sheet of another tab a guard decides for', () => {
  async function presented(library: Partial<Route>, album?: Partial<Route>) {
    const app = await boot(library, album);
    await app.navigation.present('/library/7', { as: 'formSheet' });
    await settled();
    return app;
  }

  for (const place of ['its own route', 'a route above it']) {
    it(`refuses natively, and asks a guard on ${place}`, async () => {
      let allow = false;
      let runs = 0;
      const guarded = {
        canDeactivate: [
          () => {
            runs++;
            return allow;
          },
        ],
      };
      const { router, sheet } =
        place === 'its own route' ? await presented({}, guarded) : await presented(guarded);
      assert.equal(sheet()!.props['preventNativeDismiss'], true, 'native cannot dismiss it');
      assert.equal(runs, 0);

      await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
      await settled();
      assert.equal(runs, 1);
      assert.equal(router.url, '/home(presented:library/7)');
      assert.ok(sheet(), 'the sheet is still up');

      allow = true;
      await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
      await settled();
      assert.equal(router.url, '/home');
      assert.equal(sheet(), undefined, 'and the router took it off the stack');
    });
  }

  it('leaves a sheet with no guard to native', async () => {
    const { router, sheet } = await presented({});
    assert.notEqual(sheet()!.props['preventNativeDismiss'], true);
    await fireEvent(sheet()!, 'dismissed', {});
    await settled();
    assert.equal(router.url, '/home');
  });

  it("goes the same way for Android's header back arrow", async () => {
    let runs = 0;
    const refuses = () => {
      runs++;
      return false;
    };
    const { router, sheet } = await presented({}, { canDeactivate: [refuses] });
    await fireEvent(sheet()!, 'headerBackButtonClicked', {});
    await settled();
    assert.equal(runs, 1);
    assert.equal(router.url, '/home(presented:library/7)');
  });
});

describe('a sheet on the same stack a guard decides for', () => {
  let sheetMod: Record<string, unknown>;
  before(async () => {
    sheetMod = await compileFixture('fixtures/guarded-sheet.ts');
  });

  interface Editor {
    dirty: { set(value: boolean): void };
    attempts: () => number;
  }

  /** The fixture's routes, with `canDeactivate` on `path`, or on its first child with `inner`. */
  function guardedAt(path: string, guard: () => boolean, inner = false): Routes {
    return (sheetMod['guardRoutes'] as Routes).map((route) => {
      if (route.path !== path) return route;
      if (!inner) return { ...route, canDeactivate: [guard] };
      const [first, ...rest] = route.children!;
      return { ...route, children: [{ ...first, canDeactivate: [guard] }, ...rest] };
    });
  }

  async function open(url: string, config: Routes, presenting = true) {
    const app = await render(sheetMod['GuardShell'] as Type<unknown>, {
      providers: [provideNativeRouter(config)],
    });
    await settle();
    const router = app.componentRef.injector.get(Router);
    const navigation = app.componentRef.injector.get(NativeNavigation);
    if (presenting) await navigation.present(url, { as: 'formSheet' });
    else await router.navigateByUrl(url);
    await settled();
    const screens = () =>
      flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
    const editor = (sheetMod['editors'] as Editor[]).at(-1)!;
    const sheet = () => screens().find((node) => node.props['stackPresentation'] === 'formSheet');
    return { router, navigation, screens, sheet, editor };
  }

  it('asks the guard, and leaves when it allows', async () => {
    let allow = false;
    const { router, sheet } = await open(
      '/editor',
      guardedAt('editor', () => allow),
    );
    assert.equal(sheet()!.props['preventNativeDismiss'], true);
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(router.url, '/editor');
    assert.ok(sheet());

    allow = true;
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(router.url, '/');
    assert.equal(sheet(), undefined);
  });

  it('holds a screen whose guard is on the route showing inside it', async () => {
    let allow = false;
    const { router, sheet } = await open(
      '/compose',
      guardedAt('compose', () => allow, true),
    );
    assert.equal(sheet()!.props['preventNativeDismiss'], true);
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(router.url, '/compose');
    allow = true;
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(router.url, '/');
  });

  it('takes a report that comes late for a sheet nothing holds as no attempt', async () => {
    const { router, sheet, editor } = await open('/compose', sheetMod['guardRoutes'] as Routes);
    editor.dirty.set(true);
    await settled();
    editor.dirty.set(false);
    await settled();
    assert.notEqual(sheet()!.props['preventNativeDismiss'], true, 'the refusal was let go');
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(router.url, '/compose');
    assert.ok(sheet());
  });

  it('leaves a pushed screen to native', async () => {
    const { screens } = await open(
      '/editor',
      guardedAt('editor', () => false),
      false,
    );
    assert.notEqual(screens().at(-1)!.props['preventNativeDismiss'], true);
  });

  it('leaves a refusal the page binds to the page, and asks once it lets go', async () => {
    let runs = 0;
    const allows = () => {
      runs++;
      return true;
    };
    const { router, sheet, editor } = await open('/editor', guardedAt('editor', allows));
    editor.dirty.set(true);
    await settled();
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(editor.attempts(), 1, 'the page heard the attempt');
    assert.equal(runs, 0, 'and it was the page that refused');
    assert.equal(router.url, '/editor');

    editor.dirty.set(false);
    await settled();
    assert.equal(sheet()!.props['preventNativeDismiss'], true, 'the guards still decide');
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(runs, 1);
    assert.equal(router.url, '/');
  });

  it('gives the page inside a guarded stack its refusal, and the guard the rest', async () => {
    let runs = 0;
    const allows = () => {
      runs++;
      return true;
    };
    const { router, sheet, editor } = await open('/compose', guardedAt('compose', allows));
    editor.dirty.set(true);
    await settled();
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(editor.attempts(), 1, 'the page inside heard the attempt');
    assert.equal(runs, 0);

    editor.dirty.set(false);
    await settled();
    await fireEvent(sheet()!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(editor.attempts(), 1, 'it no longer refuses');
    assert.equal(runs, 1);
    assert.equal(router.url, '/');
  });
});
