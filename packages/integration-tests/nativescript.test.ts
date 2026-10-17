/**
 * `@ng-native/nativescript`: the service an app calls NativeScript through, and `<ns-view>`.
 *
 * A fake runtime runs each worklet in place, so what is pinned is the wiring the app cannot see:
 * which platform's function `call` runs, the view each platform commits as, the pointer `create`'s
 * view comes back as reaching the view, `update` getting new props, a new spec building a new view,
 * and the view being let go when the element is.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { registerPlatformComponents } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import {
  NativeScript,
  nativeScriptRuntime,
  provideNativeScript,
  type NativeScriptRuntime,
} from '@ng-native/nativescript';
import { compileFixture } from './compile.ts';

interface Fixture {
  native: NativeScript;
  model: string | undefined;
  spec: { set(value: unknown): void };
  title: { set(value: string): void };
}

type Views = Map<string, { id: string; text: string }>;
const g = globalThis as Record<string, unknown>;

describe('NativeScript', () => {
  let Fixture: Type<unknown>;
  let ViewOnly: Type<unknown>;
  let label: unknown;
  let badge: unknown;

  before(async () => {
    const mod = await compileFixture('fixtures/ns-view.ts');
    Fixture = mod['NsViewFixture'] as Type<unknown>;
    ViewOnly = mod['NsViewOnlyFixture'] as Type<unknown>;
    label = mod['label'];
    badge = mod['badge'];
    // What NativeScript puts on the UI runtime: a view's pointer, here its id.
    g['interop'] = { handleof: (view: { id: string }) => ({ toHexString: () => `0x${view.id}` }) };
  });
  after(() => {
    delete g['interop'];
    delete g['__ngNsViews'];
  });

  const fake = (platform: 'ios' | 'android') => {
    const calls = { installs: 0, frameworks: [] as string[] };
    const runtime: NativeScriptRuntime = {
      platform,
      install: () => void calls.installs++,
      runOnUI: async (worklet, ...args) => worklet(...args),
      loadFramework: (name) => (calls.frameworks.push(name), true),
    };
    return { runtime, calls };
  };

  const render = (
    runtime: NativeScriptRuntime | null,
    errors: unknown[] = [],
    component: Type<unknown> = Fixture,
  ) => {
    const fabric = createFakeFabric();
    const app = mount(1, component, fabric, {
      providers: [
        { provide: NativeScript.RUNTIME, useValue: runtime },
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
      ],
    });
    const fixture = app.componentRef.instance as Fixture;
    const view = () => fabric.committed.at(-1)!.children[0]!;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      app.applicationRef.tick();
    };
    return { app, fixture, view, settle };
  };

  it('is inert with no runtime, as in Node', async () => {
    const { fixture, view, settle } = render(null);
    await settle();
    assert.equal(fixture.native.platform, null);
    assert.equal(fixture.model, undefined);
    assert.equal(await fixture.native.runOnUI(() => 1), undefined);
    assert.equal(view().props['nativeViewHandle'], undefined);
  });

  it('runs the app in a build without NativeScript, and fails what uses it', async () => {
    const missing = new Error('not in this build');
    const errors: unknown[] = [];
    const runtime: NativeScriptRuntime = {
      ...fake('ios').runtime,
      missing,
      runOnUI: () => Promise.reject(missing),
    };
    const { app, settle } = render(runtime, errors, ViewOnly);
    await settle();
    const native = (app.componentRef.instance as { native: NativeScript }).native;
    assert.deepEqual(errors, [missing], 'the view reports it');
    assert.throws(() => native.call({ ios: () => 1 }), missing);
    assert.equal(native.call({ android: () => 1 }), undefined, 'nothing to call on this platform');
    await assert.rejects(
      native.runOnUI(() => 1),
      missing,
    );
  });

  it('loads each framework the provider names, reporting one that does not load', () => {
    const { runtime, calls } = fake('ios');
    const errors: unknown[] = [];
    mount(1, Fixture, createFakeFabric(), {
      providers: [
        {
          provide: NativeScript.RUNTIME,
          useValue: {
            ...runtime,
            loadFramework: (name: string) => (calls.frameworks.push(name), name === 'SceneKit'),
          },
        },
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
        provideNativeScript({ frameworks: ['SceneKit', 'NoSuchKit'] }),
      ],
    });
    assert.deepEqual(calls.frameworks, ['SceneKit', 'NoSuchKit']);
    assert.deepEqual(
      errors.map((e) => (e as Error).message),
      ['[angular-native] NativeScript could not load NoSuchKit.'],
    );
  });

  it("installs once and calls the platform's function", () => {
    for (const [platform, model] of [
      ['ios', 'iPhone'],
      ['android', 'Pixel'],
    ] as const) {
      const { runtime, calls } = fake(platform);
      const { fixture } = render(runtime);
      fixture.native.call({});
      assert.equal(fixture.model, model);
      assert.equal(calls.installs, 1, platform);
    }
  });

  it("commits as NativeScript's view on iOS with the pointer of the view create built", async () => {
    const { fixture, view, settle } = render(fake('ios').runtime);
    await settle();
    assert.equal(view().viewName, 'NativeScriptUIView');
    assert.equal(view().props['nativeViewHandle'], '0xlabel');
    const views = g['__ngNsViews'] as Views;
    assert.equal([...views.values()].at(-1)!.text, 'Hello');

    fixture.title.set('Bye');
    await settle();
    assert.equal([...views.values()].at(-1)!.text, 'Bye');
  });

  it('builds a new view for a new spec, and lets it go with the element', async () => {
    const { app, fixture, view, settle } = render(fake('ios').runtime);
    await settle();
    const views = g['__ngNsViews'] as Views;
    const before = views.size;
    fixture.spec.set(badge);
    await settle();
    assert.equal(view().props['nativeViewHandle'], '0xbadge');
    assert.equal(views.size, before);

    app.applicationRef.destroy();
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(views.size, before - 1);
  });

  it('reports a create that returns no view, and holds nothing for it', async () => {
    const errors: unknown[] = [];
    const runtime = fake('ios').runtime;
    const { fixture, view, settle } = render(runtime, errors);
    await settle();
    const views = g['__ngNsViews'] as Map<string, unknown>;
    const before = views.size;
    fixture.spec.set({ create: () => 42 });
    await settle();
    assert.match(String(errors.at(-1)), /create returned 42, where it returns a UIView/);
    assert.equal(views.size, before - 1, 'the old view is let go');
    assert.equal(view().props['nativeViewHandle'], null, 'and the element is empty');
  });

  it('commits as a plain view on Android and builds nothing', async () => {
    registerPlatformComponents('android');
    try {
      const { view, settle } = render(fake('android').runtime);
      await settle();
      assert.equal(view().viewName, 'RCTView');
      assert.equal(view().props['nativeViewHandle'], undefined);
    } finally {
      registerPlatformComponents('ios');
    }
  });
});

/**
 * The runtime the service finds on a device, from the modules `require` answers there. Node has no
 * `require` in an ES module, so the factory finds the stand-in put on `globalThis`.
 */
