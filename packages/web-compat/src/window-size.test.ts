/**
 * The window a library places an overlay in: as far down as the top of the keyboard while that
 * is up, as a browser on a phone ends its window there, and from under the navigation header of
 * the screen in sight, which is over the top of the screen. `innerHeight` and `visualViewport`
 * say so, a `resize` listener is told of each change, and the body, where an overlay's container
 * goes, is drawn over just that part of the screen, with what is `fixed` in it fixed to it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, Renderer2, inject } from '@angular/core';
import { Keyboard, type KeyboardMetrics } from '@ng-native/device';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees: loosely typed, as its own code would be against the DOM. */
type Dom = any;

const globals = globalThis as Dom;

@Component({ selector: 'x-page', template: '<div testID="card"></div>' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
  readonly renderer = inject(Renderer2);
}

afterEach(cleanup);

const SIZE = { width: 390, height: 844, colorScheme: 'light' as const };

/** An app that asked for the package, with a keyboard the test moves. */
async function page(providers: unknown[] = [provideWebCompat()]) {
  let move: (metrics: KeyboardMetrics) => void = () => {};
  let listening = false;
  const source = {
    subscribe: (listener: typeof move) => {
      move = listener;
      listening = true;
      return () => void (listening = false);
    },
    dismiss: () => {},
  };
  const app = await render(Page, {
    providers: [...(providers as never[]), { provide: Keyboard.SOURCE, useValue: source }],
    conditions: SIZE,
  });
  await settle();
  const engine = app.componentRef.injector.get(Engine);
  const { document, renderer } = app.instance;
  /** The keyboard moves, as the platform says it does, and change detection has run. */
  const keyboard = async (metrics: KeyboardMetrics) => {
    move(metrics);
    await settle();
  };
  /** A screen of a stack, as the router makes one, in the page. */
  const stackScreen = async () => {
    const node: EngineNode = renderer.createElement('screen');
    renderer.setAttribute(node, 'testID', 'screen');
    renderer.appendChild(engine.root, node);
    await settle();
    return node;
  };
  const header = (height: number) =>
    app.fabric.emit(screenView(), 'topHeaderHeightChange', { headerHeight: height });
  // Committed first: a screen a test puts in with the renderer is put on screen by the next
  // commit, which `settle()` stops waiting for after a few frames on a busy machine.
  const screenView = (): FakeFabricNode => {
    engine.commit();
    return screen.getByTestId('screen', { includeHiddenElements: true });
  };
  /** How many times a resize listener on the window, and one on the visual viewport, is told. */
  const told = { window: 0, viewport: 0 };
  const onWindow = () => void told.window++;
  const onViewport = () => void told.viewport++;
  globals.addEventListener('resize', onWindow);
  globals.visualViewport.addEventListener('resize', onViewport);
  const stopListening = () => {
    globals.removeEventListener('resize', onWindow);
    globals.visualViewport.removeEventListener('resize', onViewport);
  };
  const bodyStyle = () => {
    engine.commit();
    const { top, bottom } = document.body.props.style;
    return { top, bottom };
  };
  return {
    app,
    engine,
    document,
    keyboard,
    stackScreen,
    header,
    told,
    stopListening,
    bodyStyle,
    listening: () => listening,
  };
}

describe('the window and the keyboard', () => {
  it('ends at the top of the keyboard while it is up, and tells a resize listener once', async () => {
    const s = await page();
    try {
      await s.keyboard({ height: 336, screenY: 508 });
      assert.equal(globals.innerHeight, 508);
      assert.equal(globals.visualViewport.height, 508);
      assert.equal(s.document.documentElement.clientHeight, 508);
      assert.equal(s.document.documentElement.getBoundingClientRect().bottom, 508);
      assert.equal(globals.innerWidth, 390);
      // The screen is not shortened by it.
      assert.equal(globals.screen.height, 844);
      assert.deepEqual(s.told, { window: 1, viewport: 1 });
      // The body ends there too: what is placed from its bottom edge is placed from the keyboard.
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 336 });
      // Said again where it is, it has not moved.
      await s.keyboard({ height: 336, screenY: 508 });
      assert.deepEqual(s.told, { window: 1, viewport: 1 });
      await s.keyboard({ height: 0 });
      assert.equal(globals.innerHeight, 844);
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 0 });
      assert.deepEqual(s.told, { window: 2, viewport: 2 });
    } finally {
      s.stopListening();
    }
  });

  it('takes the top of the keyboard from its height where the platform does not say it', async () => {
    const s = await page();
    try {
      await s.keyboard({ height: 300 });
      assert.equal(globals.innerHeight, 544);
    } finally {
      s.stopListening();
    }
  });

  it('tells no listener once it has stopped listening', async () => {
    const s = await page();
    s.stopListening();
    await s.keyboard({ height: 336, screenY: 508 });
    assert.deepEqual(s.told, { window: 0, viewport: 0 });
  });

  it('lets go of the keyboard when the app is destroyed', async () => {
    const s = await page();
    s.stopListening();
    assert.equal(s.listening(), true);
    s.app.unmount();
    assert.equal(s.listening(), false);
    assert.equal(globals.innerHeight, undefined);
  });
});

