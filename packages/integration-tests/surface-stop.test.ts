/**
 * An app goes with the surface it is mounted on.
 *
 * Fabric stops a surface by calling `RN$stopSurface` with its id, the root tag the app was mounted
 * with. An Android activity Android recreates, after the font size changes for one, starts a new
 * surface, runs the app's runnable on it, and then stops the old one: the old app has to be
 * destroyed there, or it runs on beside the new one with its timers, subscriptions and effects.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
import { StatusBar } from '@ng-native/device';
import { Brightness } from '@ng-native/expo/brightness';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type StopSurface = (surfaceId: number) => void;
const scope = globalThis as { RN$stopSurface?: StopSurface };
const KEY = 'RN$stopSurface';
const original = Object.getOwnPropertyDescriptor(globalThis, KEY);

afterEach(() => {
  if (original) Object.defineProperty(globalThis, KEY, original);
  else delete scope.RN$stopSurface;
});

/** What React's renderer installs, recording the surfaces it was asked to stop. */
function reactStopSurface() {
  const stopped: number[] = [];
  return { stopped, stop: (surfaceId: number) => void stopped.push(surfaceId) };
}

describe('an app on a surface Fabric stops', () => {
  let Counter: Type<unknown>;

  before(async () => {
    Counter = (await compileFixture('fixtures/counter.ts'))['Counter'] as Type<unknown>;
  });

  it('is destroyed with it, and React is still told', () => {
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const old = mount(1, Counter, createFakeFabric());
    const current = mount(11, Counter, createFakeFabric());

    scope.RN$stopSurface!(1);

    assert.equal(old.applicationRef.destroyed, true, 'the app on the stopped surface');
    assert.equal(current.applicationRef.destroyed, false, 'not the app on another surface');
    assert.deepEqual(react.stopped, [1]);
    current.applicationRef.destroy();
  });

  it('is destroyed when React installs its handler after it mounted, and another app mounts', () => {
    delete scope.RN$stopSurface;
    const old = mount(1, Counter, createFakeFabric());
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const current = mount(11, Counter, createFakeFabric());

    scope.RN$stopSurface!(1);

    assert.equal(old.applicationRef.destroyed, true);
    assert.deepEqual(react.stopped, [1], 'and React is told as well');
    current.applicationRef.destroy();
  });

  it('is destroyed once, and each handler called once, when something else wraps the handler', () => {
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const app = mount(1, Counter, createFakeFabric());
    // What a tool does to watch the call: wrap what is there, and call it.
    const wrapped = scope.RN$stopSurface!;
    const seen: number[] = [];
    scope.RN$stopSurface = (surfaceId) => {
      seen.push(surfaceId);
      wrapped(surfaceId);
    };

    // A later app wraps the wrapper, with the first wrapping still inside it.
    const beside = mount(11, Counter, createFakeFabric());

    scope.RN$stopSurface!(1);

    assert.equal(app.applicationRef.destroyed, true);
    assert.equal(beside.applicationRef.destroyed, false);
    assert.deepEqual(seen, [1]);
    assert.deepEqual(react.stopped, [1]);
    beside.applicationRef.destroy();
  });

  it('leaves one wrapper however many apps mount', () => {
    scope.RN$stopSurface = () => {};
    const first = mount(1, Counter, createFakeFabric());
    const wrapper = scope.RN$stopSurface;
    const second = mount(11, Counter, createFakeFabric());
    assert.equal(scope.RN$stopSurface, wrapper);
    first.applicationRef.destroy();
    second.applicationRef.destroy();
  });

  it('is destroyed with no handler of React to tell', () => {
    delete scope.RN$stopSurface;
    const app = mount(1, Counter, createFakeFabric());

    assert.doesNotThrow(() => scope.RN$stopSurface!(1));
    assert.equal(app.applicationRef.destroyed, true);
  });

  it('that was destroyed already is not destroyed again', () => {
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const app = mount(1, Counter, createFakeFabric());
    app.applicationRef.destroy();

    // A second destroy throws NG0406.
    assert.doesNotThrow(() => scope.RN$stopSurface!(1));
    assert.deepEqual(react.stopped, [1]);
  });

  it('is destroyed once when its surface is stopped twice', () => {
    scope.RN$stopSurface = () => {};
    const app = mount(1, Counter, createFakeFabric());
    scope.RN$stopSurface!(1);
    assert.equal(app.applicationRef.destroyed, true);
    assert.doesNotThrow(() => scope.RN$stopSurface!(1));
  });

  it('hands an error its destroy throws to its ErrorHandler, and the surface still stops', () => {
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const handled: unknown[] = [];
    const errors = {
      provide: ErrorHandler,
      useValue: { handleError: (e: unknown) => handled.push(e) },
    };
    const failing = mount(1, Counter, createFakeFabric(), { providers: [errors] });
    const boom = new Error('boom');
    failing.applicationRef.onDestroy(() => {
      throw boom;
    });
    const beside = mount(1, Counter, createFakeFabric());

    assert.doesNotThrow(() => scope.RN$stopSurface!(1));
    assert.deepEqual(handled, [boom]);
    assert.equal(beside.applicationRef.destroyed, true, 'the other app on the surface goes too');
    assert.deepEqual(react.stopped, [1]);
  });

  it('destroys the other apps on the surface when an ErrorHandler throws', () => {
    const react = reactStopSurface();
    scope.RN$stopSurface = react.stop;
    const failure = new Error('handler');
    const throwing = {
      provide: ErrorHandler,
      useValue: {
        handleError: () => {
          throw failure;
        },
      },
    };
    const failing = mount(1, Counter, createFakeFabric(), { providers: [throwing] });
    failing.applicationRef.onDestroy(() => {
      throw new Error('boom');
    });
    const beside = mount(1, Counter, createFakeFabric());

    assert.throws(() => scope.RN$stopSurface!(1), failure);
    assert.equal(beside.applicationRef.destroyed, true, 'the other app on the surface goes too');
    assert.deepEqual(react.stopped, [1]);
  });

  it('leaves the window as the app mounted after it claimed it', async () => {
    scope.RN$stopSurface = reactStopSurface().stop;
    const calls: string[] = [];
    const providers = [
      {
        provide: KeepAwake.SOURCE,
        useValue: {
          activate: async () => void calls.push('awake'),
          deactivate: async () => void calls.push('asleep'),
        },
      },
      {
        provide: DeviceOrientation.SOURCE,
        useValue: {
          reported: null,
          lock: async () => void calls.push('locked'),
          unlock: async () => void calls.push('unlocked'),
        },
      },
      {
        provide: StatusBar.SOURCE,
        useValue: {
          setStyle: (style: string) => calls.push(`style ${style}`),
          setHidden: (hidden: boolean) => calls.push(`hidden ${hidden}`),
          setBackgroundColor: () => {},
          setTranslucent: () => {},
          height: undefined,
        },
      },
      {
        provide: Brightness.SOURCE,
        useValue: {
          get: async () => 0.5,
          set: async () => void calls.push('bright'),
          restore: async () => void calls.push('restored'),
        },
      },
    ];
    /** What a probe in the app asks of the window, given back when the app is destroyed. */
    const claim = (app: ReturnType<typeof mount>) => {
      const injector = app.applicationRef.injector;
      app.applicationRef.onDestroy(injector.get(KeepAwake).hold());
      app.applicationRef.onDestroy(injector.get(DeviceOrientation).lock('portrait'));
      app.applicationRef.onDestroy(injector.get(StatusBar).push({ style: 'light', hidden: true }));
      app.applicationRef.onDestroy(injector.get(Brightness).set(1));
    };
    // Android mounts the recreated activity's app before it stops the old surface.
    const old = mount(1, Counter, createFakeFabric(), { providers });
    claim(old);
    const current = mount(11, Counter, createFakeFabric(), { providers });
    claim(current);
    await new Promise((resolve) => setImmediate(resolve));
    calls.length = 0;

    scope.RN$stopSurface!(1);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(old.applicationRef.destroyed, true);
    assert.deepEqual(
      calls.filter((call) =>
        ['asleep', 'unlocked', 'restored', 'style default', 'hidden false'].includes(call),
      ),
      [],
      'nothing the new app claimed is given back',
    );
    current.applicationRef.destroy();
  });
});
