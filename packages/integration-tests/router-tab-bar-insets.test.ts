/**
 * `TabBarInsets.bottom`: what the tab bar covers of the window now, for an overlay outside the
 * tabs. On iOS each tab reads a probe `RNSSafeAreaView` after its page. On Android the bar is read
 * through `TabBarModule` in `@ng-native/expo`, and no probe goes in, since a second safe area view
 * takes the container's one insets listener from the app's own.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { ErrorHandler, type Provider, type Type, type WritableSignal } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { SafeArea } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { nativeTabBar, TabBarInsets } from '../router/src/tab-bar-insets.ts';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const tabScreens = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName.startsWith('RNSTabsScreen'));

const hosts = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName.startsWith('RNSTabsHost'));

const isProbe = (node: FakeFabricNode) => node.children[0]?.viewName === 'RNSSafeAreaView';

/** The probe of the tab whose screen key holds `key`. */
function probeOf(fabric: FakeFabric, key: string): FakeFabricNode {
  const screen = tabScreens(fabric).find((node) => String(node.props['screenKey']).includes(key));
  assert.ok(screen, `a tab screen for ${key}`);
  const probe = screen.children.find(isProbe);
  assert.ok(probe, `a probe in ${key}`);
  return probe;
}

interface State {
  barHidden: WritableSignal<boolean | undefined>;
  showsLibrary: WritableSignal<boolean>;
  showsOutlet: WritableSignal<boolean>;
}

let mod: Record<string, unknown>;
let state: State;

before(async () => {
  mod = await compileFixture('fixtures/tab-bar-insets.ts');
  state = mod['state'] as State;
});

beforeEach(() => {
  state.barHidden.set(undefined);
  state.showsLibrary.set(true);
  state.showsOutlet.set(true);
});

afterEach(() => cleanup());

async function boot(url = '/tabs/home', window = 34, providers: Provider[] = []) {
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes), ...providers],
  });
  const injector = app.componentRef.injector;
  const router = injector.get(Router);
  await settle();
  injector
    .get(SafeArea)
    .report(
      { top: 47, right: 0, bottom: window, left: 0 },
      { x: 0, y: 0, width: 402, height: 874 },
    );
  await router.navigateByUrl(url);
  await settle();
  return {
    fabric: app.fabric,
    router,
    navigation: injector.get(NativeNavigation),
    insets: injector.get(TabBarInsets),
    safeArea: injector.get(SafeArea),
  };
}

const read = (fabric: FakeFabric, key: string, height: number) =>
  fireEvent(probeOf(fabric, key), 'layout', { layout: { width: 0, height } });

