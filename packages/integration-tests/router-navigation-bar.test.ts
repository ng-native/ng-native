/**
 * The app's navigation bar claim on Android, where react-native-screens shows or hides the bar each
 * time a screen appears, from that screen's own `navigationBarHidden`, once any screen has said
 * which. So a hidden claim rides on every screen without its own, and a screen that has its own
 * keeps it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { NavigationBar, type NavigationBarSource } from '@ng-native/device';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const quiet = (screensSetBar: boolean): NavigationBarSource => ({
  setStyle() {},
  setHidden() {},
  screensSetBar,
});

describe("the app's navigation bar claim on each screen", () => {
  let mod: Record<string, unknown>;
  before(async () => {
    mod = await compileFixture('fixtures/status-bar-screens.ts');
  });
  afterEach(() => cleanup());

  const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const idle = async () => {
    for (let turn = 0; turn < 5; turn++) await settle();
  };

  async function boot(screensSetBar: boolean) {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes),
        { provide: NavigationBar.SOURCE, useValue: quiet(screensSetBar) },
      ],
    });
    await idle();
    const hidden = () =>
      flatten(app.fabric.committed)
        .filter((node) => node.viewName === 'RNSScreen')
        .map((node) => node.props['navigationBarHidden'] ?? undefined);
    return {
      hidden,
      bar: app.componentRef.injector.get(NavigationBar),
      nav: app.componentRef.injector.get(NativeNavigation),
      router: app.componentRef.injector.get(Router),
    };
  }

  it('keeps a hidden claim on every screen without its own, and takes it off when it drops', async () => {
    const { hidden, bar, nav } = await boot(true);
    const show = bar.push({ hidden: true });
    await nav.push('/list');
    await idle();
    assert.deepEqual(hidden(), [true, true]);

    show();
    await idle();
    assert.deepEqual(hidden(), [undefined, undefined]);
  });

  it("leaves a screen's own navigationBarHidden alone, and the claim survives its pop", async () => {
    const { hidden, bar, nav, router } = await boot(true);
    bar.set({ hidden: true });
    await nav.push('/list', { presentation: { navigationBarHidden: false } });
    await idle();
    assert.deepEqual(hidden(), [true, false]);

    nav.back();
    await idle();
    assert.equal(router.url, '/');
    await nav.push('/list');
    await idle();
    assert.deepEqual(hidden(), [true, true], 'a screen with none of its own carries the claim');
  });

  it('puts nothing on a screen where screens leave the bar alone', async () => {
    const { hidden, bar, nav } = await boot(false);
    bar.set({ hidden: true });
    await nav.push('/list');
    await idle();
    assert.deepEqual(hidden(), [undefined, undefined]);
  });
});
