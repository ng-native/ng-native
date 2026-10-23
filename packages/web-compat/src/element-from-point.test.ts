/**
 * `document.elementFromPoint` and `elementsFromPoint`: the element drawn at a point, by the
 * frames native laid out (set by hand here: nothing is laid out under Node), passing over what
 * takes no touches or is not drawn.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, Renderer2, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees: loosely typed, as its own code would be against the DOM. */
type Dom = any;
type Frame = { x: number; y: number; width: number; height: number };

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly renderer = inject(Renderer2);
}

const globals = globalThis as Dom;
let made = 0;

/** An empty page, and a way to say where native laid an element out. */
async function page(providers = [provideWebCompat()]) {
  const app = await render(Page, {
    providers,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const document = globals.document as Dom;
  const place = (element: Dom, frame: Frame) => {
    if (!element.getAttribute('nativeID')) element.setAttribute('nativeID', `p${made++}`);
    app.fabric.frames.set(element.getAttribute('nativeID'), frame);
  };
  const div = (parent: Dom = document.body, style = '') => {
    const element = app.instance.renderer.createElement('div');
    for (const declaration of style.split(';').filter(Boolean)) {
      const [property = '', value = ''] = declaration.split(':');
      element.style.setProperty(property.trim(), value.trim());
    }
    parent.appendChild(element);
    return element;
  };
  return { app, document, place, div };
}

/** Whether two nodes are one: compared so a failure prints no tree. */
const same = (actual: unknown, expected: unknown, message = 'the same node') =>
  assert.equal(actual === expected, true, message);

describe('elementFromPoint', () => {
  it('needs both numbers, is nothing outside the window, and the page where nothing is', async () => {
    const { document, place, div } = await page();
    const box = div();
    await settle();
    place(box, { x: 10, y: 10, width: 20, height: 20 });
    assert.throws(() => document.elementFromPoint(), TypeError);
    assert.throws(() => document.elementFromPoint(0, Number.POSITIVE_INFINITY), TypeError);
    same(document.elementFromPoint(-1, 5), null);
    same(document.elementFromPoint(5, 900), null);
    // The window's far edge is past it, as a browser has it.
    same(document.elementFromPoint(400, 5), null);
    same(document.elementFromPoint(5, 800), null);
    same(document.elementFromPoint(15, 15), box);
    same(document.elementFromPoint(300, 300), document.documentElement);
    assert.equal(document.elementsFromPoint(-1, 5).length, 0);
  });

  it('answers the deepest element at the point, and the later of two beside each other', async () => {
    const { document, place, div } = await page();
    const outer = div();
    const inner = div(outer);
    const first = div();
    const second = div();
    await settle();
    place(outer, { x: 0, y: 0, width: 100, height: 100 });
    place(inner, { x: 10, y: 10, width: 20, height: 20 });
    place(first, { x: 200, y: 0, width: 50, height: 50 });
    place(second, { x: 200, y: 0, width: 50, height: 50 });
    same(document.elementFromPoint(15, 15), inner);
    same(document.elementFromPoint(50, 50), outer);
    same(document.elementFromPoint(210, 10), second);
    // The far edge is outside the box, as in a browser.
    same(document.elementFromPoint(100, 50), document.documentElement);
  });

  it('lists every element at the point, the topmost first and the body and page last', async () => {
    const { document, place, div } = await page();
    const outer = div();
    const inner = div(outer);
    await settle();
    place(outer, { x: 0, y: 0, width: 100, height: 100 });
    place(inner, { x: 10, y: 10, width: 20, height: 20 });
    const all = document.elementsFromPoint(15, 15);
    assert.equal(all.length, 4);
    same(all[0], inner);
    same(all[1], outer);
    same(all[2], document.body);
    same(all[3], document.documentElement);
  });

  it('passes over an element that is not drawn, with what it holds', async () => {
    const { document, place, div } = await page();
    const under = div();
    const hidden = div(undefined, 'display: none');
    const held = div(hidden);
    await settle();
    place(under, { x: 0, y: 0, width: 50, height: 50 });
    place(hidden, { x: 0, y: 0, width: 50, height: 50 });
    place(held, { x: 0, y: 0, width: 50, height: 50 });
    same(document.elementFromPoint(10, 10), under);
    assert.equal(document.elementsFromPoint(10, 10).includes(held), false);
  });

  it('passes over what takes no touches, and over the box alone where what it holds does', async () => {
    const { document, place, div } = await page();
    const under = div();
    const over = div();
    over.style.setProperty('pointer-events', 'none');
    const wrapper = div();
    wrapper.setAttribute('pointerEvents', 'box-none');
    const child = div(wrapper);
    await settle();
    place(under, { x: 0, y: 0, width: 50, height: 50 });
    place(over, { x: 0, y: 0, width: 50, height: 50 });
    same(document.elementFromPoint(10, 10), under);
    place(wrapper, { x: 100, y: 0, width: 50, height: 50 });
    place(child, { x: 110, y: 10, width: 10, height: 10 });
    same(document.elementFromPoint(115, 15), child);
    same(
      document.elementFromPoint(140, 40),
      document.documentElement,
      'the wrapper alone is not hit',
    );
    // One that takes touches itself, and none of what it holds, is hit over its child.
    const shell = div();
    shell.setAttribute('pointerEvents', 'box-only');
    const inner = div(shell);
    await settle();
    place(shell, { x: 200, y: 0, width: 50, height: 50 });
    place(inner, { x: 210, y: 10, width: 10, height: 10 });
    same(document.elementFromPoint(215, 15), shell, 'the box, not what it holds');
  });

  it('passes over what a stylesheet says takes no touches, as one written on it is', async () => {
    const { document, place, div } = await page();
    const sheet = document.createElement('style');
    sheet.textContent = '.through { pointer-events: none }';
    document.head.appendChild(sheet);
    const under = div();
    const over = div();
    over.className = 'through';
    await settle();
    place(under, { x: 0, y: 0, width: 50, height: 50 });
    place(over, { x: 0, y: 0, width: 50, height: 50 });
    same(document.elementFromPoint(10, 10), under);
  });

  it('finds what takes touches again inside a box that a style says takes none', async () => {
    const { document, place, div } = await page();
    const over = div(undefined, 'pointer-events: none');
    const opened = div(over, 'pointer-events: auto');
    await settle();
    place(over, { x: 0, y: 0, width: 50, height: 50 });
    place(opened, { x: 10, y: 10, width: 10, height: 10 });
    same(document.elementFromPoint(15, 15), opened);
    same(document.elementFromPoint(40, 40), document.documentElement, 'the box itself is not hit');
    assert.equal(document.elementsFromPoint(15, 15).includes(over), false);
  });

  it('passes over what is outside a box that clips what overflows it', async () => {
    const { document, place, div } = await page();
    const clipping = div(undefined, 'overflow: hidden');
    const out = div(clipping);
    const open = div();
    const past = div(open);
    await settle();
    place(clipping, { x: 0, y: 0, width: 50, height: 50 });
    place(out, { x: 60, y: 0, width: 20, height: 20 });
    place(open, { x: 0, y: 100, width: 50, height: 50 });
    place(past, { x: 60, y: 100, width: 20, height: 20 });
    same(document.elementFromPoint(70, 10), document.documentElement, 'clipped away');
    same(document.elementFromPoint(70, 110), past, 'drawn past a box that does not clip');
  });

  it('lists no body that is not drawn, or that takes no touches', async () => {
    const { document } = await page();
    document.body.style.setProperty('display', 'none');
    await settle();
    assert.equal(document.elementsFromPoint(10, 10).includes(document.body), false);
    document.body.style.setProperty('display', 'flex');
    document.body.style.setProperty('pointer-events', 'none');
    await settle();
    assert.equal(document.elementsFromPoint(10, 10).includes(document.body), false);
  });

  it('is on the document only while an app that asked for the package is up', async () => {
    const { document } = await page();
    assert.equal(typeof document.elementFromPoint, 'function');
    assert.equal(typeof document.elementsFromPoint, 'function');
    cleanup();
    assert.equal(globals.document?.elementFromPoint, undefined);
  });

  it('is not on the document of an app that did not ask for the package', async () => {
    await page([]);
    assert.equal(globals.document?.elementFromPoint, undefined);
    assert.equal(globals.document?.elementsFromPoint, undefined);
  });
});
