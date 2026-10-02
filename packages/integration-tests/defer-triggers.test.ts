/**
 * `@defer (on interaction | hover | viewport)`.
 *
 * Angular registers these on the trigger element itself: it checks in development that the
 * element is an `Element`, listens with `addEventListener`, and watches with a global
 * `IntersectionObserver`. None of that is a DOM here, so each trigger has to mean what it means on
 * the web in native terms: a press or focus, a pointer entering, and the trigger scrolling into
 * view.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine, EngineIntersectionObserver, type EngineNode } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
  fireEvent,
  render,
  settle,
  userEvent,
  type FakeFabric,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('@defer on a DOM trigger', () => {
  let mod: Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const original = { error: console.error, warn: console.warn };

  before(async () => {
    mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/defer-triggers.ts', import.meta.url)),
    );
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  });

  after(() => {
    console.error = original.error;
    console.warn = original.warn;
  });

  afterEach(cleanup);

  const renderTriggers = () => render(mod['DeferTriggers'] as Type<unknown>, { dev: true });

  it('registers every trigger without an assertion, however often it renders', async () => {
    const { fabric } = await renderTriggers();
    await settle();
    await settle();
    assert.deepEqual(errors, []);
    assert.ok(fabric.render().length > 0);
  });

  it('loads on interaction when the trigger is pressed', async () => {
    const { getByText, queryByText } = await renderTriggers();
    assert.ok(getByText('interaction waiting'));
    await userEvent.press(getByText('open'));
    await settle();
    assert.ok(getByText('interaction loaded'));
    assert.equal(queryByText('interaction waiting'), null);
  });

  it('loads on interaction when the trigger takes focus', async () => {
    const { getByTestId, getByText } = await render(mod['DeferFocus'] as Type<unknown>);
    await fireEvent.focus(getByTestId('focus-target'));
    await settle();
    assert.ok(getByText('focus loaded'));
  });

  it('loads on hover when a pointer enters, and says once that a phone has no pointer', async () => {
    const { getByTestId, getByText } = await renderTriggers();
    // The trigger is registered after the render that mounted it; its opt-in commits a frame on.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const target = getByTestId('hover-target');
    assert.equal(target.props['onPointerEnter'], true, 'native is asked for pointer events');
    await fireEvent(target, 'pointerEnter');
    await settle();
    assert.ok(getByText('hover loaded'));

    cleanup();
    await renderTriggers();
    const said = warnings.filter((line) => line.includes('@defer (on hover)'));
    assert.equal(said.length, 1, said.join('\n'));
  });

  it('loads on viewport once the trigger is scrolled into view, and not before', async () => {
    const { fabric, getByTestId, getByText, queryByText } = await renderTriggers();
    fabric.frames.set('ScrollView', { x: 0, y: 0, width: 400, height: 800 });
    fabric.frames.set('spot', { x: 0, y: 1600, width: 400, height: 40 });
    await fireEvent(getByTestId('spot'), 'layout', { layout: { width: 400, height: 40 } });
    await settle();
    assert.ok(getByText('viewport waiting'), 'below the fold, so still waiting');
    assert.equal(queryByText('viewport loaded'), null);

    fabric.frames.set('spot', { x: 0, y: 780, width: 400, height: 40 });
    await fireEvent.scroll(getByTestId('scroller'), { contentOffset: { x: 0, y: 820 } });
    await settle();
    assert.ok(getByText('viewport loaded'));
  });
});

describe('the intersection observer, on its own', () => {
  /** A committed view with the nativeID `spot` in a 400 by 800 window, and what was reported. */
  function scene(frame: { x: number; y: number; width: number; height: number } | null) {
    const fabric: FakeFabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
    const spot = engine.createElement('view');
    engine.setProp(spot, 'nativeID', 'spot');
    engine.appendChild(engine.root, spot);
    engine.commit();
    if (frame) fabric.frames.set('spot', frame);
    const seen: { ratio: number }[] = [];
    const observer = (threshold?: number | number[]) =>
      new EngineIntersectionObserver(
        (entries) => seen.push(...entries.map((e) => ({ ratio: e.intersectionRatio }))),
        { threshold },
      );
    return { engine, spot, seen, observer };
  }
  const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  it('reports a node already on screen without waiting for a layout event', async () => {
    const { spot, seen, observer } = scene({ x: 0, y: 100, width: 400, height: 40 });
    observer().observe(spot);
    await microtask();
    assert.equal(seen.length, 1);
  });

  it('does not report a node below the bottom of the window', async () => {
    const { spot, seen, observer } = scene({ x: 0, y: 1600, width: 400, height: 40 });
    observer().observe(spot);
    await microtask();
    assert.deepEqual(seen, []);
  });

  it('counts a node touching the edge of the window, as the web does', async () => {
    const { spot, seen, observer } = scene({ x: 0, y: 800, width: 400, height: 40 });
    observer().observe(spot);
    await microtask();
    assert.equal(seen.length, 1);
  });

  it('reports a node once its visible share reaches the threshold exactly', async () => {
    const { spot, seen, observer } = scene({ x: 0, y: 780, width: 400, height: 40 });
    observer(0.5).observe(spot);
    await microtask();
    assert.deepEqual(seen, [{ ratio: 0.5 }]);
  });

  it('takes the smallest of a list of thresholds', async () => {
    const { spot, seen, observer } = scene({ x: 0, y: 780, width: 400, height: 40 });
    observer([0.25, 0.75]).observe(spot);
    await microtask();
    assert.equal(seen.length, 1);
  });

  it('watches a node once, however many times it is observed', async () => {
    const { engine, spot, seen, observer } = scene({ x: 0, y: 100, width: 400, height: 40 });
    const watching = observer();
    watching.observe(spot);
    watching.observe(spot);
    await microtask();
    engine.dispatchEvent(spot, 'topLayout', {});
    assert.equal(seen.length, 2, 'once when observed, once on the layout');
  });

  it('reports nothing once unobserved, and stops listening for layout', async () => {
    const { engine, spot, seen, observer } = scene({ x: 0, y: 100, width: 400, height: 40 });
    const watching = observer();
    watching.observe(spot);
    watching.unobserve(spot);
    await microtask();
    engine.dispatchEvent(spot, 'topLayout', {});
    assert.deepEqual(seen, []);
    assert.equal(spot.listeners?.get('topLayout')?.size ?? 0, 0);
  });
});

