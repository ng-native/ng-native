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
