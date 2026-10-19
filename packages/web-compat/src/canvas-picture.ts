import { registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import type { Matrix } from './canvas-path.ts';
import type { Pixels } from './canvas-raster.ts';
import { domError } from './dom-error.ts';
import { pngUrlOf } from './png.ts';

/**
 * A picture a canvas draws, by `drawImage` or as a pattern: another canvas, whose pixels are
 * known, or an `<img>`, whose are the platform's. On screen it is a react-native-svg image of
 * a URL: the image's own, or a PNG of the pixels, made once for each set of them.
 *
 * ponytail: an `<img>` is no picture yet: nothing tells this package its size or that it has
 * loaded, so drawing one draws nothing, as drawing one not loaded does in a browser. Draw it by
 * its URL once its picture's size is known.
 */
export interface Picture {
  readonly width: number;
  readonly height: number;
  /** Its pixels, where they are known; a URL is made of them to show them. */
  readonly pixels?: Pixels;
  /** Where it is shown from, where its pixels are not known. */
  readonly uri?: string;
}

/** The images and patterns a canvas shows pictures with: react-native-svg's own views. */
export const IMAGE = 'canvas:image';
export const PATTERN = 'canvas:pattern';

export function registerPictures(): () => void {
  const undo = [registerViewName(IMAGE, 'RNSVGImage'), registerViewName(PATTERN, 'RNSVGPattern')];
  return () => undo.forEach((each) => each());
}

/**
 * What a script passed to draw is as a picture: null for one not ready, an image not loaded,
 * which draws nothing. What no picture is, is refused, and a canvas of no size is not drawn.
 */
export function pictureOf(
  source: unknown,
  pixelsOf: (canvas: EngineNode) => Pixels,
): Picture | null {
  const node = source as EngineNode | null;
  if (node?.tag === 'canvas') {
    const pixels = pixelsOf(node);
    if (!pixels.width || !pixels.height)
      throw domError('The canvas has no size.', 'InvalidStateError');
    return { width: pixels.width, height: pixels.height, pixels };
  }
  // An `<img>`, whose size is not known: see the note above. An SVG `<image>`, which is not
  // drawn and so never loads. It is kept under the name of every SVG element that is not drawn,
  // see `svg.ts`, and so is any of them. One written in markup keeps its own name.
  if (node?.tag === 'img' || node?.tag === 'svg:undrawn' || node?.tag === 'image') return null;
  throw new TypeError('What is drawn is not an image or a canvas.');
}

/** The URL each set of pixels is shown from: a PNG made the first time it is shown. */
const urls = new WeakMap<Pixels, string>();

export function uriOf(picture: Picture): string {
  if (picture.uri !== undefined || !picture.pixels) return picture.uri ?? '';
  const { pixels } = picture;
  let uri = urls.get(pixels);
  if (uri === undefined)
    urls.set(pixels, (uri = pngUrlOf(pixels.width, pixels.height, pixels.data)));
  return uri;
}

/** Where a picture is shown: its box, on the grid of a transform, and how solid it is. */
export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly matrix?: Matrix;
  readonly opacity?: number;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** An image's props: the picture stretched over its box, as `drawImage` draws one. */
export function imageProps(picture: Picture, place: Placed): Record<string, unknown> {
  const props: Record<string, unknown> = {
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    src: { uri: uriOf(picture) },
    align: 'none',
    meetOrSlice: 0,
  };
  if (place.opacity !== undefined && place.opacity < 1) props['opacity'] = place.opacity;
  if (place.matrix && place.matrix.some((value, at) => value !== IDENTITY[at])) {
    props['matrix'] = [...place.matrix];
  }
  return props;
}

/** The props each picture's view was last given, to set only what changed. */
const given = new WeakMap<EngineNode, Record<string, unknown>>();

/** Whether a prop is what it was. A URL is compared as one: a PNG's is long. */
function same(before: unknown, after: unknown): boolean {
  if (before === after) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, at) => value === after[at]);
  }
  const [was, is] = [
    before as { uri?: unknown } | undefined,
    after as { uri?: unknown } | undefined,
  ];
  return typeof was === 'object' && typeof is === 'object' && was?.uri === is?.uri;
}

