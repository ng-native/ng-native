import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Type } from '@angular/core';
import { withComponentInputBinding, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { StatusBar } from '@ng-native/device';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { SCREEN_STATUS_BAR, screenStatusBarProps } from '../router/src/screen-status-bar.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('the status bar on screens', () => {
  it("spells each style the way react-native-screens' own prop does", () => {
    assert.deepEqual(screenStatusBarProps({ style: 'light' }), {
      statusBarStyle: 'light',
      statusBarHidden: undefined,
      statusBarAnimation: undefined,
    });
    assert.equal(screenStatusBarProps({ style: 'default' }).statusBarStyle, 'auto');
    assert.deepEqual(screenStatusBarProps({ hidden: true, animated: true }), {
      statusBarStyle: undefined,
      statusBarHidden: true,
      statusBarAnimation: 'fade',
    });
  });

  describe('in a stack', () => {
    let mod: Record<string, unknown>;
    let fabric: FakeFabric;
    let bar: StatusBar;
    let nav: NativeNavigation;
    const screens = () => flatten(fabric.committed).filter((node) => node.viewName === 'RNSScreen');

    before(async () => {
      mod = await compileFixture(
        fileURLToPath(new URL('./fixtures/stack-app.ts', import.meta.url)),
      );
    });

    beforeEach(async () => {
      const app = await render(mod['Shell'] as Type<unknown>, {
        providers: [
          provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding()),
          { provide: SCREEN_STATUS_BAR, useValue: true },
        ],
      });
      fabric = app.fabric;
      bar = app.componentRef.injector.get(StatusBar);
      nav = app.componentRef.injector.get(NativeNavigation);
      await settle();
    });

    afterEach(() => cleanup());

    it('puts what the app asked for on every screen, where iOS 27 reads it', async () => {
      bar.set({ style: 'light' });
      await settle();
      assert.ok(screens().length > 0);
      for (const screen of screens()) assert.equal(screen.props['statusBarStyle'], 'light');
    });

    it('gives a screen pushed later the style already asked for', async () => {
      bar.set({ style: 'light' });
      await settle();
      await nav.push('/user/1');
      await settle();
      assert.equal(screens().at(-1)!.props['statusBarStyle'], 'light');
    });

    it('puts the base style back on the screens when a claim is dropped', async () => {
      bar.set({ style: 'dark' });
      const drop = bar.push({ style: 'light', hidden: true });
      await settle();
      assert.equal(screens()[0]!.props['statusBarHidden'], true);

      drop();
      await settle();
      assert.equal(screens()[0]!.props['statusBarStyle'], 'dark');
    });
  });
});
