/**
 * The fingers a touch event lists: `touches`, every finger down; `changedTouches`, the ones the
 * event is of; and `targetTouches`, the fingers down that came down on what the event is sent
 * to. CDK's drag and drop reads where in an element a drag starts from `targetTouches[0]`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({
  template: `<div id="one" testID="one"></div>
    <div id="two" testID="two"></div>`,
})
class Page {}

const page = async () => {
  await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  /** A finger, by its number, on the element whose test id is given. */
  const at = (identifier: number, testID: string, pageX: number) => ({
    identifier,
    target: screen.getByTestId(testID).reactTag,
    pageX,
    pageY: 10,
  });
  /** What a listener on an element reads of each list: the place across of each finger in it. */
  const heard: Record<string, number[]>[] = [];
  const hear = (event: Dom) => {
    const places = (list: Dom) => [...list].map((touch: Dom) => touch.pageX);
    heard.push({
      touches: places(event.touches),
      targetTouches: places(event.targetTouches),
      changedTouches: places(event.changedTouches),
    });
  };
  for (const type of ['touchstart', 'touchend']) {
    document.getElementById('one').addEventListener(type, hear);
    document.getElementById('two').addEventListener(type, hear);
  }
  return { at, heard };
};

describe('@ng-native/web-compat, the fingers a touch event lists', () => {
  it('lists the finger that came down on the element as on its target', async () => {
    const { at, heard } = await page();
    const finger = at(0, 'one', 30);
    await fireEvent(screen.getByTestId('one'), 'topTouchStart', {
      ...finger,
      touches: [finger],
      changedTouches: [finger],
    });
    assert.deepEqual(heard, [{ touches: [30], targetTouches: [30], changedTouches: [30] }]);
  });

  it('lists the one finger down as on the target where it does not say what it is on', async () => {
    // A touch this package or a test sends, with a target for the event and none for its finger.
    const { at, heard } = await page();
    const { target, ...finger } = at(0, 'one', 30);
    await fireEvent(screen.getByTestId('one'), 'topTouchStart', {
      ...finger,
      target,
      touches: [finger],
      changedTouches: [finger],
    });
    assert.deepEqual(heard[0]?.['targetTouches'], [30]);
  });

  it('lists only the fingers on the target, and none that has lifted', async () => {
    const { at, heard } = await page();
    const [first, second] = [at(0, 'one', 30), at(1, 'two', 70)];
    await fireEvent(screen.getByTestId('two'), 'topTouchStart', {
      ...second,
      touches: [first, second],
      changedTouches: [second],
    });
    await fireEvent(screen.getByTestId('two'), 'topTouchEnd', {
      ...second,
      touches: [first],
      changedTouches: [second],
    });
    assert.deepEqual(heard, [
      { touches: [30, 70], targetTouches: [70], changedTouches: [70] },
      { touches: [30], targetTouches: [], changedTouches: [70] },
    ]);
  });
});
