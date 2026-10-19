/**
 * `@ng-native/web-compat` canvas pictures: pixels put on a canvas and pictures drawn on one,
 * shown as react-native-svg images and read back, the canvas as a PNG, patterns, and the ways
 * what is drawn is laid over what is there.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { Component } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { base64Of, pngOf } from './png.ts';

afterEach(cleanup);

type Dom = any;

@Component({
  template: `
    <canvas testID="chart" width="100" height="50"></canvas>
    <canvas testID="source" width="10" height="10"></canvas>
    <img testID="picture" src="https://example.com/dot.png" />
  `,
})
class Drawing {}

const document = () => (globalThis as Dom).document;

const canvases = async () => {
  await render(Drawing, { providers: [provideWebCompat()] });
  await settle();
  const [node, source] = document().querySelectorAll('canvas');
  return {
    node,
    context: node.getContext('2d'),
    source,
    sourceContext: source.getContext('2d'),
    image: document().querySelector('img'),
  };
};

const shapes = () => screen.getByTestId('chart').children[0]!.children;

const pixel = (context: Dom, x: number, y: number): number[] => [
  ...context.getImageData(x, y, 1, 1).data,
];

/** A PNG's size and pixels, read as a decoder reads one. Only the rows this encoder writes. */
function decoded(png: Uint8Array): { width: number; height: number; data: number[] } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let at = 8;
  let [width, height] = [0, 0];
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') [width, height] = [view.getUint32(at + 8), view.getUint32(at + 12)];
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data: number[] = [];
  for (let row = 0; row < height; row++) {
    const start = row * (width * 4 + 1);
    assert.equal(raw[start], 0, 'each row is unfiltered');
    data.push(...raw.subarray(start + 1, start + 1 + width * 4));
  }
  return { width, height, data };
}

/**
 * Whether two lists of bytes are the same, said by their lengths and the first byte that differs:
 * a failed `deepEqual` of long lists diffs every byte, and takes all the memory there is.
 */
function sameBytes(got: ArrayLike<number>, wanted: ArrayLike<number>): void {
  assert.equal(got.length, wanted.length, 'as many bytes');
  const at = Array.prototype.findIndex.call(got, (byte, index) => byte !== wanted[index]);
  assert.equal(at, -1, `byte ${at} is ${got[at]}, not ${wanted[at]}`);
}

const fromUrl = (url: string) => {
  const prefix = 'data:image/png;base64,';
  assert.ok(url.startsWith(prefix), url.slice(0, 40));
  return decoded(new Uint8Array(Buffer.from(url.slice(prefix.length), 'base64')));
};

