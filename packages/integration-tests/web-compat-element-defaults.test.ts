/**
 * A library's HTML elements laid out as a browser lays them out, in an app that asked for
 * web-compat: sized `content-box`, so padding adds to a width or a height, and a block one under
 * the other. The same template in an app that did not ask is laid out as it always was.
 *
 * Laid out by Yoga as a device lays it out. The numbers are Chrome's for the same markup.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { provideWebCompat } from '@ng-native/web-compat';
import { compileFixture } from './compile.ts';
import { layOutFabric } from './laid-out-fabric.ts';

afterEach(cleanup);

let Boxes: Type<unknown>;
before(async () => {
  Boxes = (await compileFixture('fixtures/web-compat-boxes.ts'))['Boxes'] as Type<unknown>;
});

/** Each box's [width, height], laid out, with and without the package. */
async function sizes(providers: Parameters<typeof render>[1] = {}) {
  const { fabric } = await render(Boxes, providers);
  const laidOut = layOutFabric(fabric);
  const size = (id: string) => [laidOut.box(id).width, laidOut.box(id).height];
  return Object.fromEntries(
    ['tall', 'wide', 'fills', 'inside', 'button'].map((id) => [id, size(id)]),
  );
}

describe('a library element laid out in an app that asked for web-compat', () => {
  it('adds its padding and border to its width and height, as a browser does', async () => {
    const laid = await sizes({ providers: [provideWebCompat()] });
    assert.deepEqual(laid['tall'], [400, 200]);
    assert.deepEqual(laid['wide'], [125, 20]);
    // A block with no width fills its container, and its padding is inside that.
    assert.deepEqual(laid['fills'], [400, 40]);
    assert.deepEqual(laid['inside'], [380, 20]);
  });

  it('keeps a button sized whole, its padding inside', async () => {
    const laid = await sizes({ providers: [provideWebCompat()] });
    assert.deepEqual(laid['button'], [100, 40]);
  });
});

describe('the same elements in an app that did not ask', () => {
  it('are sized border-box, as a native view is', async () => {
    const laid = await sizes();
    assert.deepEqual(laid['tall'], [400, 100]);
    assert.deepEqual(laid['wide'], [100, 20]);
    assert.deepEqual(laid['fills'], [400, 40]);
    assert.deepEqual(laid['inside'], [380, 20]);
  });
});
