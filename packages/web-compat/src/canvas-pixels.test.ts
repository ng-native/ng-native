/**
 * `@ng-native/web-compat` canvas pixels: what a script reads back of what a 2D context drew,
 * which is worked out from what was drawn at the time it is read. See `canvas-raster.ts`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({ template: `<canvas width="100" height="50"></canvas>` })
class Drawing {}

const canvas = async () => {
  await render(Drawing, { providers: [provideWebCompat()] });
  await settle();
  const node = (globalThis as Dom).document.querySelector('canvas');
  return { node, context: node.getContext('2d') };
};

/** The colour of one pixel, as `[r, g, b, a]` from 0 to 255. */
const pixel = (context: Dom, x: number, y: number): number[] => [
  ...context.getImageData(x, y, 1, 1).data,
];

/** Whether each channel is within `by` of the one asked: how the canvas tests compare. */
const near = (got: number[], wanted: number[], by = 2) =>
  assert.ok(
    got.every((value, at) => Math.abs(value - wanted[at]!) <= by),
    `${got.join(',')} is not near ${wanted.join(',')}`,
  );

describe('@ng-native/web-compat canvas pixels', () => {
  it('reads back a filled rectangle, and nothing where none was drawn', async () => {
    const { context } = await canvas();
    assert.deepEqual(pixel(context, 50, 25), [0, 0, 0, 0]);
    context.fillStyle = '#0f0';
    context.fillRect(10, 10, 20, 10);
    assert.deepEqual(pixel(context, 15, 15), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 5, 15), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 30, 15), [0, 0, 0, 0]);
    const data = context.getImageData(0, 0, 100, 50);
    assert.deepEqual([data.width, data.height, data.data.length], [100, 50, 100 * 50 * 4]);
    // Outside the canvas is transparent black, and a negative size reads to the left.
    assert.deepEqual([...context.getImageData(-5, 15, 1, 1).data], [0, 0, 0, 0]);
    assert.deepEqual([...context.getImageData(16, 16, -1, -1).data], [0, 255, 0, 255]);
  });

  it("clears only what a shape covers, by as much as it covers it, under 'clear'", async () => {
    const { context } = await canvas();
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 100, 50);
    context.globalCompositeOperation = 'clear';
    context.beginPath();
    context.arc(50, 25, 20, 0, Math.PI * 2);
    context.fill();
    assert.deepEqual(pixel(context, 50, 25), [0, 0, 0, 0]);
    // The corner of the box around the circle, which the circle does not reach.
    assert.deepEqual(pixel(context, 32, 7), [255, 0, 0, 255]);
    // And an edge it half covers is half cleared, as Chrome draws it.
    const [red, , , edge] = pixel(context, 69, 30);
    assert.equal(red, 255);
    assert.ok(edge > 150 && edge < 250, `${edge} is not near Chrome's 215`);
  });

  it('draws a path where the transform puts it', async () => {
    const { context } = await canvas();
    context.scale(10, 10);
    context.translate(0, 5);
    context.fillStyle = '#0f0';
    context.fillRect(0, -5, 10, 5);
    assert.deepEqual(pixel(context, 50, 25), [0, 255, 0, 255]);
    context.resetTransform();
    context.fillStyle = 'red';
    context.beginPath();
    context.translate(50, 0);
    context.moveTo(0, 0);
    context.lineTo(50, 0);
    context.lineTo(50, 50);
    context.closePath();
    context.fill();
    assert.deepEqual(pixel(context, 95, 5), [255, 0, 0, 255]);
    assert.deepEqual(pixel(context, 55, 45), [0, 255, 0, 255]);
  });

  it('fills by the rule asked, and a crossing path by its winding', async () => {
    const { context } = await canvas();
    const square = (x: number, wise: boolean) => {
      const corners = wise
        ? [x, 0, x + 40, 0, x + 40, 40, x, 40]
        : [x, 0, x, 40, x + 40, 40, x + 40, 0];
      context.moveTo(corners[0], corners[1]);
      for (let at = 2; at < 8; at += 2) context.lineTo(corners[at], corners[at + 1]);
      context.closePath();
    };
    context.fillStyle = '#00f';
    context.beginPath();
    square(0, true);
    square(10, true);
    context.fill('evenodd');
    assert.deepEqual(pixel(context, 20, 20), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 5, 20), [0, 0, 255, 255]);
    context.beginPath();
    square(50, true);
    square(60, true);
    context.fill();
    assert.deepEqual(pixel(context, 70, 20), [0, 0, 255, 255]);
    // Turned the other way round, where the two overlap winds to none.
    context.clearRect(0, 0, 100, 50);
    context.beginPath();
    square(50, true);
    square(60, false);
    context.fill();
    assert.deepEqual(pixel(context, 70, 20), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 55, 20), [0, 0, 255, 255]);
  });

  it("clears what a shape covers under 'clear', at any alpha and with any style", async () => {
    const { context } = await canvas();
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 100, 50);
    context.globalCompositeOperation = 'clear';
    context.globalAlpha = 0;
    context.fillRect(0, 0, 10, 10);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 0, 0]);
    context.globalAlpha = 1;
    context.fillStyle = context.createLinearGradient(0, 0, 10, 0);
    context.fillRect(20, 0, 10, 10);
    assert.deepEqual(pixel(context, 25, 5), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 45, 5), [255, 0, 0, 255]);
  });

  it("adds what partly covers a pixel under 'lighter' by as much as it covers it", async () => {
    const { context } = await canvas();
    context.fillStyle = 'rgba(0, 0, 255, 0.5)';
    context.fillRect(0, 0, 10, 10);
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = 'rgba(0, 0, 255, 0.8)';
    context.fillRect(0.5, 0, 9, 10);
    // As Chrome has it: half of 0.8 added to 0.5, and the sum then held to 1.
    near(pixel(context, 0, 5), [0, 0, 255, 230]);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 255, 255]);
  });

  it('sets the transform as a DOMMatrix says, and to none where nothing is said', async () => {
    const { context } = await canvas();
    context.setTransform(2, 0, 0, 2, 5, 5);
    context.setTransform();
    assert.deepEqual(context.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    context.setTransform({ m11: 3, m42: 4 });
    assert.deepEqual(context.getTransform(), { a: 3, b: 0, c: 0, d: 1, e: 0, f: 4 });
    assert.throws(() => context.setTransform({ a: 2, m11: 3 }), TypeError);
    assert.equal(context.getTransform().a, 3);
  });

  it('lays a colour that lets some through over what is under it', async () => {
    const { context } = await canvas();
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 100, 50);
    context.fillStyle = 'rgba(0, 255, 0, 0.5)';
    context.fillRect(0, 0, 50, 50);
    near(pixel(context, 25, 25), [128, 127, 0, 255]);
    context.globalAlpha = 0.5;
    context.fillStyle = '#0f0';
    context.fillRect(50, 0, 50, 50);
    near(pixel(context, 75, 25), [128, 127, 0, 255]);
    // Over nothing, its own colour at its own alpha: what is read back is not premultiplied.
    context.clearRect(0, 0, 10, 10);
    context.fillRect(0, 0, 10, 10);
    near(pixel(context, 5, 5), [0, 255, 0, 128]);
  });

  it('clears part of it, under the transform and the clip', async () => {
    const { context } = await canvas();
    context.fillStyle = '#0f0';
    context.fillRect(0, 0, 100, 50);
    context.translate(10, 0);
    context.clearRect(0, 0, 10, 10);
    assert.deepEqual(pixel(context, 15, 5), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 5, 5), [0, 255, 0, 255]);
    context.beginPath();
    context.rect(50, 0, 50, 50);
    context.clip();
    context.fillStyle = '#f00';
    context.fillRect(0, 20, 100, 30);
    assert.deepEqual(pixel(context, 45, 30), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 65, 30), [255, 0, 0, 255]);
    // A clip inside another is where both are.
    context.beginPath();
    context.rect(0, 0, 70, 10);
    context.clip();
    context.fillStyle = '#00f';
    context.fillRect(0, 0, 100, 50);
    assert.deepEqual(pixel(context, 65, 5), [0, 0, 255, 255]);
    assert.deepEqual(pixel(context, 85, 5), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 55, 5), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 65, 25), [255, 0, 0, 255]);
  });

  it('clears only what is in the clip, where all of it is asked to be cleared', async () => {
    const { context } = await canvas();
    context.fillRect(0, 0, 100, 50);
    context.beginPath();
    context.rect(0, 0, 50, 50);
    context.clip();
    context.clearRect(0, 0, 100, 50);
    assert.deepEqual(pixel(context, 25, 25), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 75, 25), [0, 0, 0, 255]);
  });

  it('is clear again once it is cleared whole, and once it is another size', async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 10, 10);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 0, 255]);
    context.clearRect(0, 0, 100, 50);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 0, 0]);
    context.fillRect(0, 0, 10, 10);
    node.width = 200;
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 0, 0]);
    assert.equal(context.getImageData(0, 0, 200, 1).data.length, 800);
  });

  it('strokes a line as wide as it is asked', async () => {
    const { context } = await canvas();
    context.strokeStyle = '#0f0';
    context.lineWidth = 20;
    context.beginPath();
    context.moveTo(10, 25);
    context.lineTo(90, 25);
    context.stroke();
    assert.deepEqual(pixel(context, 50, 16), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 50, 34), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 50, 36), [0, 0, 0, 0]);
    // A butt end stops at the end, and a square one goes on half the width.
    assert.deepEqual(pixel(context, 5, 25), [0, 0, 0, 0]);
    context.lineCap = 'square';
    context.strokeStyle = '#00f';
    context.stroke();
    assert.deepEqual(pixel(context, 5, 25), [0, 0, 255, 255]);
    // A rectangle's corners are mitred.
    context.clearRect(0, 0, 100, 50);
    context.lineWidth = 10;
    context.strokeRect(20, 20, 60, 20);
    assert.deepEqual(pixel(context, 16, 16), [0, 0, 255, 255]);
    assert.deepEqual(pixel(context, 50, 30), [0, 0, 0, 0]);
  });

  it('strokes a dashed line in its dashes', async () => {
    const { context } = await canvas();
    context.lineWidth = 10;
    context.setLineDash([10, 10]);
    context.beginPath();
    context.moveTo(0, 25);
    context.lineTo(100, 25);
    context.stroke();
    assert.deepEqual(pixel(context, 5, 25), [0, 0, 0, 255]);
    assert.deepEqual(pixel(context, 15, 25), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 25, 25), [0, 0, 0, 255]);
  });

  it('fills with a gradient, its colours eased along it', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 100, 0);
    fade.addColorStop(0, '#ff0');
    fade.addColorStop(1, '#00f');
    context.fillStyle = fade;
    context.fillRect(0, 0, 100, 50);
    near(pixel(context, 25, 25), [191, 191, 63, 255], 3);
    near(pixel(context, 75, 25), [63, 63, 191, 255], 3);
    const ring = context.createRadialGradient(50, 25, 0, 50, 25, 20);
    ring.addColorStop(0, '#0f0');
    ring.addColorStop(1, '#f00');
    context.fillStyle = ring;
    context.fillRect(0, 0, 100, 50);
    near(pixel(context, 50, 25), [0, 255, 0, 255], 15);
    assert.deepEqual(pixel(context, 5, 5), [255, 0, 0, 255]);
  });

  it('puts pixels back where it is asked, as they are', async () => {
    const { context } = await canvas();
    const ImageData = (globalThis as Dom).ImageData;
    const made = context.createImageData(2, 2);
    assert.ok(made instanceof ImageData);
    assert.deepEqual([...made.data], new Array(16).fill(0));
    made.data.set([255, 0, 0, 128]);
    context.fillStyle = '#0f0';
    context.fillRect(0, 0, 100, 50);
    context.putImageData(made, 10, 10);
    // Replaced, not laid over: what is put is what is read.
    assert.deepEqual(pixel(context, 10, 10), [255, 0, 0, 128]);
    assert.deepEqual(pixel(context, 11, 11), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 12, 12), [0, 255, 0, 255]);
    // And drawing goes on over it.
    context.fillRect(10, 10, 1, 1);
    assert.deepEqual(pixel(context, 10, 10), [0, 255, 0, 255]);
    assert.throws(() => context.putImageData({ width: 1, height: 1, data: [] }, 0, 0), TypeError);
    assert.throws(() => context.getImageData(0, 0, 0, 1), { name: 'IndexSizeError' });
    assert.throws(() => context.getImageData(Number.NaN, 0, 1, 1), TypeError);
    assert.throws(() => context.getImageData(10, 0xffffffff, 1, 1), TypeError);
  });

  it('says whether a point is in the path, on the canvas grid', async () => {
    const { context } = await canvas();
    context.translate(50, 0);
    context.rect(0, 0, 20, 20);
    assert.equal(context.isPointInPath(60, 10), true);
    assert.equal(context.isPointInPath(10, 10), false);
    // A point on a side is in it.
    assert.equal(context.isPointInPath(70, 20), true);
    assert.equal(context.isPointInPath(70.01, 10), false);
    context.lineWidth = 4;
    assert.equal(context.isPointInStroke(51, 10), true);
    assert.equal(context.isPointInStroke(55, 10), false);
  });

  it('draws a whole circle the other way round, as a browser does', async () => {
    const { context } = await canvas();
    context.fillStyle = '#0f0';
    context.beginPath();
    context.arc(50, 25, 20, 0, 2 * Math.PI, true);
    context.fill();
    assert.deepEqual(pixel(context, 50, 25), [0, 255, 0, 255]);
    assert.throws(() => context.arc(0, 0, -1, 0, 1), { name: 'IndexSizeError' });
  });

  it('strokes a line wider the way the transform stretches it more', async () => {
    const { context } = await canvas();
    context.scale(1, 10);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 2.5);
    context.lineTo(100, 2.5);
    context.stroke();
    // Ten times as tall as it is wide where it runs across: 20 tall.
    assert.deepEqual(pixel(context, 50, 16), [0, 0, 0, 255]);
    assert.deepEqual(pixel(context, 50, 34), [0, 0, 0, 255]);
    // And a line of no length draws nothing, whatever its ends.
    context.resetTransform();
    context.clearRect(0, 0, 100, 50);
    context.lineCap = 'round';
    context.lineWidth = 50;
    context.beginPath();
    context.moveTo(50, 25);
    context.lineTo(50, 25);
    context.stroke();
    assert.deepEqual(pixel(context, 50, 25), [0, 0, 0, 0]);
  });

  it('runs a gradient under the transform there is when it is drawn with', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 200, 0);
    fade.addColorStop(0, '#0f0');
    fade.addColorStop(0.5, '#0f0');
    fade.addColorStop(0.51, '#f00');
    fade.addColorStop(1, '#f00');
    context.fillStyle = fade;
    context.translate(-50, 0);
    context.fillRect(50, 0, 100, 50);
    assert.deepEqual(pixel(context, 25, 25), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 75, 25), [255, 0, 0, 255]);
  });

  it('takes a colour as CSS writes one, reads it back as a browser does, and no other', async () => {
    const { context } = await canvas();
    assert.equal(context.fillStyle, '#000000');
    context.fillStyle = '#fa0';
    assert.equal(context.fillStyle, '#ffaa00');
    context.fillStyle = 'rgba(255,255,255,0.5)';
    assert.equal(context.fillStyle, 'rgba(255, 255, 255, 0.5)');
    for (const written of ['rgb(0% ,100% ,0%)', 'hsl(120deg 100% 50% / 1)', 'rgb(0, 255, 0']) {
      context.fillStyle = '#f00';
      context.fillStyle = written;
      assert.equal(context.fillStyle, '#00ff00', written);
    }
    for (const nonsense of ['rgb(100%, 0, 0)', '#ff000', 'red blue', 'hsl(0, 100%, 50%,)', null]) {
      context.fillStyle = '#0f0';
      context.fillStyle = nonsense;
      assert.equal(context.fillStyle, '#00ff00', String(nonsense));
    }
    context.fillRect(0, 0, 10, 10);
    assert.deepEqual(pixel(context, 5, 5), [0, 255, 0, 255]);
    // An offset is a number as a script converts one.
    const stopped = context.createLinearGradient(0, 0, 100, 0);
    stopped.addColorStop('0', '#00f');
    context.fillStyle = stopped;
    context.fillRect(0, 0, 10, 10);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 255, 255]);
    assert.throws(() => context.createLinearGradient(0, 0, 1, 0).addColorStop(0, ''), {
      name: 'SyntaxError',
    });
  });

  it('rounds the corners of a rectangle, and of a corner drawn with arcTo', async () => {
    const { context } = await canvas();
    context.fillStyle = '#0f0';
    context.beginPath();
    context.roundRect(0, 0, 100, 50, 20);
    context.fill();
    assert.deepEqual(pixel(context, 1, 1), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 98, 48), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 20, 1), [0, 255, 0, 255]);
    // Any list of radii, as Web IDL takes a sequence: not only an array.
    for (const radii of [new Float32Array([20]), new Set([20])]) {
      context.clearRect(0, 0, 100, 50);
      context.beginPath();
      context.roundRect(0, 0, 100, 50, radii);
      context.fill();
      assert.deepEqual(pixel(context, 1, 1), [0, 0, 0, 0]);
      assert.deepEqual(pixel(context, 20, 1), [0, 255, 0, 255]);
    }
    assert.throws(() => context.roundRect(0, 0, 1, 1, [-1]), RangeError);
    assert.throws(() => context.roundRect(0, 0, 1, 1, []), RangeError);
    context.clearRect(0, 0, 100, 50);
    context.beginPath();
    context.moveTo(0, 0);
    context.arcTo(100, 0, 100, 50, 40);
    context.lineTo(100, 50);
    context.lineTo(0, 50);
    context.fill();
    assert.deepEqual(pixel(context, 97, 2), [0, 0, 0, 0]);
    assert.deepEqual(pixel(context, 55, 2), [0, 255, 0, 255]);
  });

  it('keeps what it had for a style given what it cannot be', async () => {
    const { context } = await canvas();
    context.globalAlpha = 0.5;
    context.globalAlpha = 2;
    context.globalAlpha = Number.NaN;
    assert.equal(context.globalAlpha, 0.5);
    context.lineWidth = Number.POSITIVE_INFINITY;
    context.lineWidth = '3';
    assert.equal(context.lineWidth, 3);
    context.lineCap = 'nonsense';
    assert.equal(context.lineCap, 'butt');
    context.translate(Number.NaN, 0);
    assert.deepEqual(context.getTransform().e, 0);
  });

  it('keeps the text style it had for one given what it cannot be, as Chrome does', async () => {
    const { context } = await canvas();
    context.textAlign = 'middle';
    context.textBaseline = 'centre';
    assert.deepEqual([context.textAlign, context.textBaseline], ['start', 'alphabetic']);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    assert.deepEqual([context.textAlign, context.textBaseline], ['center', 'middle']);
    // A font with no size, or a size and no family, is none.
    for (const font of ['bold', '12px', 'Arial', '']) context.font = font;
    assert.equal(context.font, '10px sans-serif');
    context.font = 'italic bold 12px/1.5 Arial, sans-serif';
    assert.equal(context.font, 'italic bold 12px/1.5 Arial, sans-serif');
  });

  it('strokes a dashed closed path that ends where it began', async () => {
    const { context } = await canvas();
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.beginPath();
    context.moveTo(10, 10);
    context.lineTo(40, 10);
    context.lineTo(40, 40);
    context.lineTo(10, 10);
    context.closePath();
    context.stroke();
    assert.deepEqual(pixel(context, 12, 10), [0, 0, 0, 255]);
    assert.deepEqual(pixel(context, 17, 10), [0, 0, 0, 0]);
  });

  it('joins the dash that runs over where a closed path began, as Chrome does', async () => {
    const { context } = await canvas();
    context.lineWidth = 10;
    // One dash longer than the path, and one that the start falls in the middle of.
    for (const [dash, offset] of [
      [[1000], 0],
      [[60, 10], 30],
    ] as const) {
      context.clearRect(0, 0, 100, 50);
      context.setLineDash(dash);
      context.lineDashOffset = offset;
      context.beginPath();
      context.rect(20, 10, 30, 30);
      context.stroke();
      // The outer corner of the mitre where it began: butt ends there would leave it empty.
      assert.deepEqual(pixel(context, 16, 6), [0, 0, 0, 255]);
    }
  });

  it(
    'strokes a line solid where its dashes are too many to draw, as Skia does',
    { timeout: 10_000 },
    async () => {
      const { context } = await canvas();
      context.lineWidth = 4;
      context.setLineDash([1e-9]);
      context.beginPath();
      context.moveTo(0, 10);
      context.lineTo(100, 10);
      context.moveTo(0, 30);
      context.lineTo(1, 30);
      context.stroke();
      // Chrome draws this one solid: past a million dashes, Skia draws the line without them.
      assert.deepEqual(pixel(context, 50, 10), [0, 0, 0, 255]);
      assert.deepEqual(pixel(context, 0, 30), [0, 0, 0, 255]);
    },
  );
});

