/**
 * A page whose code fails to load, as a lazy route's chunk does when the dev server cannot serve
 * it. Whichever native path asked for it, the failure is Angular's `NavigationError`, and the
 * app's `withNavigationErrorHandler` hears it once: that is what the Router page's "When a page
 * fails to load" section tells an app to build on. The tab bar goes back to the tab the router is
 * still on.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorHandler, InjectionToken, inject, signal, type Type } from '@angular/core';
import { Router, withNavigationErrorHandler, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { DeepLinks } from '@ng-native/device';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await settle();
}

const chunkError = () => new Error('Could not load bundle');

describe('a page whose code fails to load', () => {
  let mod: Record<string, unknown>;
  /** What `withNavigationErrorHandler` heard. */
  let heard: unknown[];
  /** What reached the app's `ErrorHandler`. */
  let reported: unknown[];
  let arrive: (url: string) => void;

  before(async () => {
    mod = await compileFixture(fileURLToPath(new URL('./fixtures/tab-stacks.ts', import.meta.url)));
  });

  beforeEach(() => {
    heard = [];
    reported = [];
  });

  afterEach(() => cleanup());

  /** The tab-stacks app, with its search tab and a detail page both loading lazily and failing. */
  async function launch(initialLink: string | null = null) {
    const [shell, detail] = mod['routes'] as Routes;
    const failing: Routes = [
      {
        ...shell,
        children: shell!.children!.map((child) =>
          child.path === 'search'
            ? { path: 'search', loadComponent: () => Promise.reject(chunkError()) }
            : child,
        ),
      },
      detail!,
      { path: 'broken/:id', loadComponent: () => Promise.reject(chunkError()) },
    ];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(
          failing,
          withNavigationErrorHandler((error) => void heard.push(error.error)),
          withLinkParent((url) => (url.startsWith('/broken/') ? '/home' : null)),
        ),
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => reported.push(e) } },
        {
          provide: DeepLinks,
          useValue: {
            initialUrl: () => initialLink,
            subscribe: (listener: (url: string) => void) => ((arrive = listener), () => {}),
          },
        },
      ],
    });
    await idle();
    const injector = app.componentRef.injector;
    return { app, router: injector.get(Router), nav: injector.get(NativeNavigation) };
  }

  const once = () => {
    assert.equal(heard.length, 1, 'the handler heard it once');
    assert.match(String(heard[0]), /Could not load bundle/);
  };
  /** A failure nobody awaits reaches the ErrorHandler too, once, rather than going unhandled. */
  const reportedOnce = () => {
    assert.equal(reported.length, 1, 'the ErrorHandler heard it once');
    assert.match(String(reported[0]), /Could not load bundle/);
  };

  it('from a tab tap: heard once, and the bar goes back to the tab the router is on', async () => {
    const { app, router } = await launch();
    assert.equal(router.url, '/home');
    const host = flatten(app.fabric.committed).find((n) => n.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });
    await idle();
    once();
    reportedOnce();
    assert.equal(router.url, '/home');
    const request = flatten(app.fabric.committed).find((n) => n.viewName === 'RNSTabsHostIOS')!
      .props['navStateRequest'] as { selectedScreenKey: string; baseProvenance: number };
    // Native had already switched to search, so the bar is asked back, against the tap's state.
    assert.deepEqual(
      request,
      { selectedScreenKey: 'home', baseProvenance: 1 },
      'the bar is sent back to the tab the app is on',
    );
  });

  it('from a push: heard once, and the promise rejects', async () => {
    const { router, nav } = await launch();
    await assert.rejects(nav.push('/broken/1'), /Could not load bundle/);
    await idle();
    once();
    assert.deepEqual(reported, [], 'the caller has the rejection; nothing else reports it');
    assert.equal(router.url, '/home');
  });

  it('from a presentation: heard once, and the promise rejects', async () => {
    const { router, nav } = await launch();
    await assert.rejects(nav.present('/broken/1', { as: 'formSheet' }), /Could not load bundle/);
    await idle();
    once();
    assert.deepEqual(reported, [], 'the caller has the rejection; nothing else reports it');
    assert.equal(router.url, '/home');
  });

  it('from a deep link that arrives while the app runs: heard once', async () => {
    const { router } = await launch();
    arrive('/broken/1');
    await idle();
    once();
    reportedOnce();
    assert.equal(router.url, '/home');
  });

  it("lets the handler inject, as the Router page's example does", async () => {
    const failed = signal<string | null>(null);
    const Failed = new InjectionToken<typeof failed>('failed', { factory: () => failed });
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(
          [{ path: 'broken', loadComponent: () => Promise.reject(chunkError()) }],
          withNavigationErrorHandler((error) => inject(Failed).set(error.url)),
        ),
      ],
    });
    await idle();
    const nav = app.componentRef.injector.get(NativeNavigation);
    await assert.rejects(nav.push('/broken'));
    assert.equal(failed(), '/broken');
  });

  it('from a deep link the app launched with: heard once, on its parent', async () => {
    const { router } = await launch('/broken/1');
    once();
    reportedOnce();
    assert.equal(router.url, '/home');
  });
});
