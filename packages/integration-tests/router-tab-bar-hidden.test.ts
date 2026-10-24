/**
 * `<native-header tabBarHidden>`: a page pushed in a tab's stack hides the tab bar while it is the
 * page in front, as UIKit's `hidesBottomBarWhenPushed` does.
 *
 * react-native-screens hides the bar only on the tabs host, so the header asks the tab it is in,
 * and the outlet commits `tabBarHidden` while a page in front of the tab in front asks.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** The `tabBarHidden` the tabs host last committed. */
function barHidden(fabric: FakeFabric): unknown {
  const hosts = flatten(fabric.committed).filter(
    (node) => node.viewName === 'RNSTabsHostIOS' || node.viewName === 'RNSTabsHostAndroid',
  );
  assert.equal(hosts.length, 1, 'one tabs host');
  return hosts[0]!.props['tabBarHidden'];
}

interface State {
  barHidden: WritableSignal<boolean | undefined>;
  detailHides: WritableSignal<boolean>;
  detailHasHeader: WritableSignal<boolean>;
  libraryHides: WritableSignal<boolean>;
}

let mod: Record<string, unknown>;
let state: State;

before(async () => {
  mod = await compileFixture('fixtures/tab-bar-hidden.ts');
  state = mod['state'] as State;
});

beforeEach(() => {
  state.barHidden.set(undefined);
  state.detailHides.set(true);
  state.detailHasHeader.set(true);
  state.libraryHides.set(false);
});

afterEach(() => cleanup());

async function boot() {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const navigation = app.componentRef.injector.get(NativeNavigation);
  assert.equal(router.url, '/home');
  return { fabric: app.fabric, router, navigation };
}

async function pushDetail(navigation: NativeNavigation) {
  await navigation.push('/home/1');
  await settle();
}

describe('<native-header tabBarHidden>', () => {
  it('leaves the bar showing on a page that does not ask', async () => {
    const { fabric } = await boot();
    assert.equal(barHidden(fabric), false);
  });

  it('hides the bar while the pushed page is in front, and shows it again on the pop', async () => {
    const { fabric, router, navigation } = await boot();
    await pushDetail(navigation);
    assert.equal(router.url, '/home/1');
    assert.equal(barHidden(fabric), true);

    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/home');
    assert.equal(barHidden(fabric), false, 'the request went with the popped page');
  });

  it('shows the bar while a page that does not ask is pushed over the one that does', async () => {
    const { fabric, router, navigation } = await boot();
    await pushDetail(navigation);
    await navigation.push('/home/1/more');
    await settle();
    assert.equal(router.url, '/home/1/more');
    assert.equal(barHidden(fabric), false, 'the detail is behind');

    navigation.back();
    await settle();
    await settle();
    assert.equal(router.url, '/home/1');
    assert.equal(barHidden(fabric), true, 'and in front again');
  });

  it('follows the input changing in both directions', async () => {
    const { fabric, navigation } = await boot();
    await pushDetail(navigation);
    state.detailHides.set(false);
    await settle();
    assert.equal(barHidden(fabric), false);
    state.detailHides.set(true);
    await settle();
    assert.equal(barHidden(fabric), true);
  });

  it('withdraws the request when the header is destroyed with its page still in front', async () => {
    const { fabric, navigation } = await boot();
    await pushDetail(navigation);
    assert.equal(barHidden(fabric), true);
    state.detailHasHeader.set(false);
    await settle();
    assert.equal(barHidden(fabric), false);
    state.detailHasHeader.set(true);
    await settle();
    assert.equal(barHidden(fabric), true, 'and a new header asks again');
  });

  it('shows the bar on another tab, and hides it again on the way back', async () => {
    const { fabric, router, navigation } = await boot();
    await pushDetail(navigation);
    await router.navigateByUrl('/library');
    await settle();
    assert.equal(barHidden(fabric), false, 'the library tab does not ask');

    await router.navigateByUrl('/home/1');
    await settle();
    assert.equal(router.url, '/home/1');
    assert.equal(barHidden(fabric), true);
  });

  it('hides the bar from the page of a tab with no stack, while that tab is in front', async () => {
    state.libraryHides.set(true);
    const { fabric, router } = await boot();
    assert.equal(barHidden(fabric), false, 'the library tab has not been opened');
    await router.navigateByUrl('/library');
    await settle();
    assert.equal(barHidden(fabric), true);
    await router.navigateByUrl('/home');
    await settle();
    assert.equal(barHidden(fabric), false, 'the library page is behind');
  });

  it('lets the outlet’s own [barHidden] win, whichever way it says', async () => {
    const { fabric, navigation } = await boot();
    await pushDetail(navigation);
    state.barHidden.set(false);
    await settle();
    assert.equal(barHidden(fabric), false, 'false keeps the bar over a page that asks');

    state.detailHides.set(false);
    state.barHidden.set(true);
    await settle();
    assert.equal(barHidden(fabric), true, 'true hides it under a page that does not');

    state.barHidden.set(undefined);
    await settle();
    assert.equal(barHidden(fabric), false, 'and unset hands it back to the page');
  });

  it('does nothing in a header outside any tab', async () => {
    const { fabric, router, navigation } = await boot();
    await navigation.push('/outside');
    await settle();
    assert.equal(router.url, '/outside');
    assert.equal(barHidden(fabric), false);
  });
});
