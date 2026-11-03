/**
 * A pushed screen whose `canDeactivate` guards decide a native pop: the screen in front holds
 * `preventNativeDismiss` while leaving it would run a guard, so a swipe back, the iOS back button
 * and a pick from its long-press menu go to the router, where the guards answer.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ApplicationRef, type Type } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationStart, Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/guarded-sheet.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** A guard that refuses until `allow` is set, and counts how often it was asked. */
function guard() {
  const answer = Object.assign(
    () => {
      answer.runs++;
      return answer.allow;
    },
    { runs: 0, allow: false },
  );
  return answer;
}

/** The fixture's routes, with `canDeactivate` on `path`, or on its child at `inner`. */
function guardedAt(path: string, canDeactivate: () => boolean, inner?: string): Routes {
  return (mod['guardRoutes'] as Routes).map((route) => {
    if (route.path !== path) return route;
    if (inner === undefined) return { ...route, canDeactivate: [canDeactivate] };
    const children = route.children!.map((child) =>
      child.path === inner ? { ...child, canDeactivate: [canDeactivate] } : child,
    );
    return { ...route, children };
  });
}

async function boot(config: Routes) {
  const app = await render(mod['GuardShell'] as Type<unknown>, {
    providers: [provideNativeRouter(config)],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  /** The screens of the app's own stack, oldest first. */
  const screens = () =>
    flatten(app.fabric.committed)
      .find((node) => node.viewName === 'RNSScreenStack')!
      .children.filter((node) => node.viewName === 'RNSScreen');
  const held = (screen: FakeFabricNode | undefined) =>
    screen?.props['preventNativeDismiss'] === true;
  const tick = () => {
    app.componentRef.changeDetectorRef.markForCheck();
    app.componentRef.injector.get(ApplicationRef).tick();
  };
  const location = app.componentRef.injector.get(Location);
  return { router, navigation, location, screens, held, tick };
}

describe('a pushed screen a guard decides for', () => {
  it('refuses a native pop, and asks the guard', async () => {
    const editor = guard();
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(app.held(app.screens()[1]), true, 'native cannot pop it');

    await fireEvent(app.screens()[1]!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(editor.runs, 1);
    assert.equal(app.router.url, '/editor');
    assert.equal(app.screens().length, 2, 'the screen is still up');

    editor.allow = true;
    await fireEvent(app.screens()[1]!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(editor.runs, 2);
    assert.equal(app.router.url, '/');
    assert.equal(app.screens().length, 1, 'and the router took it off the stack');
  });

  it('goes back as far as a pick from the back button menu asks, when the guard allows', async () => {
    const editor = guard();
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/compose/more');
    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(app.screens().length, 3);

    await fireEvent(app.screens()[2]!, 'nativeDismissCancelled', { dismissCount: 2 });
    await settled();
    assert.equal(app.router.url, '/editor', 'refused');
    assert.equal(app.screens().length, 3);

    editor.allow = true;
    await fireEvent(app.screens()[2]!, 'nativeDismissCancelled', { dismissCount: 2 });
    await settled();
    assert.equal(app.router.url, '/');
    assert.equal(app.screens().length, 1);
  });

  it('does not hold the first screen of a stack, which native cannot pop', async () => {
    const home = guard();
    const config = (mod['guardRoutes'] as Routes).map((route) =>
      route.path === '' ? { ...route, canDeactivate: [home] } : route,
    );
    const app = await boot(config);
    assert.equal(app.screens().length, 1);
    assert.equal(app.held(app.screens()[0]), false);
  });

  it('asks only the guards of the screen in front for a menu pick past covered screens, as a back of two does', async () => {
    /** Pushes a guarded editor and an unguarded screen over it, then goes back two by `back`. */
    async function pastGuarded(back: (app: Awaited<ReturnType<typeof boot>>) => Promise<void>) {
      const editor = guard();
      editor.allow = true;
      const app = await boot(guardedAt('editor', editor));
      await app.router.navigateByUrl('/editor');
      await app.router.navigateByUrl('/compose');
      await settled();
      assert.equal(
        app.held(app.screens()[2]),
        false,
        'nothing holds the unguarded screen in front',
      );
      editor.allow = false;
      const asked = editor.runs;
      await back(app);
      await settled();
      return { url: app.router.url, depth: app.screens().length, asked: editor.runs - asked };
    }
    // Native pops both, as nothing in the way refuses, and tells the screen that was in front.
    const picked = await pastGuarded((app) =>
      fireEvent(app.screens()[2]!, 'dismissed', { dismissCount: 2 }),
    );
    cleanup();
    const twice = await pastGuarded(async (app) => app.location.historyGo(-2));
    assert.deepEqual(picked, { url: '/', depth: 1, asked: 0 });
    assert.deepEqual(twice, picked);
  });

  it('leaves a pushed screen without a guard to native', async () => {
    const app = await boot(mod['guardRoutes'] as Routes);
    await app.router.navigateByUrl('/editor');
    await settled();
    assert.equal(app.held(app.screens()[1]), false);
  });

  it('holds the screen only while it is in front', async () => {
    const editor = guard();
    editor.allow = true;
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/editor');
    await settled();
    await app.router.navigateByUrl('/compose');
    await settled();
    assert.equal(app.held(app.screens()[1]), false, 'covered, it is not what a pop leaves');

    app.navigation.back();
    await settled();
    assert.equal(app.router.url, '/editor');
    assert.equal(app.held(app.screens()[1]), true, 'in front again');
  });

  it('lets go when the route showing inside it no longer has a guard, and holds when one does', async () => {
    const inner = guard();
    inner.allow = true;
    const app = await boot(guardedAt('compose', inner, ''));
    await app.router.navigateByUrl('/compose');
    await settled();
    assert.equal(app.held(app.screens()[1]), true);

    await app.router.navigateByUrl('/compose/more');
    await settled();
    assert.equal(app.router.url, '/compose/more');
    assert.equal(app.held(app.screens()[1]), false);

    app.navigation.back();
    await settled();
    assert.equal(app.router.url, '/compose');
    assert.equal(app.held(app.screens()[1]), true);
  });

  it('leaves a refusal the page binds to the page', async () => {
    const editor = guard();
    editor.allow = true;
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/editor');
    await settled();
    const page = (
      mod['editors'] as { dirty: { set(value: boolean): void }; attempts(): number }[]
    ).at(-1)!;
    page.dirty.set(true);
    await settled();
    await fireEvent(app.screens()[1]!, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(page.attempts(), 1);
    assert.equal(editor.runs, 0);
    assert.equal(app.router.url, '/editor');
  });

  it("asks the guard for Android's header back arrow", async () => {
    const editor = guard();
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/editor');
    await settled();
    await fireEvent(app.screens()[1]!, 'headerBackButtonClicked', {});
    await settled();
    assert.equal(editor.runs, 1);
    assert.equal(app.router.url, '/editor');
  });

  it('follows a pop native made anyway, without asking the guard', async () => {
    const editor = guard();
    const app = await boot(guardedAt('editor', editor));
    await app.router.navigateByUrl('/editor');
    await settled();
    await fireEvent(app.screens()[1]!, 'dismissed', { dismissCount: 1 });
    await settled();
    assert.equal(editor.runs, 0);
    assert.equal(app.router.url, '/');
  });
});

describe('a guarded push inside a presented stack', () => {
  it('leaves the sheet to its own hold, so a swipe down asks about the whole sheet', async () => {
    const more = guard();
    const app = await boot(guardedAt('compose', more, 'more'));
    await app.navigation.present('/compose', { as: 'formSheet' });
    await settled();
    await app.router.navigateByUrl('/compose/more');
    await settled();
    // One more render: a stack reads its top screen's refusal after each, and the page inside was
    // held in the last one.
    app.tick();
    await settled();
    const sheet = app.screens()[1]!;
    assert.equal(sheet.props['stackPresentation'], 'formSheet');
    assert.equal(app.held(sheet), true);

    let navigations = 0;
    app.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) navigations++;
    });
    await fireEvent(sheet, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(navigations, 1, 'one attempt, for the sheet');
    assert.equal(more.runs, 1);
    assert.equal(app.router.url, '/compose/more');

    more.allow = true;
    await fireEvent(sheet, 'nativeDismissCancelled', { dismissCount: 1 });
    await settled();
    assert.equal(more.runs, 2);
    assert.equal(app.router.url, '/', 'the sheet went, not only the page on top inside it');
  });
});