describe('@ng-native/web-compat canvas PNG', () => {
  it('writes pixels as a PNG a decoder reads back', () => {
    const data = Uint8ClampedArray.from({ length: 3 * 2 * 4 }, (_, at) => (at * 37) % 256);
    const png = pngOf(3, 2, data);
    assert.deepEqual(decoded(png), { width: 3, height: 2, data: [...data] });
  });

  it('writes pixels larger than one stored block holds', () => {
    const data = Uint8ClampedArray.from({ length: 200 * 100 * 4 }, (_, at) => at % 251);
    sameBytes(decoded(pngOf(200, 100, data)).data, data);
  });

  it('writes base64 as Node does, padded', () => {
    for (const length of [0, 1, 2, 3, 4, 5000]) {
      const bytes = Uint8Array.from({ length }, (_, at) => (at * 7) % 256);
      assert.equal(base64Of(bytes), Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('@ng-native/web-compat canvas pictures', () => {
  it('answers toDataURL with a PNG of its pixels, whatever type is asked', async () => {
    const { node, context } = await canvases();
    context.fillStyle = '#0f0';
    context.fillRect(0, 0, 10, 10);
    for (const url of [node.toDataURL(), node.toDataURL('image/jpeg', 0.5)]) {
      const png = fromUrl(url);
      assert.deepEqual([png.width, png.height], [100, 50]);
      assert.deepEqual(png.data.slice(0, 4), [0, 255, 0, 255]);
      assert.deepEqual(png.data.slice(10 * 4, 11 * 4), [0, 0, 0, 0]);
    }
  });

  it('answers toDataURL for a canvas with no context, and none for one of no size', async () => {
    const { source } = await canvases();
    sameBytes(fromUrl(source.toDataURL()).data, new Array(10 * 10 * 4).fill(0));
    source.width = 0;
    assert.equal(source.toDataURL(), 'data:,');
  });

  it('hands toBlob a PNG blob, later', async () => {
    const { node, context } = await canvases();
    context.fillRect(0, 0, 1, 1);
    assert.throws(() => node.toBlob(), TypeError);
    let blob: Blob | null | undefined;
    node.toBlob((given: Blob | null) => (blob = given));
    assert.equal(blob, undefined);
    await settle();
    assert.equal(blob!.type, 'image/png');
    const png = decoded(new Uint8Array(await blob!.arrayBuffer()));
    assert.deepEqual(png.data.slice(0, 4), [0, 0, 0, 255]);
  });

  it('shows pixels put on it as an image of them, where they were put', async () => {
    const { context } = await canvases();
    context.fillStyle = 'red';
    context.fillRect(0, 0, 100, 50);
    const image = context.createImageData(4, 2);
    image.data.set([0, 0, 255, 255], 0);
    // Under a transform, a clip and an alpha, none of which a put is drawn with.
    context.translate(30, 30);
    context.globalAlpha = 0.5;
    context.rect(0, 0, 1, 1);
    context.clip();
    context.putImageData(image, 10, 20, 0, 0, 2, 2);
    // Changed after it was put: what is shown is what was put.
    image.data.fill(9);
    await settle();
    const [, put] = shapes();
    assert.equal(put!.viewName, 'RNSVGImage');
    const { x, y, width, height, align, opacity, matrix, src } = put!.props as Dom;
    assert.deepEqual([x, y, width, height, align], [10, 20, 2, 2, 'none']);
    assert.equal(opacity, undefined);
    assert.equal(matrix, undefined);
    const png = fromUrl(src.uri);
    assert.deepEqual([png.width, png.height], [2, 2]);
    sameBytes(png.data, [0, 0, 255, 255, ...new Array(12).fill(0)]);
  });

  it('shows a put over the whole canvas as all there is on it', async () => {
    const { context } = await canvases();
    context.fillRect(0, 0, 10, 10);
    await settle();
    context.putImageData(context.createImageData(100, 50), 0, 0);
    await settle();
    assert.deepEqual(
      shapes().map((shape) => shape.viewName),
      ['RNSVGImage'],
    );
  });

  it('draws another canvas, read back and shown, where the transform puts it', async () => {
    const { context, source, sourceContext } = await canvases();
    sourceContext.fillStyle = '#00f';
    sourceContext.fillRect(0, 0, 10, 10);
    sourceContext.fillStyle = '#0f0';
    sourceContext.fillRect(5, 0, 5, 10);
    context.translate(20, 0);
    context.globalAlpha = 0.5;
    context.drawImage(source, 0, 0);
    context.globalAlpha = 1;
    context.drawImage(source, 30, 0, 20, 20);
    assert.deepEqual(pixel(context, 22, 5), [0, 0, 255, 128]);
    assert.deepEqual(pixel(context, 27, 5), [0, 255, 0, 128]);
    assert.deepEqual(pixel(context, 51, 15), [0, 0, 255, 255]);
    assert.deepEqual(pixel(context, 65, 15), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 71, 15), [0, 0, 0, 0]);
    await settle();
    const [faded, stretched] = shapes();
    assert.equal(faded!.viewName, 'RNSVGImage');
    const props = faded!.props as Dom;
    assert.deepEqual([props.x, props.y, props.width, props.height], [0, 0, 10, 10]);
    assert.deepEqual([props.opacity, props.matrix], [0.5, [1, 0, 0, 1, 20, 0]]);
    const png = fromUrl(props.src.uri);
    assert.deepEqual(png.data.slice(0, 4), [0, 0, 255, 255]);
    assert.deepEqual(png.data.slice(9 * 4, 10 * 4), [0, 255, 0, 255]);
    assert.deepEqual(
      [stretched!.props['width'], stretched!.props['height'], stretched!.props['x']],
      [20, 20, 30],
    );
    // The same pixels are the same picture, encoded once.
    assert.equal((stretched!.props as Dom).src.uri, props.src.uri);
  });

  it('shows a picture drawn again by the image it had, without what it no longer says', async () => {
    const { context, source, sourceContext } = await canvases();
    sourceContext.fillRect(0, 0, 10, 10);
    context.translate(20, 0);
    context.globalAlpha = 0.5;
    context.drawImage(source, 0, 0);
    await settle();
    const [first] = shapes();
    assert.deepEqual([first!.props['opacity'], first!.props['matrix']], [0.5, [1, 0, 0, 1, 20, 0]]);
    context.resetTransform();
    context.clearRect(0, 0, 100, 50);
    context.globalAlpha = 1;
    context.drawImage(source, 0, 0);
    await settle();
    const [again] = shapes();
    assert.equal(again!.reactTag, first!.reactTag);
    assert.deepEqual(
      [again!.props['opacity'] ?? null, again!.props['matrix'] ?? null],
      [null, null],
    );
  });

  it('draws what the source was when it was drawn, not what it is after', async () => {
    const { context, source, sourceContext } = await canvases();
    sourceContext.fillStyle = '#00f';
    sourceContext.fillRect(0, 0, 10, 10);
    context.drawImage(source, 0, 0);
    sourceContext.fillStyle = '#f00';
    sourceContext.fillRect(0, 0, 10, 10);
    context.drawImage(source, 10, 0);
    assert.deepEqual(pixel(context, 5, 5), [0, 0, 255, 255]);
    assert.deepEqual(pixel(context, 15, 5), [255, 0, 0, 255]);
  });

  it('draws part of a source, cut to where it is drawn', async () => {
    const { context, source, sourceContext } = await canvases();
    sourceContext.fillStyle = '#00f';
    sourceContext.fillRect(0, 0, 5, 10);
    sourceContext.fillStyle = '#0f0';
    sourceContext.fillRect(5, 0, 5, 10);
    // The right half, stretched over twenty points: none of the left half shows.
    context.drawImage(source, 5, 0, 5, 10, 0, 0, 20, 20);
    assert.deepEqual(pixel(context, 1, 1), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 19, 19), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 21, 1), [0, 0, 0, 0]);
    await settle();
    const [defined, group] = shapes();
    assert.equal(defined!.viewName, 'RNSVGDefs');
    const cut = defined!.children[0];
    assert.equal(cut!.viewName, 'RNSVGClipPath');
    assert.equal(cut!.children[0]!.props['d'], 'M0 0L20 0L20 20L0 20Z');
    assert.equal(group!.viewName, 'RNSVGGroup');
    assert.equal(group!.props['clipPath'], cut!.props['name']);
    const [shown] = group!.children;
    const { x, y, width, height } = shown!.props as Dom;
    assert.deepEqual([x, y, width, height], [-20, 0, 40, 20]);
  });

  it('draws nothing of an image, whose picture is not known', async () => {
    const { context, image } = await canvases();
    context.drawImage(image, 0, 0);
    assert.equal(context.createPattern(image, 'repeat'), null);
    await settle();
    assert.equal(shapes().length, 0);
    assert.deepEqual(pixel(context, 0, 0), [0, 0, 0, 0]);
  });

  it('is told from a plain object as a chart library tells a picture', async () => {
    const { node, image } = await canvases();
    // Chart.js draws a point style that says it is one of these, and merges any other object.
    assert.equal(String(node), '[object HTMLCanvasElement]');
    assert.equal(String(image), '[object HTMLImageElement]');
    assert.equal(String(document().createElement('div')), '[object Object]');
  });

  it('refuses what is no picture, and a canvas of no size', async () => {
    const { context, source } = await canvases();
    assert.throws(() => context.drawImage(null, 0, 0), TypeError);
    assert.throws(() => context.drawImage(document().createElement('div'), 0, 0), TypeError);
    // An SVG image is a picture, never loaded: nothing to draw, and no pattern.
    const drawn = document().createElementNS('http://www.w3.org/2000/svg', 'image');
    context.drawImage(drawn, 0, 0);
    assert.equal(context.createPattern(drawn, 'repeat'), null);
    source.width = 0;
    assert.throws(
      () => context.drawImage(source, 0, 0),
      (error: Dom) => error.name === 'InvalidStateError',
    );
  });

  it('fills with a pattern of a canvas, repeated as asked', async () => {
    const { context, source, sourceContext } = await canvases();
    sourceContext.fillStyle = '#0f0';
    sourceContext.fillRect(0, 0, 5, 5);
    for (const bad of ['repeat-z', 'repeat\0', 'Repeat']) {
      assert.throws(
        () => context.createPattern(source, bad),
        (error: Dom) => error.name === 'SyntaxError',
      );
    }
    const pattern = context.createPattern(source, 'repeat');
    assert.equal(Object.prototype.toString.call(pattern), '[object CanvasPattern]');
    context.fillStyle = pattern;
    context.fillRect(0, 0, 40, 40);
    assert.deepEqual(pixel(context, 12, 12), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 17, 12), [0, 0, 0, 0]);
    const once = context.createPattern(source, 'no-repeat');
    assert.throws(() => once.setTransform({ a: 1, m11: 2 }), TypeError);
    once.setTransform({ a: 1, b: 0, c: 0, d: 1, e: 50, m42: 0 });
    context.fillStyle = once;
    context.fillRect(50, 0, 50, 50);
    assert.deepEqual(pixel(context, 52, 2), [0, 255, 0, 255]);
    assert.deepEqual(pixel(context, 62, 2), [0, 0, 0, 0]);
    await settle();
    const [defined, filled] = shapes();
    // A definition, which draws nothing where it is: a pattern outside one draws its tile there.
    assert.equal(defined!.viewName, 'RNSVGDefs');
    const tile = defined!.children[0];
    assert.equal(tile!.viewName, 'RNSVGPattern');
    assert.deepEqual(filled!.props['fill'], { type: 1, brushRef: tile!.props['name'] });
    const { width, height, patternUnits } = tile!.props as Dom;
    assert.deepEqual([width, height, patternUnits], [10, 10, 1]);
    assert.equal(tile!.children[0]!.viewName, 'RNSVGImage');
  });

  it('keeps the way it lays a drawing over what is there as a browser does', async () => {
    const { context } = await canvases();
    assert.equal(context.globalCompositeOperation, 'source-over');
    context.globalCompositeOperation = 'nonsense';
    assert.equal(context.globalCompositeOperation, 'source-over');
    context.globalCompositeOperation = 'clear';
    assert.equal(context.globalCompositeOperation, 'clear');
    context.globalCompositeOperation = 'source-over';
    context.save();
    context.globalCompositeOperation = 'copy';
    context.restore();
    assert.equal(context.globalCompositeOperation, 'source-over');
  });

  it('reads back each way of laying a drawing over what is there', async () => {
    const { context } = await canvases();
    const laid = (mode: string, under: string, over: string) => {
      context.clearRect(0, 0, 100, 50);
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = under;
      context.fillRect(0, 0, 20, 20);
      context.globalCompositeOperation = mode;
      context.fillStyle = over;
      context.fillRect(10, 0, 20, 20);
      return [pixel(context, 5, 5), pixel(context, 15, 5), pixel(context, 25, 5)];
    };
    const [none, red, green, blue] = [
      [0, 0, 0, 0],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ];
    assert.deepEqual(laid('destination-out', '#f00', '#00f'), [red, none, none]);
    assert.deepEqual(laid('copy', '#f00', '#00f'), [none, blue, blue]);
    assert.deepEqual(laid('source-in', '#f00', '#00f'), [none, blue, none]);
    assert.deepEqual(laid('destination-over', '#f00', '#00f'), [red, red, blue]);
    assert.deepEqual(laid('lighter', '#f00', '#0f0'), [red, [255, 255, 0, 255], green]);
    assert.deepEqual(laid('multiply', '#ff0', '#0ff'), [
      [255, 255, 0, 255],
      green,
      [0, 255, 255, 255],
    ]);
    assert.deepEqual(laid('xor', '#f00', '#00f'), [red, none, blue]);
  });

  it('shows a copy as all there is, where nothing clips it', async () => {
    const { context } = await canvases();
    context.fillRect(0, 0, 10, 10);
    context.globalCompositeOperation = 'copy';
    context.fillStyle = 'red';
    context.fillRect(20, 0, 10, 10);
    await settle();
    assert.deepEqual(
      shapes().map((shape) => shape.props['fill']),
      [{ type: 0, payload: 'red' }],
    );
  });
});
