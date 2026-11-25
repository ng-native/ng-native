/**
 * A page in a form sheet on Android. react-native-screens presents the sheet with Material's
 * `BottomSheetBehavior`, which only hands a drag to a scrolling child that has nested scrolling
 * on, and pads a header's toolbar by the status bar's height wherever the toolbar sits. A sheet
 * never reaches the status bar, so both defaults change for whatever is on one.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import {
  cleanup,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
  type TestOs,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const all = (fabric: FakeFabric, test: (node: FakeFabricNode) => boolean) =>
  flatten(fabric.committed).filter(test);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/form-sheet-stack.ts');
});
afterEach(cleanup);

async function open(platform: TestOs, how: (navigation: NativeNavigation) => Promise<unknown>) {
  registerScreenComponents();
  const app = await render(mod['SheetShell'] as Type<unknown>, {
    os: platform,
    providers: [provideNativeRouter(mod['sheetRoutes'] as Routes)],
  });
  await settle();
  await how(app.componentRef.injector.get(NativeNavigation));
  await settle();
  const { fabric } = app;
  return {
    headers: all(fabric, (node) => node.viewName === 'RNSScreenStackHeaderConfig'),
    scroll: all(fabric, (node) => node.props['nativeID'] === 'scroll'),
    list: all(fabric, (node) => node.props['nativeID'] === 'list'),
  };
}

const sheet = (navigation: NativeNavigation) =>
  navigation.present('/sheet', { as: 'formSheet', presentation: { sheetAllowedDetents: [1] } });

describe('a page in a form sheet on Android', () => {
  after(() => {
    registerPlatformComponents('ios');
    for (const [element, viewName] of Object.entries({
      switch: 'Switch',
      'text-input': 'TextInput',
      'activity-indicator': 'ActivityIndicatorView',
      'refresh-control': 'PullToRefreshView',
      'safe-area-view': 'SafeAreaView',
      'input-accessory-view': 'InputAccessoryView',
    })) {
      registerViewName(element, viewName);
    }
  });

  it('turns nested scrolling on, so the sheet hands a drag to the scroll view first', async () => {
    const { scroll, list } = await open('android', sheet);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'], true);
    assert.equal(list.at(-1)?.props['nestedScrollEnabled'], true);
  });

  it('does not pad the header by the status bar', async () => {
    const { headers } = await open('android', sheet);
    assert.equal(headers.at(-1)?.props['consumeTopInset'], false);
  });

  it('keeps the defaults on a page pushed in the stack in the sheet', async () => {
    const { headers, scroll } = await open('android', async (n) => {
      await sheet(n);
      await n.push('/sheet/page');
    });
    assert.equal(headers.at(-1)?.props['consumeTopInset'], false);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'], true);
  });

  it('does not carry the sheet to a modal presented from inside it', async () => {
    const { headers, scroll } = await open('android', async (n) => {
      await sheet(n);
      await n.present('/sheet/page', { as: 'fullScreenModal' });
    });
    assert.equal(headers.at(-1)?.props['consumeTopInset'], true);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'] ?? null, null);
  });

  it('keeps a pushed page as it was', async () => {
    const { headers, scroll, list } = await open('android', (n) => n.push('/page'));
    assert.equal(headers.at(-1)?.props['consumeTopInset'], true);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'] ?? null, null);
    assert.equal(list.at(-1)?.props['nestedScrollEnabled'] ?? null, null);
  });

  it('keeps a page presented as a modal as it was', async () => {
    const { headers, scroll } = await open('android', (n) => n.present('/page', { as: 'modal' }));
    assert.equal(headers.at(-1)?.props['consumeTopInset'], true);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'] ?? null, null);
  });

  it('leaves iOS alone', async () => {
    const { headers, scroll } = await open('ios', sheet);
    assert.equal(headers.at(-1)?.props['consumeTopInset'], false);
    assert.equal(scroll.at(-1)?.props['nestedScrollEnabled'] ?? null, null);
    const pushed = await open('ios', (n) => n.push('/page'));
    assert.equal(pushed.headers.at(-1)?.props['consumeTopInset'], false);
  });
});