describe('a trigger listener on an engine node', () => {
  const setup = () => {
    const engine = new Engine(createFakeFabric(), 1);
    const node = engine.createElement('view') as EngineNode & {
      addEventListener(type: string, fn: () => void): void;
      removeEventListener(type: string, fn: () => void): void;
    };
    engine.appendChild(engine.root, node);
    engine.commit();
    let calls = 0;
    const listener = () => calls++;
    return { engine, node, listener, calls: () => calls };
  };

  it('fires click when a touch lifts, not when it lands', () => {
    const { engine, node, listener, calls } = setup();
    node.addEventListener('click', listener);
    engine.dispatchEvent(node, 'topTouchStart', {});
    assert.equal(calls(), 0);
    engine.dispatchEvent(node, 'topTouchEnd', {});
    assert.equal(calls(), 1);
  });

  it('adds the same listener once, as the DOM does', () => {
    const { engine, node, listener, calls } = setup();
    node.addEventListener('click', listener);
    node.addEventListener('click', listener);
    engine.dispatchEvent(node, 'topTouchEnd', {});
    assert.equal(calls(), 1);
  });

  it('stops calling a listener once it is removed', () => {
    const { engine, node, listener, calls } = setup();
    node.addEventListener('click', listener);
    node.removeEventListener('click', listener);
    engine.dispatchEvent(node, 'topTouchEnd', {});
    assert.equal(calls(), 0);
  });
});

/** The globals installing the triggers may define or patch. */
const TOUCHED = ['Element', 'IntersectionObserver'] as const;

/**
 * Puts the globals installing touches back exactly as they were: a global that did not exist is
 * deleted rather than left as `undefined`, and one that did gets its own descriptor back.
 */
function snapshotGlobals(): () => void {
  const descriptors = TOUCHED.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  // An `Element` that exists already has its instance check patched in place, not replaced.
  const element = (globalThis as Record<string, unknown>)['Element'] as object | undefined;
  const check = element && Object.getOwnPropertyDescriptor(element, Symbol.hasInstance);
  return () => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    if (!element) return;
    if (check) Object.defineProperty(element, Symbol.hasInstance, check);
    else delete (element as Record<symbol, unknown>)[Symbol.hasInstance];
  };
}

