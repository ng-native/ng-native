/**
 * Android's navigation bar: the same stack of claims as the status bar, driven through
 * expo-navigation-bar's native module, reached by name.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { Injector } from '@angular/core';
import {
  ColorScheme,
  NavigationBar,
  navigationBarSource,
  type ColorSchemeSource,
  type NavigationBarSource,
  type Scheme,
} from '@ng-native/device';

function recorder(screensSetBar?: boolean) {
  const calls: [string, unknown][] = [];
  const source: NavigationBarSource = {
    setStyle: (style) => calls.push(['style', style]),
    setHidden: (hidden) => calls.push(['hidden', hidden]),
    screensSetBar,
  };
  return { calls, source };
}

function scheme(initial: Scheme = 'light') {
  let current = initial;
  const listeners = new Set<(scheme: Scheme) => void>();
  const source: ColorSchemeSource = {
    current: () => current,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
  const change = (next: Scheme) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { source, change, listeners };
}

function build(source: NavigationBarSource, colors = scheme().source) {
  const injector = Injector.create({
    providers: [
      { provide: NavigationBar.SOURCE, useValue: source },
      { provide: ColorScheme.SOURCE, useValue: colors },
      { provide: ColorScheme, useClass: ColorScheme },
      { provide: NavigationBar, useClass: NavigationBar },
    ],
  });
  return { bar: injector.get(NavigationBar), injector };
}

describe('the navigation bar', () => {
  it('hides the bar for a claim and shows it again when the claim drops', () => {
    const { calls, source } = recorder();
    const { bar } = build(source);
    const show = bar.push({ hidden: true });
    assert.deepEqual(calls, [['hidden', true]]);
    show();
    assert.deepEqual(calls, [
      ['hidden', true],
      ['hidden', false],
    ]);
  });

  it('restores the claim underneath, and puts a dropped property back only once', () => {
    const { calls, source } = recorder();
    const { bar } = build(source);
    bar.set({ style: 'light' });
    const claim = bar.push({ style: 'dark', hidden: true });
    calls.length = 0;
    claim();
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['hidden', false],
    ]);
    calls.length = 0;
    bar.push({ style: 'dark' });
    assert.deepEqual(calls, [['style', 'dark']], 'hidden is not sent again');
  });

  it('asks for nothing until a claim names something', () => {
    const { calls, source } = recorder();
    build(source).bar.set({});
    assert.deepEqual(calls, []);
  });
});

describe("an 'auto' navigation bar", () => {
  it('asks for dark buttons on a light scheme and light ones on a dark one', () => {
    const light = recorder();
    build(light.source, scheme('light').source).bar.set({ style: 'auto' });
    assert.deepEqual(light.calls, [['style', 'dark']]);

    const dark = recorder();
    build(dark.source, scheme('dark').source).bar.set({ style: 'auto' });
    assert.deepEqual(dark.calls, [['style', 'light']]);
  });

  it('follows the scheme when it changes, as a ColorScheme.set() theme switch does', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).bar.set({ style: 'auto' });
    calls.length = 0;
    colors.change('dark');
    colors.change('light');
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['style', 'dark'],
    ]);
  });

  it('sends a fixed style again when the scheme changes, which Android resets the buttons on', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).bar.set({ style: 'light' });
    calls.length = 0;
    colors.change('dark');
    colors.change('light');
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['style', 'light'],
    ]);
  });

  it('goes back to following the scheme when the last style claim drops', () => {
    const { calls, source } = recorder();
    const { bar } = build(source, scheme('dark').source);
    const claim = bar.push({ style: 'dark' });
    calls.length = 0;
    claim();
    assert.deepEqual(calls, [['style', 'light']]);
  });

  it('keeps following the scheme after the last style claim drops', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    const { bar } = build(source, colors.source);
    bar.push({ style: 'light' })();
    calls.length = 0;
    colors.change('dark');
    assert.deepEqual(calls, [['style', 'light']]);
  });

  it('leaves the buttons alone on a scheme change until a claim names a style', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).bar.set({ hidden: true });
    calls.length = 0;
    colors.change('dark');
    assert.deepEqual(calls, []);
  });

  it('stops following the scheme when its injector is destroyed', () => {
    const { source } = recorder();
    const colors = scheme('light');
    const { bar, injector } = build(source, colors.source);
    bar.set({ style: 'auto' });
    (injector as unknown as { destroy(): void }).destroy();
    assert.equal(colors.listeners.size, 0);
  });
});

describe("the navigation bar's platform source", () => {
  /** A device for one call: React Native on `os`, and Expo's modules with `modules` in them. */
  function onDevice<T>(os: string, modules: Record<string, unknown> | undefined, run: () => T): T {
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) =>
      id === 'react-native' ? { Platform: { OS: os } } : undefined;
    host['nativeFabricUIManager'] = {};
    host['expo'] = modules && { modules };
    try {
      return run();
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
      delete host['expo'];
    }
  }

  function module() {
    const calls: [string, unknown][] = [];
    const native = {
      setStyle: (style: string) => (calls.push(['style', style]), Promise.resolve()),
      setHidden: (hidden: boolean) => (calls.push(['hidden', hidden]), Promise.resolve()),
    };
    return { calls, native };
  }

  it('does nothing off a device rather than throwing', () => {
    const source = navigationBarSource();
    source.setStyle('dark');
    source.setHidden(true);
    assert.equal(source.screensSetBar, undefined);
  });

  it("drives expo-navigation-bar's module on Android, and has the screens carry the claim", () => {
    const { calls, native } = module();
    const source = onDevice('android', { ExpoNavigationBar: native }, navigationBarSource);
    source.setStyle('dark');
    source.setHidden(true);
    assert.deepEqual(calls, [
      ['style', 'dark'],
      ['hidden', true],
    ]);
    assert.equal(source.screensSetBar, true);
  });

  it('reaches no module on iOS, which has no navigation bar', () => {
    const { calls, native } = module();
    const source = onDevice('ios', { ExpoNavigationBar: native }, navigationBarSource);
    source.setStyle('dark');
    source.setHidden(true);
    assert.deepEqual(calls, []);
    assert.equal(source.screensSetBar, undefined);
  });

  it('does nothing, on the screens too, in an Android app without the module', () => {
    for (const modules of [undefined, {}]) {
      const source = onDevice('android', modules, navigationBarSource);
      assert.doesNotThrow(() => source.setHidden(true));
      assert.equal(source.screensSetBar, undefined);
    }
  });

  it('survives a module missing a method, and one that rejects', async () => {
    const rejecting = { setStyle: () => Promise.reject(new Error('no activity')) };
    const source = onDevice('android', { ExpoNavigationBar: rejecting }, navigationBarSource);
    assert.doesNotThrow(() => source.setStyle('light'));
    assert.doesNotThrow(() => source.setHidden(true));
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('a navigation bar claim with a property set to undefined', () => {
  // As for the status bar: an undefined property leaves whatever the claim underneath said.
  it('keeps the bar hidden underneath while the claim lasts', () => {
    const { calls, source } = recorder();
    const { bar } = build(source);
    bar.set({ hidden: true });
    calls.length = 0;

    bar.push({ hidden: undefined, style: 'light' });
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['hidden', true],
    ]);
    assert.equal(bar.state().hidden, true);
  });

  it('keeps what is underneath until the claim drops, then puts it back', () => {
    const { calls, source } = recorder();
    const { bar } = build(source);
    bar.set({ style: 'light', hidden: true });
    calls.length = 0;

    const claim = bar.push({ style: undefined, hidden: false });
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['hidden', false],
    ]);
    calls.length = 0;

    claim();
    assert.deepEqual(calls, [
      ['style', 'light'],
      ['hidden', true],
    ]);
    assert.deepEqual(bar.state(), { style: 'light', hidden: true });
  });

  it('leaves an undefined property of the base claim out of the state', () => {
    const { calls, source } = recorder();
    const { bar } = build(source);
    bar.set({ style: 'light', hidden: undefined });
    assert.deepEqual(calls, [['style', 'light']]);
    assert.deepEqual(bar.state(), { style: 'light' });
  });

  it('sends the fixed style underneath again on a scheme change', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    const { bar } = build(source, colors.source);
    bar.set({ style: 'dark' });
    bar.push({ style: undefined, hidden: true });
    calls.length = 0;

    colors.change('dark');
    assert.deepEqual(calls, [['style', 'dark']]);
  });

  it('hands the screens the visibility underneath', () => {
    const { source } = recorder(true);
    const { bar } = build(source);
    bar.set({ hidden: true });
    bar.push({ hidden: undefined, style: 'dark' });
    assert.deepEqual(bar.forScreens(), { hidden: true });
  });
});

