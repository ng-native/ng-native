/**
 * The native stack as an app drives it: the real `Router`, `NativeNavigation` and the stack
 * outlet together, rather than the outlet's contract called by hand.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorHandler, type Type } from '@angular/core';
import { Router, withComponentInputBinding, type Routes } from '@angular/router';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { DeepLinks } from '@ng-native/device';
import { followLink } from '../router/src/native-links.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * Until the stack has caught up with a back: history reports the pop a task later, and the
 * router's navigation and the commit after it take their own.
 */
async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** What each screen in the stack says, bottom first. */
const stack = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .filter((node) => node.viewName === 'RNSScreen')
    .map((screen) =>
      flatten(screen.children)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string')
        .join(' '),
    );

describe('a native stack driven by the router', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;
  let live: Record<string, number>;
  let created: Record<string, number>;
  /** What reached the app's ErrorHandler. */
  let reported: unknown[];

  before(async () => {
    mod = await compileFixture(fileURLToPath(new URL('./fixtures/stack-app.ts', import.meta.url)));
    live = mod['live'] as Record<string, number>;
    created = mod['created'] as Record<string, number>;
  });

  beforeEach(async () => {
    for (const counts of [live, created]) for (const key of Object.keys(counts)) delete counts[key];
    reported = [];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding()),
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => reported.push(error) },
        },
      ],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    await settle();
  });

  afterEach(() => cleanup());

  describe('a dismissal native reports', () => {
    const screens = () => flatten(fabric.committed).filter((node) => node.viewName === 'RNSScreen');

    it('goes back one screen for a swipe back', async () => {
      await nav.push('/user/1');
      await nav.push('/user/2');
      await idle();
      await fireEvent(screens().at(-1)!, 'dismissed', { dismissCount: 1 });
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
    });

    it('goes back as many screens as native dismissed at once, as a long-press on back does', async () => {
      await nav.push('/user/1');
      await nav.push('/user/2');
      await idle();
      await fireEvent(screens().at(-1)!, 'dismissed', { dismissCount: 2 });
      await idle();
      assert.equal(router.url, '/');
      assert.deepEqual(stack(fabric), ['home']);
    });
  });

  /**
   * `RNSScreenStack` refuses a swipe that starts outside the screen's `gestureResponseDistance`,
   * where -1 means no limit. The prop is a struct with no default, so a screen that never sets it
   * gets 0 on every side, and no swipe starts inside that. `Screen.tsx` always sends -1 for an
   * edge not given; the stack does the same.
   */
  describe('the swipe-back area', () => {
    const top = () =>
      flatten(fabric.committed)
        .filter((n) => n.viewName === 'RNSScreen')
        .at(-1)!;

    it('is unlimited on every edge of a pushed screen, as react-native-screens sends it', async () => {
      await nav.push('/user/1');
      await idle();
      assert.deepEqual(top().props['gestureResponseDistance'], {
        start: -1,
        end: -1,
        top: -1,
        bottom: -1,
      });
    });

    it('keeps an edge a screen limits, and leaves the others unlimited', async () => {
      await nav.push('/user/1', { presentation: { gestureResponseDistance: { start: 40 } } });
      await idle();
      assert.deepEqual(top().props['gestureResponseDistance'], {
        start: 40,
        end: -1,
        top: -1,
        bottom: -1,
      });
    });
  });

  describe('the same route with a different parameter', () => {
    it('stacks a second screen, and back returns to the first', async () => {
      await nav.push('/user/1');
      await nav.push('/user/2');
      await settle();
      assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2']);
      assert.equal(created['User'], 2);

      nav.back();
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
      assert.equal(live['User'], 1, 'the screen popped is destroyed');
    });

    it('stacks for a plain router navigation too, as a link or a deep link makes', async () => {
      await router.navigateByUrl('/user/1');
      await router.navigateByUrl('/user/2');
      await router.navigateByUrl('/user/3');
      await settle();
      assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2', 'user 3']);
    });

    it('binds a route parameter over a query parameter of the same name', async () => {
      await nav.push('/user/1', { queryParams: { id: '9' } });
      await idle();
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
    });

    it('updates the screen in place when only the query changes', async () => {
      await nav.push('/user/1');
      await nav.push('/user/1', { queryParams: { tab: 'posts' } });
      await settle();
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
      assert.equal(created['User'], 1);
    });

    it('reads a query and a fragment written into the url string', async () => {
      // A string is a url, as `navigateByUrl` and `popTo` read it, not one path segment.
      assert.equal(await nav.push('/user/1?tab=posts#top'), true);
      await idle();
      assert.equal(router.url, '/user/1?tab=posts#top');
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
    });

    it('updates one screen in place on a route marked with reuseScreen', async () => {
      await nav.push('/photo/1');
      await nav.push('/photo/2');
      await idle();
      assert.deepEqual(stack(fabric), ['home', 'photo 2']);
      assert.equal(created['Photo'], 1);
    });

    it('replaces the screen when asked to, leaving one', async () => {
      await nav.push('/user/1');
      await nav.replace('/user/2');
      await settle();
      assert.deepEqual(stack(fabric), ['home', 'user 2']);
      assert.equal(live['User'], 1);
    });
  });

  describe('a push from a presented screen', () => {
    /** The app stack's own screens, bottom first: what each says, and how it is presented. */
    const appStack = () =>
      fabric.committed[0]!.children[0]!.children.map((screen) => [
        flatten(screen.children)
          .map((node) => node.props['text'])
          .filter((text) => typeof text === 'string')
          .join(' '),
        screen.props['stackPresentation'] ?? 'push',
      ]);

    it('presents the screen the same way over a modal with no stack of its own', async () => {
      // `RNSScreenStack` pushes a push screen that follows a modal onto the navigation controller
      // under the modal, where nobody can see it.
      await nav.present('/modal');
      await nav.push('/user/1');
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(appStack(), [
        ['home', 'push'],
        ['modal', 'modal'],
        ['user 1', 'modal'],
      ]);

      nav.back();
      await idle();
      assert.equal(router.url, '/modal', 'one back closes what the push opened');
      assert.deepEqual(appStack(), [
        ['home', 'push'],
        ['modal', 'modal'],
      ]);
    });

    it('takes the presentation it was given over the one it would inherit', async () => {
      await nav.present('/modal', { as: 'formSheet' });
      await nav.push('/user/1', { presentation: { stackPresentation: 'fullScreenModal' } });
      await idle();
      assert.deepEqual(appStack().at(-1), ['user 1', 'fullScreenModal']);
    });

    it('inherits a sheet the same way, with the rest of the push options kept', async () => {
      await nav.present('/modal', { as: 'formSheet' });
      await nav.push('/user/1', { presentation: { stackAnimation: 'fade' } });
      await idle();
      const top = fabric.committed[0]!.children[0]!.children.at(-1)!;
      assert.equal(top.props['stackPresentation'], 'formSheet');
      assert.equal(top.props['stackAnimation'], 'fade');
    });

    it('pushes inside a presented screen that is a stack of its own', async () => {
      await nav.present('/compose');
      await nav.push('/compose/step');
      await idle();
      assert.deepEqual(appStack(), [
        ['home', 'push'],
        ['start step', 'modal'],
      ]);
      const inner = flatten(fabric.committed[0]!.children[0]!.children[1]!.children).filter(
        (node) => node.viewName === 'RNSScreen',
      );
      assert.deepEqual(
        inner.map((screen) => screen.props['stackPresentation'] ?? 'push'),
        ['push', 'push'],
        'both screens inside it are pushed, not presented again',
      );
    });
  });

  describe('a page that throws on its first render', () => {
    const failed = (url: string, extras?: Parameters<NativeNavigation['push']>[1]) =>
      nav.push(url, extras).then(
        () => assert.fail('the navigation succeeded'),
        (error: unknown) => error,
      );

    it('fails the navigation, leaves nothing behind, and reports the error', async () => {
      await nav.push('/user/1');
      const error = await failed('/broken');
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(stack(fabric), ['home', 'user 1'], 'no half-made screen on the stack');
      assert.equal(live['Broken'], 0, 'and no component left running');
      assert.deepEqual(reported, [error]);
    });

    it('leaves the screen it was pushed from running, and the stack still works', async () => {
      await nav.push('/user/1');
      for (let attempt = 0; attempt < 3; attempt++) await failed('/broken');
      await idle();
      assert.equal(live['Broken'], 0);

      await nav.push('/user/2');
      await idle();
      assert.deepEqual(stack(fabric), ['home', 'user 1', 'user 2']);
      nav.back();
      await idle();
      assert.equal(router.url, '/user/1');
      nav.back();
      await idle();
      assert.equal(router.url, '/');
      assert.deepEqual(stack(fabric), ['home']);
    });

    it('keeps every screen a reset would have emptied the stack of', async () => {
      await nav.push('/user/1');
      await nav.reset('/broken').catch(() => false);
      await idle();
      assert.deepEqual(stack(fabric), ['home', 'user 1']);

      await nav.reset('/user/2');
      await idle();
      assert.deepEqual(stack(fabric), ['user 2'], 'and a reset that works still empties it');
    });

    it('keeps the screen a replace would have superseded', async () => {
      await nav.push('/user/1');
      await nav.replace('/broken').catch(() => false);
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
      assert.equal(live['User'], 1);
    });

    it('takes down the stack around it when it is the first screen of one', async () => {
      await nav.push('/user/1');
      await failed('/broken-stack');
      await idle();
      assert.equal(router.url, '/user/1');
      assert.deepEqual(stack(fabric), ['home', 'user 1']);
      assert.equal(live['BrokenStack'], 0);
      assert.equal(live['Broken'], 0);
    });

    it('leaves nothing of it in a tab either, and the tab showing stays', async () => {
      await router.navigateByUrl('/tabs/fine');
      const error = await router.navigateByUrl('/tabs/broken').then(
        () => assert.fail('the navigation succeeded'),
        (failure: unknown) => failure,
      );
      await idle();
      assert.equal(router.url, '/tabs/fine');
      assert.equal(live['Broken'], 0);
      const paragraphs = flatten(fabric.committed)
        .filter((node) => node.viewName === 'Paragraph')
        .map((node) => flatten(node.children).map((run) => run.props['text'] ?? ''));
      assert.deepEqual(paragraphs, [['home'], ['fine']], 'no empty page left in the broken tab');
      assert.deepEqual(reported, [error]);
    });
  });
});

