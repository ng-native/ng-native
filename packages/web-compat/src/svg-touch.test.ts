/**
 * A touch on a drawing: which of its shapes native finds under a finger, the shape a touch native
 * finds none for is taken to be on, and the mouse a touch on one is.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({ template: `<div id="box"></div>` })
class Page {}

const SVG = 'http://www.w3.org/2000/svg';

const drawing = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  const box = document.getElementById('box');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '100');
  svg.setAttribute('viewBox', '0 0 200 100');
  box.appendChild(svg);
  const shape = (name: string, attributes: Record<string, string | number> = {}, into = svg) => {
    const made = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) made.setAttribute(key, String(value));
    into.appendChild(made);
    return made;
  };
  const view = (element: unknown): FakeFabricNode | undefined => {
    const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const node of nodes) {
        if (node.instanceHandle === element) return node;
        const inside = find(node.children);
        if (inside) return inside;
      }
      return undefined;
    };
    return find(app.fabric.committed);
  };
  /** Whether native is told the shape takes a touch, as it was last committed. */
  const takes = async (...elements: unknown[]) => {
    await settle();
    return elements.map((element) => view(element)?.props['responsible'] === true);
  };
  /**
   * A finger down and up at a place in the drawing, which native found on `on`: the drawing
   * itself where it found no shape.
   */
  const tap = async (x: number, y: number, on: unknown = svg, cancel = false) => {
    await settle();
    const frame = svg.getBoundingClientRect();
    const node = view(on)!;
    const point = { identifier: 0, target: node.reactTag, pageX: frame.x + x, pageY: frame.y + y };
    const prevent = (event: Dom) => event.preventDefault();
    if (cancel) svg.addEventListener('touchstart', prevent);
    app.fabric.emit(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] });
    svg.removeEventListener('touchstart', prevent);
    await Promise.resolve();
    app.fabric.emit(node, 'topTouchEnd', { ...point, touches: [], changedTouches: [point] });
    await new Promise((done) => setTimeout(done, 5));
  };
  return { app, document, box, svg, shape, view, takes, tap };
};

describe('@ng-native/web-compat, the shapes of a drawing that take a touch', () => {
  it('are those with a listener for one, for as long as it listens', async () => {
    const { shape, takes } = await drawing();
    const heard = shape('rect', { width: 10, height: 10 });
    const deaf = shape('rect', { x: 20, width: 10, height: 10 });
    const listener = () => {};
    heard.addEventListener('click', listener);
    assert.deepEqual(await takes(heard, deaf), [true, false]);
    // A second listener, and one of the two taken off: it still listens.
    heard.addEventListener('touchstart', listener);
    heard.removeEventListener('click', listener);
    assert.deepEqual(await takes(heard), [true]);
    heard.removeEventListener('touchstart', listener);
    assert.deepEqual(await takes(heard), [false], 'and not once nothing listens');
    // The mouse a touch sends is a listener for one too: see the hover below.
    deaf.addEventListener('mouseover', listener);
    assert.deepEqual(await takes(deaf), [true]);
  });

  it('are those under a group or a drawing that listens, put there before or after', async () => {
    const { svg, shape, takes } = await drawing();
    const group = shape('g');
    const column = shape('path', { d: 'M0 0 L5 5' }, group);
    const listener = () => {};
    group.addEventListener('touchstart', listener);
    const later = shape('path', { d: 'M0 0 L5 5' }, group);
    assert.deepEqual(await takes(group, column, later), [true, true, true]);
    // Out of the group, it is under nothing that listens.
    svg.appendChild(later);
    assert.deepEqual(await takes(later), [false]);
    group.removeEventListener('touchstart', listener);
    assert.deepEqual(await takes(group, column), [false, false]);
    // The drawing itself listening, every shape in it takes a touch, and none once it stops.
    svg.addEventListener('click', listener);
    assert.deepEqual(await takes(group, column, later), [true, true, true]);
    svg.removeEventListener('click', listener);
    assert.deepEqual(await takes(group, column, later), [false, false, false]);
  });

  it('keep taking a touch under a group that listens of their own, once it stops', async () => {
    const { shape, takes } = await drawing();
    const group = shape('g');
    const column = shape('rect', { width: 5, height: 5 }, group);
    const [own, above] = [() => {}, () => {}];
    column.addEventListener('click', own);
    group.addEventListener('click', above);
    group.removeEventListener('click', above);
    assert.deepEqual(await takes(group, column), [false, true]);
  });
});

describe('@ng-native/web-compat, a touch native finds no shape for', () => {
  it('is on the shape whose box is under the finger, in what listens', async () => {
    // Native finds a text under a finger by the ink of its letters, where a browser finds it by
    // their boxes: a tap on a legend item between two letters lands on the drawing.
    const { svg, shape, tap } = await drawing();
    const item = shape('g', { transform: 'translate(10,0)' });
    const label = shape('text', { x: 10, y: 20 }, item);
    label.textContent = 'Oslo';
    const heard: string[] = [];
    item.addEventListener('click', (event: Dom) => heard.push(`item ${event.target === label}`));
    svg.addEventListener('click', () => heard.push('drawing'));
    await tap(30, 15);
    assert.deepEqual(heard, ['item true', 'drawing']);
    heard.length = 0;
    await tap(150, 80);
    assert.deepEqual(heard, ['drawing'], 'and on the drawing away from it');
  });

  it('is on the drawing where what is under the finger does not listen', async () => {
    const { svg, shape, tap } = await drawing();
    shape('rect', { width: 50, height: 50 });
    const heard: unknown[] = [];
    svg.addEventListener('click', (event: Dom) => heard.push(event.target === svg));
    await tap(10, 10);
    assert.deepEqual(heard, [true]);
  });
});

