/**
 * A press inside a list that is being scrolled.
 *
 * `press-tolerance.test.ts` settles how far a finger may wander during a tap, and the answer is
 * the control's own bounds plus a retention offset - which is right, and on a 72pt list row means
 * a 72pt drag still counts as a tap. A 72pt drag is a scroll.
 *
 * Distance cannot tell these apart on a large control, and it should not have to: the scroll view
 * knows it is scrolling. Every platform cancels the touch at that moment, and so does this.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a press in a list that scrolls', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: { taps: () => number };

  before(async () => {
    const mod = await compileFixture('fixtures/scroll-press.ts');
    Component = mod['ScrollPress'] as Type<unknown>;
  });

  beforeEach(async () => {
    const rendered = await render(Component);
    fabric = rendered.fabric;
    host = rendered.instance as typeof host;
    // The row's own size, which is what the press rect is measured against. Without it the
    // pressable falls back to a small fixed distance and every one of these tests would pass for
    // the wrong reason - a 30pt drag would cancel on distance alone, which on a device it does not.
    fabric.emit(node('row'), 'topLayout', { layout: { x: 0, y: 0, width: 360, height: 72 } });
    await settle();
  });

  afterEach(() => cleanup());

  const node = (id: string) => screen.getByTestId(id);
  const at = (y: number) => ({ pageX: 10, pageY: y });
  const touch = (id: string, type: string, y: number) =>
    fabric.emit(node(id), type, { touches: [at(y)], changedTouches: [at(y)], ...at(y) });
  const scroll = () =>
    fabric.emit(node('list'), 'topScroll', {
      contentOffset: { x: 0, y: 40 },
      contentSize: { width: 100, height: 900 },
      layoutMeasurement: { width: 100, height: 400 },
    });

  it('fires an ordinary tap', async () => {
    touch('row', 'topTouchStart', 100);
    touch('row', 'topTouchEnd', 100);
    await settle();
    assert.equal(host.taps(), 1);
  });

  it('does not fire when the list scrolled under the finger', async () => {
    // The report this came from: the catalogue navigated when you meant to scroll it. The finger
    // moved less than the row is tall, so the press rect never noticed.
    touch('row', 'topTouchStart', 100);
    scroll();
    touch('row', 'topTouchMove', 70);
    touch('row', 'topTouchEnd', 70);
    await settle();
    assert.equal(host.taps(), 0);
  });

  it('still fires the next tap, once the scroll is over', async () => {
    // Cancelling must not leave the row deaf: a list you have scrolled is a list you are about to
    // tap something in.
    touch('row', 'topTouchStart', 100);
    scroll();
    touch('row', 'topTouchEnd', 100);
    await settle();

    touch('row', 'topTouchStart', 100);
    touch('row', 'topTouchEnd', 100);
    await settle();
    assert.equal(host.taps(), 1);
  });

  it('ignores a scroll with no touch in progress', async () => {
    // Momentum after the finger has lifted, and programmatic scrolling. Neither should reach into
    // a responder that is not there.
    scroll();
    await settle();
    touch('row', 'topTouchStart', 100);
    touch('row', 'topTouchEnd', 100);
    await settle();
    assert.equal(host.taps(), 1);
  });
});