describe('@ng-native/web-compat ImageData', () => {
  it('is made of a size, or of the pixels it holds', async () => {
    await canvas();
    const ImageData = (globalThis as Dom).ImageData;
    const blank = new ImageData(2, 3);
    assert.deepEqual([blank.width, blank.height, blank.data.length], [2, 3, 24]);
    const pixels = new Uint8ClampedArray(8);
    const held = new ImageData(pixels, 1);
    assert.equal(held.data, pixels);
    assert.equal(held.height, 2);
    assert.throws(() => new ImageData(0, 1), { name: 'IndexSizeError' });
    assert.throws(() => new ImageData(new Uint8ClampedArray(6), 1), { name: 'InvalidStateError' });
    // What it holds is its own: a script that sets a name of its own changes none of it.
    Object.assign(blank, { pixels: null, wide: 9, high: 9 });
    assert.deepEqual([blank.width, blank.height, blank.data.length], [2, 3, 24]);
  });

  it('is in the colour space it is asked for', async () => {
    await canvas();
    const ImageData = (globalThis as Dom).ImageData;
    assert.equal(new ImageData(1, 1).colorSpace, 'srgb');
    assert.equal(new ImageData(1, 1, { colorSpace: 'display-p3' }).colorSpace, 'display-p3');
    const held = new ImageData(new Uint8ClampedArray(4), 1, 1, { colorSpace: 'display-p3' });
    assert.equal(held.colorSpace, 'display-p3');
    assert.throws(() => new ImageData(1, 1, { colorSpace: 'nope' }), TypeError);
  });
});