describe('@ng-native/web-compat, the mouse a touch on a drawing is', () => {
  const scene = async () => {
    const made = await drawing();
    const { box, svg, shape } = made;
    const [a, b] = ['a', 'b'].map((id, i) => {
      const rect = shape('rect', { id, x: i * 50, width: 40, height: 40 });
      rect.addEventListener('touchstart', () => {});
      return rect;
    });
    const heard: string[] = [];
    const name = (node: Dom) => node.id || node.localName;
    for (const type of ['mouseover', 'mouseout']) {
      svg.addEventListener(type, (event: Dom) =>
        heard.push(`${type} ${name(event.target)} ${event.relatedTarget?.id ?? '-'}`),
      );
    }
    for (const node of [box, svg, a, b]) {
      for (const type of ['mouseenter', 'mouseleave']) {
        node.addEventListener(type, (event: Dom) => heard.push(`${type} ${name(event.target)}`));
      }
    }
    return { ...made, a, b, heard };
  };

  it('goes over the shape a finger comes down on, and into what it is in', async () => {
    const { a, tap, heard } = await scene();
    await tap(10, 10, a);
    assert.deepEqual(heard, ['mouseover a -', 'mouseenter box', 'mouseenter svg', 'mouseenter a']);
    heard.length = 0;
    await tap(12, 12, a);
    assert.deepEqual(heard, [], 'and stays there for the next touch on it');
  });

  it('goes out of it to the next shape a finger comes down on', async () => {
    const { a, b, tap, heard } = await scene();
    await tap(10, 10, a);
    heard.length = 0;
    await tap(60, 10, b);
    assert.deepEqual(heard, ['mouseout a b', 'mouseleave a', 'mouseover b a', 'mouseenter b']);
  });

  it('stays over the shape as the finger lifts, and leaves for a touch anywhere else', async () => {
    // As a phone's browser has it: a chart's tooltip stays up for the point tapped.
    const { app, a, tap, heard } = await scene();
    await tap(10, 10, a);
    heard.length = 0;
    const elsewhere = app.fabric.committed[0]!;
    const point = { identifier: 0, target: elsewhere.reactTag, pageX: 500, pageY: 500 };
    app.fabric.emit(elsewhere, 'topTouchStart', { ...point, touches: [point] });
    await Promise.resolve();
    assert.deepEqual(heard, ['mouseout a -', 'mouseleave a', 'mouseleave svg', 'mouseleave box']);
  });

  it('goes nowhere for a touch a listener cancels', async () => {
    // A chart's drag handle cancels its touch: the mouse going out of the column under it hid
    // the handle mid-drag.
    const { a, b, tap, heard } = await scene();
    await tap(10, 10, a);
    heard.length = 0;
    await tap(60, 10, b, true);
    assert.deepEqual(heard, []);
  });

  it('finds the shape under the finger in a view box of another shape than the drawing', async () => {
    // A square view box in a drawing twice as wide is drawn centred, at one scale, as native and
    // a browser both draw it: the shape at x 0 to 40 is 50 to 90 points across.
    const { app, svg, tap, heard } = await scene();
    svg.setAttribute('nativeID', 'art');
    app.fabric.frames.set('art', { x: 0, y: 0, width: 200, height: 100 });
    svg.setAttribute('viewBox', '0 0 100 100');
    await tap(85, 10);
    assert.equal(heard[0], 'mouseover a -');
  });

  it('reads a view box written with spaces and commas about it, as the drawing does', async () => {
    const { app, svg, tap, heard } = await scene();
    svg.setAttribute('nativeID', 'art');
    app.fabric.frames.set('art', { x: 0, y: 0, width: 200, height: 100 });
    svg.setAttribute('viewBox', ' 0, 0, 100, 100 ');
    await tap(85, 10);
    assert.equal(heard[0], 'mouseover a -');
  });

  it('finds it by each side scaled alone where the drawing says its aspect is none', async () => {
    const { app, svg, tap, heard } = await scene();
    svg.setAttribute('nativeID', 'art');
    app.fabric.frames.set('art', { x: 0, y: 0, width: 200, height: 100 });
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    await tap(20, 10);
    assert.equal(heard[0], 'mouseover a -');
  });

  it('goes over the shape whose box is under the finger, where native found none', async () => {
    const { tap, heard } = await scene();
    await tap(60, 10);
    assert.equal(heard[0], 'mouseover b -');
  });
});

describe('@ng-native/web-compat, a drawing in an app that is gone', () => {
  it('leaves the engine to find what a touch is on by itself', async () => {
    const { svg } = await drawing();
    const engine = svg.engine;
    assert.notEqual(engine.retarget, null, 'while the app is up');
    cleanup();
    assert.equal(engine.retarget, null);
  });
});
