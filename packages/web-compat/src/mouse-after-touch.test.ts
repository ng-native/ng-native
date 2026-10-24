/**
 * The mouse events a touch is told as: as the finger goes down and up where the page hears only
 * the mouse, and after the touch, for a tap alone, where it hears the touch as well.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({
  template: `<div id="outer">
    <div id="pad" testID="pad"></div>
    <div id="other" testID="other"></div>
  </div>`,
})
class Page {}

const page = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  const heard: string[] = [];
  const hear = (target: Dom, type: string, name = '') =>
    target.addEventListener(type, () => heard.push(name + type));
  /** Fingers on the pad, or the view `on` names, at these places along it. */
  const sendOn = (on: string, phase: 'Start' | 'Move' | 'End', ...xs: number[]) => {
    const pad = screen.getByTestId(on);
    const touches = xs.map((x, identifier) => ({
      identifier,
      target: pad.reactTag,
      pageX: x,
      pageY: 10,
    }));
    app.fabric.emit(pad, `topTouch${phase}`, {
      ...touches[0],
      touches: phase === 'End' ? [] : touches,
      changedTouches: touches,
    });
  };
  const send = (phase: 'Start' | 'Move' | 'End', ...xs: number[]) => sendOn('pad', phase, ...xs);
  const turn = () => new Promise((done) => setTimeout(done, 5));
  return { document, element: document.getElementById('pad'), heard, hear, send, sendOn, turn };
};

describe('@ng-native/web-compat, the mouse a touch is', () => {
  it('is the mouse going down and up with the finger where nothing hears the touch', async () => {
    const { document, element, heard, hear, send, turn } = await page();
    hear(element, 'mousedown');
    hear(document, 'mouseup', 'document ');
    send('Start', 10);
    assert.deepEqual(heard, ['mousedown'], 'as the finger comes down');
    send('Move', 60);
    send('End', 60);
    await turn();
    assert.deepEqual(heard, ['mousedown', 'document mouseup']);
  });

  it('follows the touch, for a tap, where the page hears the touch too', async () => {
    const { document, element, heard, hear, send, turn } = await page();
    hear(element, 'mousedown');
    hear(element, 'touchstart');
    hear(document, 'mouseup', 'document ');
    hear(document, 'touchend', 'document ');
    send('Start', 10);
    send('End', 12);
    assert.deepEqual(heard, ['touchstart', 'document touchend'], 'no mouse yet');
    await turn();
    assert.deepEqual(heard, ['touchstart', 'document touchend', 'mousedown', 'document mouseup']);
    // And no mouse at all for a drag or a pinch.
    heard.length = 0;
    send('Start', 10);
    send('Move', 80);
    send('End', 80);
    await turn();
    send('Start', 10, 40);
    send('Move', 12, 42);
    send('End', 12, 42);
    await turn();
    assert.deepEqual(heard, ['touchstart', 'document touchend', 'touchstart', 'document touchend']);
  });

  it('is owed by the next touch alone where the end of one never came, its element gone', async () => {
    const { document, element, heard, hear, send, sendOn, turn } = await page();
    const other = document.getElementById('other');
    hear(element, 'mousedown');
    hear(other, 'mousedown', 'other ');
    element.addEventListener('touchstart', () => undefined);
    other.addEventListener('touchstart', () => undefined);
    // The view goes before the finger lifts, so the end of its touch reaches nothing that hears it.
    send('Start', 10);
    element.remove();
    await settle();
    sendOn('other', 'Start', 10);
    sendOn('other', 'End', 10);
    await turn();
    assert.deepEqual(heard, ['other mousedown']);
  });

  it('is told as the finger goes again once nothing hears the touch', async () => {
    const { element, heard, hear, send } = await page();
    hear(element, 'mousedown');
    const touched = () => undefined;
    element.addEventListener('touchstart', touched);
    element.removeEventListener('touchstart', touched);
    send('Start', 10);
    assert.deepEqual(heard, ['mousedown']);
    send('End', 10);
  });

  it('is the mouse with the finger where only the document hears the touch, as a ripple does', async () => {
    const { document, element, heard, hear, send } = await page();
    hear(element, 'mousedown');
    hear(document, 'touchstart', 'document ');
    send('Start', 10);
    assert.deepEqual(heard, ['mousedown', 'document touchstart']);
    send('End', 10);
  });

  it('is told to no listener taken off before it comes, as a dialog closed by the tap takes its own', async () => {
    const { document, element, heard, send, turn } = await page();
    const listeners = [element, document].map((target, at) => {
      const each = (event: Dom) => heard.push(`${at} ${event.type}`);
      for (const type of ['mousedown', 'mouseup']) target.addEventListener(type, each);
      return () => {
        for (const type of ['mousedown', 'mouseup']) target.removeEventListener(type, each);
      };
    });
    element.addEventListener('touchstart', () => undefined);
    send('Start', 10);
    send('End', 10);
    for (const remove of listeners) remove();
    await turn();
    assert.deepEqual(heard, []);
  });

  it('is not heard above an element that stops it, as the drag handle of a chart does', async () => {
    const { document, element, heard, hear, send } = await page();
    element.addEventListener('touchstart', (event: Dom) => event.stopPropagation());
    hear(document.getElementById('outer'), 'touchstart', 'outer ');
    hear(document, 'touchstart', 'document ');
    send('Start', 10);
    assert.deepEqual(heard, []);
    send('End', 10);
  });
});