/** Give a picture's view its props: those that changed, and none of those it no longer has. */
export function setPictureProps(engine: Engine, node: EngineNode, props: Record<string, unknown>) {
  const before = given.get(node) ?? {};
  for (const key of Object.keys(before)) if (!(key in props)) engine.setProp(node, key, null);
  for (const [key, value] of Object.entries(props)) {
    if (!same(before[key], value)) engine.setProp(node, key, value);
  }
  given.set(node, props);
}

/** A `DOMMatrix`'s members for each of a 2D matrix's six numbers, and what one unsaid is. */
const MATRIX_KEYS = [
  ['a', 'm11', 1],
  ['b', 'm12', 0],
  ['c', 'm21', 0],
  ['d', 'm22', 1],
  ['e', 'm41', 0],
  ['f', 'm42', 0],
] as const;

const REPEATS = new Set(['repeat', 'repeat-x', 'repeat-y', 'no-repeat']);

/**
 * `createPattern`: a picture repeated across what is filled, along both sides, one or neither.
 * Its transform is on top of the one there is when it is drawn with.
 */
export class Pattern {
  readonly picture: Picture;
  readonly repeatX: boolean;
  readonly repeatY: boolean;
  private transform: Matrix = [1, 0, 0, 1, 0, 0];

  constructor(picture: Picture, repetition: string) {
    const repeat = repetition || 'repeat';
    if (!REPEATS.has(repeat)) throw domError(`${repetition} is not a repetition.`, 'SyntaxError');
    this.picture = picture;
    this.repeatX = repeat === 'repeat' || repeat === 'repeat-x';
    this.repeatY = repeat === 'repeat' || repeat === 'repeat-y';
  }

  get matrix(): Matrix {
    return this.transform;
  }

  /** To what a `DOMMatrix` of one has, or none; one with what is no number is no change. */
  setTransform(init: unknown = {}): void {
    const given = (init ?? {}) as Record<string, unknown>;
    const numbers = MATRIX_KEYS.map(([short, long, start]) => {
      const [one, other] = [given[short], given[long]];
      if (one !== undefined && other !== undefined && !Object.is(Number(one), Number(other))) {
        throw new TypeError(`${short} and ${long} say different things.`);
      }
      return Number(one ?? other ?? start);
    }) as unknown as Matrix;
    if (numbers.every(Number.isFinite)) this.transform = numbers;
  }

  get [Symbol.toStringTag](): string {
    return 'CanvasPattern';
  }
}

/** A box: where it starts along each side, and how long it is along each. */
export type Box = readonly [x: number, y: number, width: number, height: number];

/** A box with no side less than none: one given a negative size runs back from where it starts. */
export const upright = ([x, y, width, height]: Box): Box => [
  width < 0 ? x + width : x,
  height < 0 ? y + height : y,
  Math.abs(width),
  Math.abs(height),
];

/**
 * The part of a picture `drawImage` draws, and where: the source box cut to the picture, and the
 * destination cut in the same proportion, as a canvas has it. Null where nothing is left.
 */
export function fitted(source: Box, target: Box, picture: Picture): [Box, Box] | null {
  const [sx, sy, sw, sh] = upright(source);
  const [dx, dy, dw, dh] = upright(target);
  if (!sw || !sh || !dw || !dh) return null;
  const [left, top] = [Math.max(sx, 0), Math.max(sy, 0)];
  const [right, bottom] = [Math.min(sx + sw, picture.width), Math.min(sy + sh, picture.height)];
  if (right <= left || bottom <= top) return null;
  const [kx, ky] = [dw / sw, dh / sh];
  return [
    [left, top, right - left, bottom - top],
    [dx + (left - sx) * kx, dy + (top - sy) * ky, (right - left) * kx, (bottom - top) * ky],
  ];
}
