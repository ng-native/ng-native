/**
 * A refresh control already refreshing when its screen mounts. On iOS native begins it at once,
 * before UIKit has laid the screen out under its bars, and under a large title that leaves a gap
 * the spinner's height above the content, which stays after the spinner stops and shows on
 * screens shown after it. So the control commits `refreshing` once the screen it is on has
 * appeared: a stack's screen on `appear`, a tab's on `didAppear`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import {
  cleanup,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
  type RenderResult,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

type Page = 'home' | 'library' | 'detail' | 'plain';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

let mod: Record<string, unknown>;
let loading: Record<Page, WritableSignal<boolean>>;

before(async () => {
  registerScreenComponents();
  mod = await compileFixture('fixtures/refresh-on-appear.ts');
  loading = mod['loading'] as typeof loading;
});

beforeEach(() => {
  for (const page of Object.values(loading)) page.set(true);
  (mod['libraryTab'] as WritableSignal<boolean>).set(true);
});

afterEach(() => cleanup());

/** The refresh control a page committed, by its `nativeID`. */
function control(fabric: FakeFabric, page: Page): FakeFabricNode {
  const found = flatten(fabric.committed).filter((node) => node.props['nativeID'] === page);
  assert.equal(found.length, 1, `one ${page} control`);
  return found[0]!;
}

/** The nearest node above the control with one of these view names. */
function above(fabric: FakeFabric, page: Page, viewNames: readonly string[]): FakeFabricNode {
  const path = (nodes: FakeFabricNode[], target: FakeFabricNode): FakeFabricNode[] | null => {
    for (const node of nodes) {
      if (node === target) return [node];
      const rest = path(node.children, target);
      if (rest) return [node, ...rest];
    }
    return null;
  };
  const chain = path(fabric.committed, control(fabric, page))!;
  const found = chain.reverse().find((node) => viewNames.includes(node.viewName));
  assert.ok(found, `a ${viewNames.join(' or ')} above ${page}`);
  return found;
}

const screenOf = (fabric: FakeFabric, page: Page) => above(fabric, page, ['RNSScreen']);
const tabOf = (fabric: FakeFabric, page: Page) =>
  above(fabric, page, ['RNSTabsScreenIOS', 'RNSTabsScreenAndroid']);

async function emit(fabric: FakeFabric, node: FakeFabricNode, type: string): Promise<void> {
  fabric.emit(node, type, { target: node.reactTag });
  await settle();
}

async function boot(
  rootAppears = true,
): Promise<{ app: RenderResult<unknown>; navigation: NativeNavigation }> {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  await settle();
  // The tabs page, the root stack's first screen, appears as the app launches.
  const root = flatten(app.fabric.committed).find((node) => node.viewName === 'RNSScreen')!;
  if (rootAppears) await emit(app.fabric, root, 'topAppear');
  return { app, navigation: app.componentRef.injector.get(NativeNavigation) };
}

describe('a refresh control refreshing as its screen mounts, on iOS', () => {
  it('begins on a pushed page once its screen has appeared, not before', async () => {
    const { app, navigation } = await boot();
    await navigation.push(['/detail']);
    await settle();
    const fabric = app.fabric;

    assert.equal(control(fabric, 'detail').props['refreshing'], false, 'held while it pushes');
    await emit(fabric, screenOf(fabric, 'detail'), 'topWillAppear');
    assert.equal(control(fabric, 'detail').props['refreshing'], false, 'still laying out');
    await emit(fabric, screenOf(fabric, 'detail'), 'topAppear');
    assert.equal(control(fabric, 'detail').props['refreshing'], true, 'shown');

    loading.detail.set(false);
    await settle();
    assert.equal(control(fabric, 'detail').props['refreshing'], false, 'and stops when told');
  });

  it('follows refreshing at once on a screen that has appeared', async () => {
    loading.detail.set(false);
    const { app, navigation } = await boot();
    await navigation.push(['/detail']);
    await settle();
    const fabric = app.fabric;
    await emit(fabric, screenOf(fabric, 'detail'), 'topAppear');

    loading.detail.set(true);
    await settle();
    assert.equal(control(fabric, 'detail').props['refreshing'], true);
  });

  it('begins on a tab shown for the first time once the tab has appeared', async () => {
    const { app, navigation } = await boot();
    await app.componentRef.injector.get(Router).navigateByUrl('/library');
    await settle();
    const fabric = app.fabric;

    assert.equal(control(fabric, 'library').props['refreshing'], false, 'held');
    await emit(fabric, tabOf(fabric, 'library'), 'topWillAppear');
    assert.equal(control(fabric, 'library').props['refreshing'], false, 'still laying out');
    await emit(fabric, tabOf(fabric, 'library'), 'topDidAppear');
    assert.equal(control(fabric, 'library').props['refreshing'], true, 'shown');
  });

  it('waits for both the tab and the screen of the stack inside it', async () => {
    const { app } = await boot();
    const fabric = app.fabric;

    await emit(fabric, screenOf(fabric, 'home'), 'topAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], false, 'its tab not yet shown');
    await emit(fabric, tabOf(fabric, 'home'), 'topDidAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], true, 'both shown');
  });

  it('waits for the screen of the stack inside a tab that has appeared', async () => {
    const { app } = await boot();
    const fabric = app.fabric;

    await emit(fabric, tabOf(fabric, 'home'), 'topDidAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], false, 'its screen not yet shown');
    await emit(fabric, screenOf(fabric, 'home'), 'topAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], true, 'both shown');
  });

  it('waits for the screen the tabs are on as well as the tab', async () => {
    const { app } = await boot(false);
    const fabric = app.fabric;

    await emit(fabric, tabOf(fabric, 'home'), 'topDidAppear');
    await emit(fabric, screenOf(fabric, 'home'), 'topAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], false, 'the tabs page not yet shown');
    const root = flatten(fabric.committed).find((node) => node.viewName === 'RNSScreen')!;
    await emit(fabric, root, 'topAppear');
    assert.equal(control(fabric, 'home').props['refreshing'], true, 'all three shown');
  });

  it('hears a tab that an @if took away and brought back before it was shown', async () => {
    const { app } = await boot();
    const libraryTab = mod['libraryTab'] as WritableSignal<boolean>;
    libraryTab.set(false);
    await settle();
    libraryTab.set(true);
    await settle();
    await app.componentRef.injector.get(Router).navigateByUrl('/library');
    await settle();
    const fabric = app.fabric;

    await emit(fabric, tabOf(fabric, 'library'), 'topDidAppear');
    assert.equal(control(fabric, 'library').props['refreshing'], true);
  });

  it('begins at once on a view no outlet shows', async () => {
    const { fabric } = await render(mod['Plain'] as Type<unknown>);
    assert.equal(control(fabric, 'plain').props['refreshing'], true);
  });
});

describe('a refresh control refreshing as its screen mounts, on Android', () => {
  before(() => {
    registerPlatformComponents('android');
    registerScreenComponents();
  });
  after(() => {
    registerPlatformComponents('ios');
    registerScreenComponents();
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

  it('begins at once, where the swipe layout has no such gap', async () => {
    const { app, navigation } = await boot();
    await navigation.push(['/detail']);
    await settle();
    assert.equal(control(app.fabric, 'detail').props['refreshing'], true);
  });
});