describe('TabBarInsets on iOS', () => {
  it('answers 0 with no tabs in the app', async () => {
    const { insets, fabric } = await boot('/plain');
    assert.equal(hosts(fabric).length, 0);
    assert.equal(insets.bottom(), 0);
  });

  it('answers what the tab in front measures, and nothing another tab reads', async () => {
    const { insets, fabric, router } = await boot();
    await read(fabric, 'home', 83);
    assert.equal(insets.bottom(), 83);

    await router.navigateByUrl('/tabs/library');
    await settle();
    await read(fabric, 'library', 83);
    await read(fabric, 'home', 0);
    assert.equal(insets.bottom(), 83, 'the tab behind reads 0');

    await read(fabric, 'library', 64);
    await read(fabric, 'home', 83);
    assert.equal(insets.bottom(), 64, 'a rotation: the tab behind stays on its old reading');
  });

  it('does not drop to 0 while a tab opened for the first time has yet to read the bar', async () => {
    const { insets, fabric, router } = await boot();
    await read(fabric, 'home', 83);
    await router.navigateByUrl('/tabs/library');
    await settle();
    assert.equal(insets.bottom(), 83);
  });

  it('keeps what an opened tab read when it comes back from one with the bar hidden', async () => {
    const { insets, fabric, router } = await boot();
    await read(fabric, 'home', 83);
    await router.navigateByUrl('/tabs/library');
    await settle();
    await read(fabric, 'library', 83);
    await router.navigateByUrl('/tabs/home');
    await settle();
    state.barHidden.set(true);
    await settle();
    await read(fabric, 'home', 34);
    await router.navigateByUrl('/tabs/library');
    await settle();
    state.barHidden.set(undefined);
    await settle();
    assert.equal(insets.bottom(), 83, 'its probe has no change to report');
  });

  it('stays at 0 while a new tab comes in front of one that never read the bar', async () => {
    const { insets, router } = await boot();
    assert.equal(insets.bottom(), 0, 'nothing measured yet');
    await router.navigateByUrl('/tabs/library');
    await settle();
    assert.equal(insets.bottom(), 0);
  });

  it('answers 0 while the outlet hides the bar, and the height again after', async () => {
    const { insets, fabric } = await boot();
    await read(fabric, 'home', 83);
    state.barHidden.set(true);
    await settle();
    await read(fabric, 'home', 34);
    assert.equal(insets.bottom(), 0);
    state.barHidden.set(undefined);
    await settle();
    await read(fabric, 'home', 83);
    assert.equal(insets.bottom(), 83);
  });

  it('answers 0 at once on hiding, before native has laid out again', async () => {
    const { insets, fabric } = await boot();
    await read(fabric, 'home', 83);
    state.barHidden.set(true);
    await settle();
    assert.equal(insets.bottom(), 0);
  });

  it('follows a page that hides the bar, and [barHidden] overriding it', async () => {
    const { insets, fabric, navigation } = await boot();
    await read(fabric, 'home', 83);
    await navigation.push('/tabs/home/reader');
    await settle();
    assert.equal(insets.bottom(), 0, 'the page hides the bar');

    state.barHidden.set(false);
    await settle();
    assert.equal(insets.bottom(), 83, 'the outlet says otherwise');

    state.barHidden.set(undefined);
    await settle();
    assert.equal(insets.bottom(), 0);

    navigation.back();
    await settle();
    await settle();
    assert.equal(insets.bottom(), 83, 'the request went with the page');
  });

  it('answers 0 for a bar not along the bottom edge, as an iPad has at the top', async () => {
    const { insets, fabric, safeArea } = await boot('/tabs/home', 20);
    await read(fabric, 'home', 20);
    assert.equal(insets.bottom(), 0);
    await read(fabric, 'home', 65);
    assert.equal(insets.bottom(), 65, 'one size class down, the bar is along the bottom');
    await read(fabric, 'home', 20);
    assert.equal(insets.bottom(), 0, 'and back up');

    safeArea.report(
      { top: 0, right: 0, bottom: 0, left: 0 },
      { x: 0, y: 0, width: 402, height: 874 },
    );
    assert.equal(insets.bottom(), 20, 'above the window inset, whatever that is now');
    await read(fabric, 'home', 0);
    assert.equal(insets.bottom(), 0, 'an iPad with no home indicator, where the top bar reads 0');
  });

  it('ignores the native module, which is Android alone', async () => {
    const fake = fakeBar();
    const global = globalThis as { expo?: unknown };
    const earlier = global.expo;
    global.expo = { modules: { NgNativeTabBar: fake.module } };
    try {
      const { fabric } = await boot();
      await fireEvent(hosts(fabric)[0]!, 'layout', { layout: { width: 402, height: 874 } });
      assert.deepEqual(fake.watched, []);
      assert.equal(fake.listeners.size, 0);
    } finally {
      global.expo = earlier;
    }
  });

  it('answers 0 under a page pushed over the tabs, and the height after the pop', async () => {
    const { insets, fabric, navigation } = await boot();
    await read(fabric, 'home', 83);
    await navigation.push('/outside');
    await settle();
    assert.equal(insets.bottom(), 0);

    navigation.back();
    await settle();
    await settle();
    assert.equal(insets.bottom(), 83);
  });

  it('answers 0 under a sheet or a modal over the tabs, and the height after', async () => {
    const { insets, fabric, navigation } = await boot();
    await read(fabric, 'home', 83);
    for (const as of ['formSheet', 'modal'] as const) {
      await navigation.present('/outside', { as });
      await settle();
      assert.equal(insets.bottom(), 0, as);
      navigation.back();
      await settle();
      await settle();
      assert.equal(insets.bottom(), 83, `${as} dismissed`);
    }
  });

  it('answers 0 under a page presented in the tab, which is over the whole window', async () => {
    const { insets, fabric, navigation } = await boot();
    await read(fabric, 'home', 83);
    await navigation.push('/tabs/home/sheet', {
      presentation: { stackPresentation: 'formSheet' },
    });
    await settle();
    assert.equal(insets.bottom(), 0);

    navigation.back();
    await settle();
    await settle();
    assert.equal(insets.bottom(), 83);
  });

  it('counts a presented page only while it is in front of what it covers', async () => {
    const { insets, fabric, navigation, router } = await boot();
    await read(fabric, 'home', 83);
    await navigation.push('/tabs/home/sheet', { presentation: { stackPresentation: 'modal' } });
    await settle();
    await router.navigateByUrl('/tabs/library');
    await settle();
    await settle();
    await read(fabric, 'library', 83);
    assert.equal(insets.bottom(), 83, 'the tab dismissed what it presented as it went behind');
  });

  it('answers 0 once the outlet is destroyed, with nothing stale', async () => {
    const { insets, fabric, navigation } = await boot();
    await read(fabric, 'home', 83);
    await navigation.reset('/plain');
    await settle();
    await settle();
    assert.equal(hosts(fabric).length, 0);
    assert.equal(insets.bottom(), 0);
  });

  it('answers 0 once the outlet goes while its page stays in front', async () => {
    const { insets, fabric } = await boot();
    await read(fabric, 'home', 83);
    state.showsOutlet.set(false);
    await settle();
    assert.equal(hosts(fabric).length, 0);
    assert.equal(insets.bottom(), 0);
  });

  it('answers the tallest of a bar inside a tab of another', async () => {
    const { insets, fabric, router } = await boot('/tabs/more/one');
    await read(fabric, 'one', 83);
    assert.equal(insets.bottom(), 83, 'the inner bar');
    await read(fabric, 'more', 100);
    assert.equal(insets.bottom(), 100, 'the outer bar, taller');
    await read(fabric, 'more', 50);
    assert.equal(insets.bottom(), 83);

    await router.navigateByUrl('/tabs/home');
    await settle();
    await settle();
    await read(fabric, 'home', 70);
    assert.equal(insets.bottom(), 70, 'the inner bar is in a tab behind');
  });

  it('keeps the probe after the page, where native looks first for the scroll view', async () => {
    const { fabric, router } = await boot();
    const last = (key: string) => {
      const screen = tabScreens(fabric).find((node) =>
        String(node.props['screenKey']).includes(key),
      )!;
      assert.ok(screen.children.length >= 2, 'page and probe');
      assert.equal(screen.children.filter(isProbe).length, 1, 'one probe');
      assert.ok(isProbe(screen.children.at(-1)!));
      assert.ok(!isProbe(screen.children[0]!));
    };
    last('home');

    await router.navigateByUrl('/tabs/library');
    await settle();
    last('library');

    // An @if that takes the tab away and brings it back makes a new screen for the page.
    await router.navigateByUrl('/tabs/home');
    await settle();
    state.showsLibrary.set(false);
    await settle();
    state.showsLibrary.set(true);
    await settle();
    await settle();
    last('library');
  });

  it('measures with a view of no width, bottom edge only', async () => {
    const { fabric } = await boot();
    const probe = probeOf(fabric, 'home');
    assert.equal(probe.props['width'], 0);
    assert.equal(probe.props['position'], 'absolute');
    assert.equal(probe.props['bottom'], 0);
    assert.deepEqual(probe.children[0]!.props['edges'], {
      top: false,
      right: false,
      bottom: true,
      left: false,
    });
    assert.equal(probe.children[0]!.props['height'], 0);
  });
});