describe('the window and the navigation header', () => {
  it('starts under the header of the screen in sight, and tells a resize listener', async () => {
    const s = await page();
    try {
      const node = await s.stackScreen();
      assert.deepEqual(s.told, { window: 0, viewport: 0 }, 'a screen with no header yet');
      s.header(100);
      assert.equal(globals.innerHeight, 744);
      assert.equal(globals.visualViewport.height, 744);
      assert.deepEqual(s.bodyStyle(), { top: 100, bottom: 0 });
      assert.deepEqual(s.told, { window: 1, viewport: 1 });
      s.header(100);
      assert.deepEqual(s.told, { window: 1, viewport: 1 }, 'the same header again');
      // And over the keyboard as well.
      await s.keyboard({ height: 336, screenY: 508 });
      assert.equal(globals.innerHeight, 408);
      assert.deepEqual(s.bodyStyle(), { top: 100, bottom: 336 });
      await s.keyboard({ height: 0 });
      // The screen goes, and its header with it.
      s.app.instance.renderer.removeChild(s.engine.root, node);
      await settle();
      assert.equal(globals.innerHeight, 844);
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 0 });
      assert.deepEqual(s.told, { window: 4, viewport: 4 });
    } finally {
      s.stopListening();
    }
  });

  it('starts at the top under a screen with no header put in over one with a header', async () => {
    const s = await page();
    try {
      await s.stackScreen();
      s.header(100);
      assert.deepEqual(s.bodyStyle(), { top: 100, bottom: 0 });
      // Made apart and put in after, as a component that holds a screen is.
      const { renderer } = s.app.instance;
      const next: EngineNode = renderer.createElement('screen');
      assert.deepEqual(s.bodyStyle(), { top: 100, bottom: 0 }, 'not in the page yet');
      renderer.appendChild(s.engine.root, next);
      await settle();
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 0 });
    } finally {
      s.stopListening();
    }
  });

  it('starts at the top again when a screen goes with what it is in', async () => {
    const s = await page();
    try {
      const { renderer } = s.app.instance;
      const stack: EngineNode = renderer.createElement('view');
      renderer.appendChild(s.engine.root, stack);
      const node: EngineNode = renderer.createElement('screen');
      renderer.setAttribute(node, 'testID', 'screen');
      renderer.appendChild(stack, node);
      await settle();
      s.header(100);
      assert.deepEqual(s.bodyStyle(), { top: 100, bottom: 0 });
      renderer.removeChild(s.engine.root, stack);
      assert.equal(globals.innerHeight, 844);
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 0 });
      assert.deepEqual(s.told, { window: 2, viewport: 2 });
    } finally {
      s.stopListening();
    }
  });

  it('says where an element and a touch are from the top of the window', async () => {
    const s = await page();
    try {
      await s.stackScreen();
      s.header(100);
      const card = s.document.querySelector('[testID="card"]');
      card.setAttribute('nativeID', 'card');
      await settle();
      s.app.fabric.frames.set('card', { x: 10, y: 150, width: 50, height: 40 });
      assert.equal(card.getBoundingClientRect().top, 50);
      const heard: number[] = [];
      card.addEventListener('pointerdown', (event: Dom) => heard.push(event.clientY));
      s.document.addEventListener('pointerdown', (event: Dom) => heard.push(event.clientY));
      const point = { identifier: 0, pageX: 20, pageY: 160 };
      s.app.fabric.emit(screen.getByTestId('card'), 'topTouchStart', {
        ...point,
        touches: [point],
        changedTouches: [point],
      });
      await settle();
      assert.deepEqual(heard, [60, 60]);
    } finally {
      s.stopListening();
    }
  });
});