describe('a deep link opened beneath its parent screen', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let nav: NativeNavigation;
  let fabric: FakeFabric;
  let arrive: (url: string) => void;

  before(async () => {
    mod = await compileFixture(fileURLToPath(new URL('./fixtures/stack-app.ts', import.meta.url)));
  });

  async function launch(initial: string | null, parented = true) {
    const links = {
      initialUrl: () => initial,
      subscribe: (listener: (url: string) => void) => ((arrive = listener), () => {}),
    };
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(
          mod['routes'] as Routes,
          withComponentInputBinding(),
          ...(parented ? [withLinkParent((url) => (url.startsWith('/user/') ? '/' : null))] : []),
        ),
        { provide: DeepLinks, useValue: links },
      ],
    });
    fabric = app.fabric;
    router = app.componentRef.injector.get(Router);
    nav = app.componentRef.injector.get(NativeNavigation);
    await idle();
  }

  afterEach(() => cleanup());

  it('launches on the parent with the linked screen pushed over it', async () => {
    await launch('/user/7');
    assert.equal(router.url, '/user/7');
    assert.deepEqual(stack(fabric), ['home', 'user 7']);
  });

  it('opens the linked screen once, and lets the app navigate away from it', async () => {
    await launch('/user/7');
    await nav.push('/modal');
    await idle();
    assert.equal(router.url, '/modal');
  });

  it('launches on the linked screen alone without withLinkParent, as the Screens page says', async () => {
    await launch('/user/7', false);
    assert.equal(router.url, '/user/7');
    assert.deepEqual(stack(fabric), ['user 7'], 'no screen under it to go back to');
  });

  it('launches on a link alone when withLinkParent names no parent for it', async () => {
    await launch('/modal');
    assert.equal(router.url, '/modal');
    assert.equal(stack(fabric).length, 1, 'no screen under it');
  });

  it('follows a link called directly, as the Testing the router page shows', async () => {
    await launch(null);
    await followLink(router, '/user/7', (url) => (url.startsWith('/user/') ? '/' : null));
    await idle();
    assert.equal(router.url, '/user/7');
    assert.deepEqual(stack(fabric), ['home', 'user 7']);
  });

  it('follows a link that arrives while the app is running', async () => {
    await launch(null);
    arrive('/user/9');
    await idle();
    assert.equal(router.url, '/user/9');
    assert.deepEqual(stack(fabric), ['home', 'user 9']);
  });
});