describe('a navigation bar two apps claim', () => {
  // As for the status bar: the old app of a recreated activity goes after the new one claimed.
  it('keeps the bar a later app claimed when the earlier app goes', () => {
    const { calls, source } = recorder();
    const old = build(source);
    const dropOld = old.bar.push({ style: 'light', hidden: true });
    const current = build(source);
    current.bar.set({ style: 'dark', hidden: true });
    calls.length = 0;

    dropOld();
    old.injector.destroy();
    const last = (kind: string) => calls.filter(([one]) => one === kind).at(-1)?.[1];
    assert.equal(last('hidden'), true);
    assert.equal(last('style'), 'dark');
    assert.deepEqual(current.bar.state(), { style: 'dark', hidden: true });
  });

  it('takes an app that goes without dropping its claims out of the bar', () => {
    const { calls, source } = recorder();
    const old = build(source);
    old.bar.set({ hidden: true });
    const current = build(source);
    current.bar.set({ style: 'dark' });
    calls.length = 0;

    old.injector.destroy();
    assert.deepEqual(calls, [
      ['style', 'dark'],
      ['hidden', false],
    ]);
  });

  it('follows the scheme of the app whose auto style is in force', () => {
    const { calls, source } = recorder();
    const oldColors = scheme('light');
    const currentColors = scheme('light');
    build(source, oldColors.source);
    const current = build(source, currentColors.source);
    current.bar.set({ style: 'auto' });
    calls.length = 0;

    oldColors.change('dark');
    assert.deepEqual(calls, [], 'not the scheme of an app with no style claimed');
    currentColors.change('dark');
    assert.deepEqual(calls, [['style', 'light']]);
  });

  it('follows the scheme of the app left once no style is claimed', () => {
    const { calls, source } = recorder();
    const oldColors = scheme('light');
    const currentColors = scheme('dark');
    const old = build(source, oldColors.source);
    old.bar.set({ style: 'light' });
    const current = build(source, currentColors.source);
    current.bar.set({ hidden: false });
    calls.length = 0;

    old.injector.destroy();
    assert.deepEqual(calls[0], ['style', 'light'], 'auto, by the dark scheme of the app left');
  });
});

describe('a navigation bar window that comes to the front', () => {
  function fronting() {
    const { calls, source } = recorder();
    const fronts = new Set<() => void>();
    return {
      calls,
      source: {
        ...source,
        onWindowFront: (listener: () => void) => (
          fronts.add(listener),
          () => fronts.delete(listener)
        ),
      },
      front: () => {
        for (const listener of fronts) listener();
      },
    };
  }

  it('is given what is claimed again', () => {
    const { calls, source, front } = fronting();
    const { bar } = build(source);
    bar.set({ style: 'dark', hidden: true });
    calls.length = 0;

    front();
    assert.deepEqual(calls, [
      ['style', 'dark'],
      ['hidden', true],
    ]);
  });

  it('is given an auto style once a style was named, and nothing it never had', () => {
    const { calls, source, front } = fronting();
    const colors = scheme('dark');
    const { bar } = build(source, colors.source);
    front();
    assert.deepEqual(calls, [], 'no claim has named anything');

    const drop = bar.push({ style: 'dark', hidden: true });
    drop();
    calls.length = 0;
    front();
    assert.deepEqual(calls, [['style', 'light']]);
  });
});