describe('the window on Android, drawn edge to edge', () => {
  it('is as tall as the body is drawn when the keyboard first comes up, unread until then', async () => {
    const s = await page();
    try {
      s.document.body.id = 'body';
      await settle();
      s.app.fabric.frames.set('body', { x: 0, y: 0, width: 390, height: 900 });
      await s.keyboard({ height: 200, screenY: 700 });
      assert.equal(globals.innerHeight, 700);
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 200 }, 'from the foot of the body');
    } finally {
      s.stopListening();
    }
  });

  it('is as tall as the body is drawn, where that is taller than the app was told', async () => {
    // Android tells the app of the height between the status bar and the gesture bar, and draws
    // it under both.
    const s = await page();
    try {
      s.document.body.id = 'body';
      await settle();
      s.app.fabric.frames.set('body', { x: 0, y: 0, width: 390, height: 900 });
      assert.equal(globals.innerHeight, 900);
      // Measured again once the window is another size: the device turned.
      s.app.fabric.frames.set('body', { x: 0, y: 0, width: 900, height: 420 });
      s.engine.updateConditions({ ...SIZE, width: 900, height: 390 });
      assert.equal(globals.innerHeight, 420);
      // And where the keyboard comes up, it ends there.
      await s.keyboard({ height: 200, screenY: 220 });
      assert.equal(globals.innerHeight, 220);
      assert.deepEqual(s.bodyStyle(), { top: 0, bottom: 200 });
    } finally {
      s.stopListening();
    }
  });
});

describe('the body', () => {
  it('is the page of what is fixed in it', async () => {
    // What is fixed in a box that clips is committed under its page, out of the box's reach.
    const s = await page();
    try {
      const clip = s.document.createElement('div');
      clip.setAttribute('style', 'overflow: hidden');
      const fixed = s.document.createElement('div');
      fixed.setAttribute('testID', 'fixed');
      fixed.setAttribute('style', 'position: fixed; top: 0; left: 0');
      clip.appendChild(fixed);
      s.document.body.appendChild(clip);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await settle();
      const isUnderBody = (node: FakeFabricNode | null | undefined): boolean => {
        for (let up = node; up; up = up.parent) if (up.props['zIndex'] === 1_000_000) return true;
        return false;
      };
      assert.equal(isUnderBody(screen.getByTestId('fixed', { includeHiddenElements: true })), true);
    } finally {
      s.stopListening();
    }
  });
});

describe('an app that did not ask for the package', () => {
  it('does not hear a header', async () => {
    const app = await render(Page, { conditions: SIZE });
    const engine = app.componentRef.injector.get(Engine);
    const node: EngineNode = app.instance.renderer.createElement('screen');
    app.instance.renderer.appendChild(engine.root, node);
    await settle();
    assert.equal(node.listeners?.get('topHeaderHeightChange'), undefined);
    assert.equal(globals.innerHeight, undefined);
  });
});
