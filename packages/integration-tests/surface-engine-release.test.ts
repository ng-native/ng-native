/**
 * An engine goes with the app on its surface.
 *
 * Every surface on a runtime shares one event dispatcher, which outlives them all. An app's engine
 * that stayed joined to it after the app was destroyed, as each one did when Android recreated the
 * activity, kept itself, its root and every node with a committed handle alive, and was handed the
 * events that have no target in place of the app that replaced it. Nor may it schedule anything:
 * a frame or a timer it asked for would commit a tree nobody shows.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { Type } from '@angular/core';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import {
  compileCss,
  createFakeFabric,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** What `getFabricUIManager` keys the runtime's one Fabric by: see `event-dispatcher.ts`. */
const FABRIC_RUNTIME = Symbol.for('ng-native.fabricRuntime');

/** A macrotask between each pass, because a `WeakRef` holds its target until the job ends. */
async function collect(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

type StopSurface = (surfaceId: number) => void;
const scope = globalThis as {
  RN$stopSurface?: StopSurface;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};
const STOP = Object.getOwnPropertyDescriptor(globalThis, 'RN$stopSurface');

afterEach(() => {
  if (STOP) Object.defineProperty(globalThis, 'RN$stopSurface', STOP);
  else delete scope.RN$stopSurface;
});

/** An event whose view has gone, which Fabric sends with no instance handle. */
const untargeted = {
  instanceHandle: null,
  reactTag: -1,
  viewName: 'View',
  props: {},
  children: [],
};

/** The events with no target `engine` is handed, from here on. */
function heardBy(engine: Engine): string[] {
  const heard: string[] = [];
  const dispatch = engine.dispatchEvent.bind(engine);
  engine.dispatchEvent = (handle: unknown, type: string, event: unknown) => {
    if (handle === null) heard.push(type);
    dispatch(handle, type, event);
  };
  return heard;
}

describe("an app's engine, once the app is destroyed", () => {
  let Counter: Type<unknown>;

  before(async () => {
    Counter = (await compileFixture('fixtures/counter.ts'))['Counter'] as Type<unknown>;
  });

  /** Mount on surface 1, stop it as Android does on a recreated activity, and mount on 11. */
  function recreate(fabric: FakeFabric) {
    scope.RN$stopSurface = () => {};
    const old = mount(1, Counter, fabric);
    const oldHeard = heardBy(old.engine);
    scope.RN$stopSurface!(1);
    assert.equal(old.applicationRef.destroyed, true);
    const current = mount(11, Counter, fabric);
    return { oldHeard, current };
  }

  it('leaves the event dispatcher to the app that replaced it', () => {
    const fabric = createFakeFabric();
    const { oldHeard, current } = recreate(fabric);
    const heard = heardBy(current.engine);
    fabric.emit(untargeted as unknown as FakeFabricNode, 'topKeyPress', {});
    assert.deepEqual(oldHeard, [], 'the destroyed engine was handed the event');
    assert.deepEqual(heard, ['topKeyPress']);
    current.applicationRef.destroy();
  });

  it('does not join the dispatcher again for a listener added after', () => {
    const fabric = createFakeFabric();
    scope.RN$stopSurface = () => {};
    const old = mount(1, Counter, fabric);
    const oldHeard = heardBy(old.engine);
    scope.RN$stopSurface!(1);
    old.engine.setEventListener(old.engine.root, 'topKeyPress', () => {});
    const current = mount(11, Counter, fabric);
    const heard = heardBy(current.engine);
    fabric.emit(untargeted as unknown as FakeFabricNode, 'topKeyPress', {});
    assert.deepEqual(oldHeard, [], 'the destroyed engine joined again');
    assert.deepEqual(heard, ['topKeyPress']);
    current.applicationRef.destroy();
  });

  it('commits nothing more in the turn it was destroyed in', async () => {
    const fabric = createFakeFabric();
    // The mount's commit asks to commit again at the end of the turn, which a destroy in the
    // same turn must call off.
    const app = mount(1, Counter, fabric);
    const commits = fabric.calls.completeRoot;
    app.applicationRef.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fabric.calls.completeRoot, commits);
  });

  it('can be collected', async () => {
    // Two facades over one runtime's Fabric, as `getFabricUIManager` makes: the stopped surface's
    // goes, as a device's Fabric lets go of a stopped surface's tree, and the dispatcher stays.
    // The handler is kept as native keeps it, for as long as the runtime runs.
    const runtime = {};
    const kept: unknown[] = [];
    const facade = () => {
      const fabric = Object.assign(createFakeFabric(), { [FABRIC_RUNTIME]: runtime });
      const register = fabric.registerEventHandler!.bind(fabric);
      fabric.registerEventHandler = (handler) => {
        kept.push(handler);
        register(handler);
      };
      return fabric;
    };
    scope.RN$stopSurface = () => {};
    const oldEngine = ((): WeakRef<Engine> => {
      const old = mount(1, Counter, facade());
      scope.RN$stopSurface!(1);
      return new WeakRef(old.engine);
    })();
    const current = mount(11, Counter, facade());
    await collect();
    assert.equal(oldEngine.deref() === undefined, true, 'the destroyed engine is still reachable');
    assert.equal(kept.length, 1, 'one handler, which native still holds');
    current.applicationRef.destroy();
  });

  it('calls off the frame it asked for, and asks for none after', () => {
    const asked = new Map<number, FrameRequestCallback>();
    let next = 0;
    const request = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    scope.requestAnimationFrame = (callback) => {
      asked.set(++next, callback);
      return next;
    };
    scope.cancelAnimationFrame = (id) => void asked.delete(id);
    try {
      // A first commit creates views, which asks for the frame that sees them.
      const app = mount(1, Counter, createFakeFabric());
      assert.ok(asked.size > 0, 'the mount asked for a frame');
      app.applicationRef.destroy();
      assert.equal(asked.size, 0, 'a frame is still owed to the destroyed app');
      app.factory.commitSoon();
      assert.equal(asked.size, 0, 'the destroyed app asked for another');
    } finally {
      if (request) Object.defineProperty(globalThis, 'requestAnimationFrame', request);
      else delete scope.requestAnimationFrame;
      if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel);
      else delete scope.cancelAnimationFrame;
    }
  });
});

describe('a disposed engine', () => {
  it('does not bring what native painted up to date later', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const rec = recorder();
      const fabric = createLaidOutFabric();
      let now = 0;
      const engine = new Engine(fabric, 1, {
        globalStyles: compileCss('.bar { width: 200px; height: 10px }') as StyleSheet,
        nativeAnimated: rec.native,
        now: () => now,
      });
      const view = engine.createElement('view');
      engine.setClasses(view, 'bar');
      engine.appendChild(engine.root, view);
      engine.commit();
      // A transform changed again and again is handed to native, which paints it without a
      // commit, and the shadow tree is brought up to date once the changes stop.
      for (let x = 10; x <= 50; x += 10) {
        now += 50;
        engine.advanceAnimations();
        engine.setProp(view, 'style', { transform: [{ translateX: x }] });
        engine.commit();
      }
      engine.dispose();
      // Not even after a commit it is still asked for, of a transform native paints.
      now += 50;
      engine.advanceAnimations();
      engine.setProp(view, 'style', { transform: [{ translateX: 60 }] });
      engine.commit();
      const commits = fabric.calls.completeRoot;
      mock.timers.tick(5000);
      assert.equal(fabric.calls.completeRoot, commits);
    } finally {
      mock.timers.reset();
    }
  });
});
