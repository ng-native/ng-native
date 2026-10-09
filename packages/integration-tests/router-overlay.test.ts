/**
 * Something drawn above every screen, sheets and modals included: a toast, a banner, a loading
 * cover. A native modal or sheet is presented above the app's root view, so a view there cannot
 * cover one; react-native-screens' `RNSFullWindowOverlay` is a window of its own above them, and
 * lets touches through where it has nothing.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Screen } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

let Overlaid: Type<{ shown: { set(value: boolean): void } }>;
before(async () => {
  const mod = await compileFixture('fixtures/full-window-overlay.ts');
  Overlaid = mod['Overlaid'] as typeof Overlaid;
});

describe('a full-window overlay', () => {
  it('commits as a window of its own on iOS, filling the window, with its content in it', async () => {
    registerScreenComponents();
    const { fabric, componentRef } = await render(Overlaid);
    const overlay = flatten(fabric.committed).find((n) => n.viewName === 'RNSFullWindowOverlay');
    assert.ok(overlay, 'the overlay view');
    const size = componentRef.injector.get(Screen).window();
    assert.equal(overlay.props['position'], 'absolute');
    assert.equal(overlay.props['width'], size.width);
    assert.equal(overlay.props['height'], size.height);
    assert.ok(flatten([overlay]).some((n) => n.props['nativeID'] === 'toast'));
    assert.equal(overlay.props['accessibilityContainerViewIsModal'], true, 'a bare modal is true');
    cleanup();
  });

  it('comes and goes with its content', async () => {
    registerScreenComponents();
    const { fabric, instance } = await render(Overlaid);
    instance.shown.set(false);
    await settle();
    assert.ok(!flatten(fabric.committed).some((n) => n.viewName === 'RNSFullWindowOverlay'));
    cleanup();
  });

  describe('on Android', () => {
    before(() => registerPlatformComponents('android'));
    after(() => {
      registerPlatformComponents('ios');
      registerScreenComponents();
    });

    it('is a plain view filling the window, since nothing there presents above the root', async () => {
      registerScreenComponents();
      const { fabric } = await render(Overlaid);
      const toast = flatten(fabric.committed).find((n) => n.props['nativeID'] === 'toast')!;
      const overlay = flatten(fabric.committed).find((n) => n.children.includes(toast))!;
      assert.equal(overlay.viewName, 'RCTView');
      assert.equal(overlay.props['position'], 'absolute');
      cleanup();
    });
  });
});