describe('installing the triggers where React Native already has an Element', () => {
  it('makes an engine node an instance of it, and leaves its own instances to it', async () => {
    const scope = globalThis as Record<string, unknown>;
    const restore = snapshotGlobals();
    class Element {}
    const watched: unknown[] = [];
    class NativeObserver {
      observe(target: unknown) {
        watched.push(target);
      }
      unobserve() {}
      disconnect() {}
    }
    Object.assign(scope, { Element, IntersectionObserver: NativeObserver });
    try {
      // A copy of its own, since installing runs once per module and this process has already
      // installed onto a Node without an Element.
      const fresh = '../fabric/src/defer-triggers.ts?react-native-element';
      const { installDeferTriggers } = await import(fresh);
      installDeferTriggers();

      const node = new Engine(createFakeFabric(), 1).createElement('view');
      assert.equal(node instanceof Element, true, 'an engine node passes the check');
      assert.equal(new Element() instanceof Element, true, "React Native's own still do");
      assert.equal({} instanceof Element, false);

      const Observer = scope['IntersectionObserver'] as typeof EngineIntersectionObserver;
      const own = new Element();
      new Observer(() => {}).observe(own as never);
      assert.deepEqual(watched, [own], "React Native's observer watches its own nodes");
    } finally {
      restore();
    }
  });

  /**
   * Installs a fresh copy of the triggers over `globals`, runs `body`, and puts back every global
   * installing touches.
   * A copy of its own each time, since installing runs once per module.
   */
  async function installedOver(copy: string, globals: Record<string, unknown>, body: () => void) {
    const restore = snapshotGlobals();
    Object.assign(globalThis, globals);
    try {
      const fresh = `../fabric/src/defer-triggers.ts?${copy}`;
      const { installDeferTriggers } = await import(fresh);
      installDeferTriggers();
      body();
    } finally {
      restore();
    }
  }

  it("keeps an instance check React Native's Element defines for itself", async () => {
    const marked = { reactNative: true };
    class Element {
      static [Symbol.hasInstance](value: unknown) {
        return value === marked;
      }
    }
    class TextElement extends Element {}
    await installedOver('own-instance-check', { Element }, () => {
      const node = new Engine(createFakeFabric(), 1).createElement('view');
      assert.equal(node instanceof Element, true, 'an engine node passes the check');
      assert.equal(marked instanceof Element, true, 'and what React Native counts still does');
      assert.equal({} instanceof Element, false);
      assert.equal(node instanceof TextElement, false, 'a subclass is not widened to engine nodes');
    });
  });

  it("hands every target but an engine node to React Native's observer, made once", async () => {
    const made: { args: unknown[]; calls: [string, unknown?][] }[] = [];
    class NativeObserver {
      private readonly calls: [string, unknown?][] = [];
      constructor(...args: unknown[]) {
        made.push({ args, calls: this.calls });
      }
      observe(target: unknown) {
        this.calls.push(['observe', target]);
      }
      unobserve(target: unknown) {
        this.calls.push(['unobserve', target]);
      }
      disconnect() {
        this.calls.push(['disconnect']);
      }
    }
    await installedOver('native-observer', { IntersectionObserver: NativeObserver }, () => {
      const Observer = (globalThis as Record<string, unknown>)[
        'IntersectionObserver'
      ] as typeof EngineIntersectionObserver;
      const callback = () => {};
      const options = { threshold: 0.5 };
      const observer = new Observer(callback, options);

      const engine = new Engine(createFakeFabric(), 1);
      const node = engine.createElement('view');
      observer.observe(node);
      observer.unobserve(node);
      assert.equal(made.length, 0, 'an engine node is watched without one');

      const [first, second] = [{ id: 1 }, { id: 2 }];
      observer.observe(first as never);
      observer.observe(second as never);
      observer.unobserve(first as never);
      observer.disconnect();
      assert.equal(made.length, 1);
      assert.deepEqual(made[0]!.args, [callback, options], 'made with what the observer was');
      assert.deepEqual(made[0]!.calls, [
        ['observe', first],
        ['observe', second],
        ['unobserve', first],
        ['disconnect'],
      ]);
    });
  });
});

describe('a seeded install, once it is over', () => {
  it('leaves the Element it found, and its instance check, as they were', async () => {
    const scope = globalThis as Record<string, unknown>;
    const element = scope['Element'] as object | undefined;
    const check = element && Object.getOwnPropertyDescriptor(element, Symbol.hasInstance);
    const restore = snapshotGlobals();
    try {
      const fresh = '../fabric/src/defer-triggers.ts?leaves-globals';
      const { installDeferTriggers } = await import(fresh);
      installDeferTriggers();
    } finally {
      restore();
    }
    assert.equal(scope['Element'], element);
    if (element) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(element, Symbol.hasInstance), check);
    }
  });
});
