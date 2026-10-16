/**
 * The app's status bar claim on Android, where react-native-screens sets the bar again each time
 * a screen appears: from the screen's own `statusBarStyle` and `statusBarHidden`, or, with none,
 * to light text and shown. So the claim rides on every screen without its own, and a screen that
 * has its own keeps it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { ColorScheme, StatusBar, type Scheme, type StatusBarSource } from '@ng-native/device';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

const quiet = { setStyle() {}, setHidden() {}, setBackgroundColor() {}, setTranslucent() {} };

describe("the app's status bar claim on each screen", () => {
  let mod: Record<string, unknown>;
  let fabric: FakeFabric;
  let bar: StatusBar;
  let nav: NativeNavigation;
  let router: Router;
  let switchTo: (scheme: Scheme) => Promise<void>;

  /** The committed status bar props of each screen in the stack, bottom first. */
  const screens = () =>
    flatten(fabric.committed)
      .filter((node) => node.viewName === 'RNSScreen')
      .map((node) => ({
        style: node.props['statusBarStyle'] ?? undefined,
        hidden: node.props['statusBarHidden'] ?? undefined,
      }));

  const boot = async (screensSetBar: boolean, fixture = mod) => {
    let scheme: Scheme = 'light';
    const listeners = new Set<(scheme: Scheme) => void>();
    const source: StatusBarSource = { ...quiet, height: undefined, screensSetBar };
    const app = await render(fixture['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(fixture['routes'] as Routes),
        { provide: StatusBar.SOURCE, useValue: source },
        {
          provide: ColorScheme.SOURCE,
          useValue: {
            current: () => scheme,
            subscribe: (listener: (next: Scheme) => void) => (
              listeners.add(listener),
              () => listeners.delete(listener)
            ),
          },
        },
      ],
    });
    switchTo = async (next) => {
      scheme = next;
      listeners.forEach((listener) => listener(next));
      await idle();
    };
    fabric = app.fabric;
    bar = app.componentRef.injector.get(StatusBar);
    nav = app.componentRef.injector.get(NativeNavigation);
    router = app.componentRef.injector.get(Router);
    await idle();
  };

  before(async () => {
    mod = await compileFixture('fixtures/status-bar-screens.ts');
  });

  afterEach(() => cleanup());

  describe('on Android', () => {
    beforeEach(() => boot(true));

    it("puts the app's style back on the screen in front after a light screen pops", async () => {
      bar.set({ style: 'auto' });
      await nav.push('/photo', { presentation: { statusBarStyle: 'light' } });
      await idle();
      assert.deepEqual(
        screens().map((one) => one.style),
        ['dark', 'light'],
        'the pushed screen keeps its own style',
      );

      nav.back();
      await idle();
      assert.equal(router.url, '/');
      assert.deepEqual(
        screens().map((one) => one.style),
        ['dark'],
      );
      await nav.push('/list');
      await idle();
      assert.deepEqual(
        screens().map((one) => one.style),
        ['dark', 'dark'],
        'a screen with no style of its own carries the claim, not the light fallback',
      );
    });

    it('keeps a hidden claim on every screen without its own', async () => {
      const show = bar.push({ hidden: true });
      await nav.push('/list');
      await idle();
      assert.deepEqual(
        screens().map((one) => one.hidden),
        [true, true],
      );

      show();
      await idle();
      assert.deepEqual(
        screens().map((one) => one.hidden),
        [undefined, undefined],
        'dropping the claim takes it off every screen',
      );
    });

    it('follows the claim as it changes and drops it when it goes', async () => {
      bar.set({ style: 'auto' });
      await nav.push('/list');
      await idle();
      const claim = bar.push({ style: 'light' });
      await idle();
      assert.deepEqual(
        screens().map((one) => one.style),
        ['light', 'light'],
      );

      claim();
      await idle();
      await switchTo('dark');
      assert.deepEqual(
        screens().map((one) => one.style),
        ['light', 'light'],
        "an 'auto' claim follows the color scheme",
      );

      bar.set({});
      await idle();
      assert.deepEqual(
        screens().map((one) => one.style),
        [undefined, undefined],
      );
    });

    it("leaves a page's own host bindings alone", async () => {
      bar.set({ style: 'auto', hidden: false });
      await nav.push('/video');
      await idle();
      assert.deepEqual(screens().at(-1), { style: 'light', hidden: true });

      bar.set({ style: 'light', hidden: false });
      await idle();
      bar.set({ style: 'dark', hidden: false });
      await idle();
      assert.deepEqual(screens(), [
        { style: 'dark', hidden: false },
        { style: 'light', hidden: true },
      ]);
    });

    it('puts the claim back on a screen whose page lets go of its own style', async () => {
      const own = mod['ownStyle'] as WritableSignal<string | undefined>;
      own.set('light');
      bar.set({ style: 'auto' });
      await nav.push('/own');
      await idle();
      assert.equal(screens().at(-1)!.style, 'light');

      own.set(undefined);
      await idle();
      assert.equal(screens().at(-1)!.style, 'dark', 'the claim, not the light fallback');
    });

    it("keeps a page's own style that matches the claim when the claim changes", async () => {
      bar.set({ style: 'auto' });
      await nav.push('/reader');
      await idle();
      assert.equal(screens().at(-1)!.style, 'dark');

      bar.set({ style: 'light' });
      await idle();
      assert.deepEqual(
        screens().map((one) => one.style),
        ['light', 'dark'],
        'the claim moves, the page keeps its own',
      );
    });

    describe("a page's own values that it binds while they match the claim", () => {
      let style: WritableSignal<string | null | undefined>;
      let hidden: WritableSignal<boolean | null | undefined>;
      beforeEach(async () => {
        style = mod['ownStatusBarStyle'] as WritableSignal<string | null | undefined>;
        hidden = mod['ownStatusBarHidden'] as WritableSignal<boolean | null | undefined>;
        bar.set({ style: 'light', hidden: true });
        await nav.push('/own-status-bar');
        await idle();
        assert.deepEqual(
          screens(),
          [
            { style: 'light', hidden: true },
            { style: 'light', hidden: true },
          ],
          'the page has none of its own yet',
        );
        style.set('light');
        hidden.set(true);
        await idle();
      });
      afterEach(() => {
        style.set(undefined);
        hidden.set(undefined);
      });

      it('stay when the claim drops', async () => {
        bar.set({});
        await idle();
        assert.deepEqual(screens(), [
          { style: undefined, hidden: undefined },
          { style: 'light', hidden: true },
        ]);
      });

      it('stay when the claim changes, and give way to it once the page lets go', async () => {
        bar.set({ style: 'dark', hidden: false });
        await idle();
        assert.deepEqual(screens(), [
          { style: 'dark', hidden: false },
          { style: 'light', hidden: true },
        ]);

        style.set(undefined);
        hidden.set(undefined);
        await idle();
        assert.deepEqual(
          screens().at(-1),
          { style: 'dark', hidden: false },
          'a page that lets go carries the claim',
        );
      });

      it('give way to the claim once the page binds null', async () => {
        bar.set({ style: 'dark', hidden: false });
        await idle();
        style.set(null);
        hidden.set(null);
        await idle();
        assert.deepEqual(screens(), [
          { style: 'dark', hidden: false },
          { style: 'dark', hidden: false },
        ]);
      });
    });
  });

  it("follows the claim on another tab's page presented over the tab bar", async () => {
    await boot(true, await compileFixture('fixtures/presented-front.ts'));
    bar.set({ style: 'auto' });
    await nav.present('/library/7', { as: 'formSheet' });
    await idle();
    assert.equal(screens().at(-1)!.style, 'dark');

    bar.set({ style: 'light' });
    await idle();
    assert.equal(screens().at(-1)!.style, 'light', 'the presented page follows the claim');
  });

  it('puts nothing on a screen where screens leave the bar alone', async () => {
    await boot(false);
    bar.set({ style: 'dark', hidden: true });
    await nav.push('/list');
    await idle();
    assert.deepEqual(screens(), [
      { style: undefined, hidden: undefined },
      { style: undefined, hidden: undefined },
    ]);
  });
});