describe('nativeScriptRuntime', () => {
  const withModules = <T>(modules: Record<string, unknown>, run: () => T): T => {
    const g = globalThis as Record<string, unknown>;
    const had = 'require' in g;
    const before = g['require'];
    g['require'] = (id: string) => {
      if (!(id in modules)) throw new Error(`Cannot find module '${id}'`);
      return modules[id];
    };
    try {
      return run();
    } finally {
      if (had) g['require'] = before;
      else delete g['require'];
    }
  };
  const reactNative = (os: string, turbo: object | null) => ({
    Platform: { OS: os },
    TurboModuleRegistry: { get: () => turbo },
  });

  it('is null in Node and on the web', () => {
    assert.equal(nativeScriptRuntime(), null);
    assert.equal(
      withModules({ 'react-native': reactNative('web', null) }, nativeScriptRuntime),
      null,
    );
  });

  it('says what to do in a build without the native module, and only when used', async () => {
    const runtime = withModules({ 'react-native': reactNative('ios', null) }, nativeScriptRuntime)!;
    assert.match(runtime.missing!.message, /not in this build.*@ng-native\/nativescript.*rebuild/);
    runtime.install();
    await assert.rejects(
      runtime.runOnUI(() => 1),
      runtime.missing,
    );
  });

  it('installs through the module on Android, and says so when a reload left it uninstalled', async () => {
    const g = globalThis as Record<string, unknown>;
    let installs = 0;
    const turbo = { install: () => (installs++, true) };
    const runtime = withModules(
      { 'react-native': reactNative('android', turbo) },
      nativeScriptRuntime,
    )!;
    g['java'] = {};
    try {
      runtime.install();
      assert.equal(installs, 1);
      assert.equal(runtime.missing, undefined);
      assert.equal(await runtime.runOnUI((a: number) => a + 1, 1), 2);
    } finally {
      delete g['java'];
    }
    // The module reports it is installed, and the runtime a reload made has none of its globals.
    runtime.install();
    assert.match(runtime.missing!.message, /reloaded/);
    await assert.rejects(
      runtime.runOnUI(() => 1),
      /reloaded/,
    );
  });

  it('installs with globals on iOS, and leaves no global Zone for Angular to take for zone.js', async () => {
    const g = globalThis as Record<string, unknown>;
    const calls: unknown[] = [];
    const ns = {
      init: (path: string, options: object) => {
        calls.push([path, options]);
        g['Zone'] = 1;
        return true;
      },
      runOnUI: async (worklet: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        worklet(...args),
      loadFramework: (name: string) => name === 'SceneKit',
    };
    const runtime = withModules(
      { 'react-native': reactNative('ios', {}), '@nativescript/react-native': { default: ns } },
      nativeScriptRuntime,
    )!;
    try {
      runtime.install();
      assert.deepEqual(calls, [['', { globals: true }]]);
      assert.equal('Zone' in g, false);
      assert.equal(runtime.loadFramework('SceneKit'), true);
      assert.equal(await runtime.runOnUI((a: number) => a * 2, 21), 42);
      // A native object handed to the JavaScript thread crashes the app on the next reload.
      const view = { isKindOfClass: () => true, toString: () => '<UIView>' };
      await assert.rejects(
        runtime.runOnUI(() => view),
        /returned a native object \(<UIView>\)/,
      );
    } finally {
      delete g['Zone'];
    }
  });

  it('keeps a Zone the app had before installing', () => {
    const g = globalThis as Record<string, unknown>;
    const ns = { init: () => true, runOnUI: async () => {}, loadFramework: () => true };
    g['Zone'] = 'the app’s';
    try {
      withModules(
        { 'react-native': reactNative('ios', {}), '@nativescript/react-native': { default: ns } },
        nativeScriptRuntime,
      )!.install();
      assert.equal(g['Zone'], 'the app’s');
    } finally {
      delete g['Zone'];
    }
  });
});