interface FakeBar {
  module: Record<string, unknown>;
  watched: number[];
  unwatched: number[];
  listeners: Set<(change: { host: number; height: number }) => void>;
  send(host: number, height: number): Promise<void>;
}

function fakeBar(): FakeBar {
  const fake: FakeBar = {
    watched: [],
    unwatched: [],
    listeners: new Set(),
    module: {
      addListener: (_: string, listener: (change: { host: number; height: number }) => void) => {
        fake.listeners.add(listener);
        return { remove: () => fake.listeners.delete(listener) };
      },
      watch: async (host: number) => {
        fake.watched.push(host);
        return true;
      },
      unwatch: async (host: number) => {
        fake.unwatched.push(host);
      },
    },
    async send(host, height) {
      for (const listener of [...fake.listeners]) listener({ host, height });
      await settle();
    },
  };
  return fake;
}

describe('TabBarInsets on Android', () => {
  const global = globalThis as { expo?: unknown };
  const earlier = global.expo;

  before(() => registerPlatformComponents('android'));
  after(() => registerPlatformComponents('ios'));
  afterEach(() => {
    if (earlier === undefined) delete global.expo;
    else global.expo = earlier;
  });

  async function bootWith(fake: FakeBar) {
    global.expo = { modules: { NgNativeTabBar: fake.module } };
    const app = await boot();
    const host = hosts(app.fabric)[0]!;
    await fireEvent(host, 'layout', { layout: { width: 402, height: 874 } });
    return { ...app, host };
  }

  it('puts no probe in a tab', async () => {
    const { fabric } = await bootWith(fakeBar());
    assert.equal(tabScreens(fabric).flatMap((node) => node.children.filter(isProbe)).length, 0);
  });

  it('asks about the host once it has laid out, and reads its height', async () => {
    const fake = fakeBar();
    const { insets, host } = await bootWith(fake);
    assert.deepEqual(fake.watched, [host.reactTag]);
    assert.equal(insets.bottom(), 0, 'nothing reported yet');
    await fake.send(host.reactTag, 104.38);
    assert.equal(insets.bottom(), 104.38);
    await fake.send(host.reactTag, 80.38);
    assert.equal(insets.bottom(), 80.38, 'follows a rotation');
  });

  it('ignores the bar of another outlet', async () => {
    const fake = fakeBar();
    const { insets, host } = await bootWith(fake);
    await fake.send(host.reactTag + 2, 104.38);
    assert.equal(insets.bottom(), 0);
  });

  it('answers 0 while the bar is hidden or the tabs covered, and the height after', async () => {
    const fake = fakeBar();
    const { insets, host, navigation } = await bootWith(fake);
    await fake.send(host.reactTag, 104.38);

    state.barHidden.set(true);
    await settle();
    assert.equal(insets.bottom(), 0, 'hidden');
    state.barHidden.set(undefined);
    await settle();
    assert.equal(insets.bottom(), 104.38);

    await navigation.push('/outside');
    await settle();
    assert.equal(insets.bottom(), 0, 'covered');
    navigation.back();
    await settle();
    await settle();
    assert.equal(insets.bottom(), 104.38);
  });

  it('keeps the bar under a page presented in the tab, which is drawn inside it', async () => {
    const fake = fakeBar();
    const { insets, host, navigation } = await bootWith(fake);
    await fake.send(host.reactTag, 104.38);
    await navigation.push('/tabs/home/sheet', { presentation: { stackPresentation: 'modal' } });
    await settle();
    assert.equal(insets.bottom(), 104.38);
  });

  it('stops listening and answers 0 once the outlet is destroyed', async () => {
    const fake = fakeBar();
    const { insets, host, navigation } = await bootWith(fake);
    await fake.send(host.reactTag, 104.38);
    await navigation.reset('/plain');
    await settle();
    await settle();
    assert.equal(insets.bottom(), 0);
    assert.deepEqual(fake.unwatched, [host.reactTag]);
    assert.equal(fake.listeners.size, 0);
  });

  it('stays at 0 with no module, as in Expo Go, and with a module missing its methods', async () => {
    for (const expo of [undefined, { modules: {} }, { modules: { NgNativeTabBar: {} } }]) {
      if (expo) global.expo = expo;
      else delete global.expo;
      const errors: unknown[] = [];
      const reported = { handleError: (error: unknown) => errors.push(error) };
      const handler = { provide: ErrorHandler, useValue: reported };
      const { insets, fabric } = await boot('/tabs/home', 34, [handler]);
      await fireEvent(hosts(fabric)[0]!, 'layout', { layout: { width: 402, height: 874 } });
      assert.equal(insets.bottom(), 0);
      assert.deepEqual(errors, []);
      cleanup();
    }
  });

  it('survives a watch or an unwatch that rejects or answers nothing', async () => {
    const fake = fakeBar();
    fake.module['watch'] = () => Promise.reject(new Error('no view'));
    fake.module['unwatch'] = () => undefined;
    const { insets, navigation } = await bootWith(fake);
    await navigation.reset('/plain');
    await settle();
    await settle();
    assert.equal(insets.bottom(), 0);
  });

  it('finds the module the build registers, and nothing where there is none', () => {
    const module = {};
    global.expo = { modules: { NgNativeTabBar: module } };
    assert.equal(nativeTabBar(), module);
    delete global.expo;
    assert.equal(nativeTabBar(), undefined);
  });
});
