import { parseColor } from '@ng-native/fabric';
import { canvasColour, type Rgba } from './canvas-colour.ts';
import { isUnbounded, laidBy } from './canvas-composite.ts';
import {
  contains,
  coverageOf,
  flatten,
  inverted,
  mapped,
  type Coverage,
  type FillRule,
  type Matrix,
  type Subpath,
} from './canvas-path.ts';
import { strokeOutlines, type LineStyle } from './canvas-stroke.ts';
import type { ImageData } from './image-data.ts';

/**
 * The pixels of a canvas, worked out from what its context drew only when a script reads them.
 * `canvas.ts` draws with shapes and keeps a list of what it drew beside them; a read replays
 * what is new on that list into this, and the next read starts from where this one left off.
 */

/** Where a gradient runs, on the grid it is drawn under: between two points, or two circles. */
export type GradientGeometry =
  | {
      readonly kind: 'linear';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    }
  | {
      readonly kind: 'radial';
      readonly x0: number;
      readonly y0: number;
      readonly r0: number;
      readonly x1: number;
      readonly y1: number;
      readonly r1: number;
    };

/**
 * A gradient as it was when it was drawn with: where it runs, its colours along it, and the
 * transform there was then, which is the one it runs under.
 */
export interface GradientPaint {
  readonly geometry: GradientGeometry;
  readonly colours: readonly (readonly [number, string])[];
  readonly matrix: Matrix;
}

/** Pixels a canvas holds or was given, four bytes each, not premultiplied: see `ImageData`. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * A picture's pixels painted across the grid: a pattern, or a picture drawn by `drawImage`.
 * `matrix` takes a pixel of the picture to the canvas's grid. Along a side it is not repeated,
 * the picture is there once; `within` is the part of it that is drawn, which nothing past is
 * read from.
 */
export interface PatternPaint {
  readonly pixels: Pixels;
  readonly matrix: Matrix;
  readonly repeatX: boolean;
  readonly repeatY: boolean;
  readonly within?: readonly [left: number, top: number, right: number, bottom: number];
}

/** What a shape is painted with: a colour, a gradient, or a picture. */
export type Style = string | GradientPaint | PatternPaint;

/** A clip: a path on the canvas's grid, and the rule it is filled by. */
export interface ClipPath {
  readonly d: string;
  readonly rule: FillRule;
}

/** One thing drawn: a path filled, a path stroked, or a part cleared. */
export type Operation =
  | {
      readonly kind: 'fill';
      readonly d: string;
      readonly rule: FillRule;
      readonly style: Style;
      readonly alpha: number;
      readonly clips: readonly ClipPath[];
      /** How it is laid over what is there: `globalCompositeOperation`, source-over unsaid. */
      readonly composite?: string;
    }
  | {
      readonly kind: 'stroke';
      readonly d: string;
      /** The line, on the grid of the transform there was, which is the one it is drawn under. */
      readonly line: LineStyle;
      readonly matrix: Matrix;
      readonly style: Style;
      readonly alpha: number;
      readonly clips: readonly ClipPath[];
      readonly composite?: string;
    }
  | { readonly kind: 'clear'; readonly d: string; readonly clips: readonly ClipPath[] };

/** A colour as a canvas takes one, or as `@ng-native/fabric` does where it is another form. */
const colourOf = (style: string): Rgba | null => canvasColour(style) ?? parseColor(style);

/** A colour at a place: one colour everywhere, or one that depends on where. */
type Paint = (x: number, y: number) => Rgba | null;

/** The colour at a share of the way along some colours, each eased into the next unpremultiplied. */
function colourAlong(stops: readonly (readonly [number, Rgba])[], t: number): Rgba {
  let at = 0;
  while (at < stops.length - 1 && stops[at + 1]![0] <= t) at++;
  const [offset, colour] = stops[at]!;
  const next = stops[at + 1];
  if (!next || t <= offset || next[0] <= offset) return colour;
  const share = (t - offset) / (next[0] - offset);
  return colour.map((value, channel) => value + (next[1][channel]! - value) * share) as Rgba;
}

/** How far along a radial gradient a point is: the largest that puts it on a circle of it. */
function radialShare(g: Extract<GradientGeometry, { kind: 'radial' }>, x: number, y: number) {
  const [cx, cy, dr] = [g.x1 - g.x0, g.y1 - g.y0, g.r1 - g.r0];
  const [px, py] = [x - g.x0, y - g.y0];
  const a = cx * cx + cy * cy - dr * dr;
  const b = px * cx + py * cy + g.r0 * dr;
  const c = px * px + py * py - g.r0 * g.r0;
  const fits = (w: number) => g.r0 + w * dr >= 0;
  if (Math.abs(a) < 1e-9) {
    const w = b ? c / (2 * b) : NaN;
    return Number.isFinite(w) && fits(w) ? w : null;
  }
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const [high, low] = [(b + Math.sqrt(disc)) / a, (b - Math.sqrt(disc)) / a].sort((p, q) => q - p);
  if (fits(high!)) return high!;
  return fits(low!) ? low! : null;
}

/** How far along a linear gradient a point is: where it falls on the line, as a share. */
function linearShare(g: Extract<GradientGeometry, { kind: 'linear' }>, x: number, y: number) {
  const [dx, dy] = [g.x1 - g.x0, g.y1 - g.y0];
  return ((x - g.x0) * dx + (y - g.y0) * dy) / (dx * dx + dy * dy);
}

function gradientPaint(paint: GradientPaint): Paint | null {
  const stops = paint.colours
    .map(([offset, colour]) => [offset, colourOf(colour)] as const)
    .filter((stop): stop is readonly [number, Rgba] => stop[1] !== null)
    .sort((a, b) => a[0] - b[0]);
  if (!stops.length) return null;
  const g = paint.geometry;
  if (g.kind === 'linear' && g.x0 === g.x1 && g.y0 === g.y1) return null;
  const same = g.kind === 'radial' && g.x0 === g.x1 && g.y0 === g.y1 && g.r0 === g.r1;
  const undo = inverted(paint.matrix);
  if (same || !undo) return null;
  const [a, b, c, d, e, f] = undo;
  return (px, py) => {
    const [x, y] = [a * px + c * py + e, b * px + d * py + f];
    const share = g.kind === 'linear' ? linearShare(g, x, y) : radialShare(g, x, y);
    return share === null ? null : colourAlong(stops, Math.min(1, Math.max(0, share)));
  };
}

/** Where a picture along one side is read from: repeated, or there once and nowhere else. */
function along(at: number, size: number, repeat: boolean, from: number, to: number) {
  const whole = Math.floor(at);
  if (repeat) return ((whole % size) + size) % size;
  return at < from || at >= to
    ? -1
    : Math.min(Math.max(whole, Math.floor(from)), Math.ceil(to) - 1);
}

/** The pixel of a picture nearest each place: it is drawn as it is, not smoothed. */
function patternPaint(paint: PatternPaint): Paint | null {
  const undo = inverted(paint.matrix);
  const { width, height, data } = paint.pixels;
  if (!undo || !width || !height) return null;
  const [a, b, c, d, e, f] = undo;
  const [left, top, right, bottom] = paint.within ?? [0, 0, width, height];
  return (px, py) => {
    const x = along(a * px + c * py + e, width, paint.repeatX, left, right);
    const y = along(b * px + d * py + f, height, paint.repeatY, top, bottom);
    if (x < 0 || y < 0) return null;
    const at = (y * width + x) * 4;
    return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]! / 255];
  };
}

const isGradient = (style: GradientPaint | PatternPaint): style is GradientPaint =>
  'geometry' in style;

/** What a style paints with, or null for nothing: a colour not understood paints nothing. */
function paintOf(style: Style): Paint | null {
  if (typeof style !== 'string')
    return isGradient(style) ? gradientPaint(style) : patternPaint(style);
  const colour = colourOf(style);
  return colour ? () => colour : null;
}

/** The pixels of a canvas, as `ImageData` has them: four bytes each, not premultiplied. */
export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** What a set of clips covers, worked out once for each set the drawings replayed share. */
  private readonly masks = new WeakMap<readonly ClipPath[], Float32Array>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  apply(operation: Operation): void {
    if (operation.kind === 'clear') return this.clear(operation.d, operation.clips);
    const mode = operation.composite ?? 'source-over';
    const unbounded = isUnbounded(mode);
    const paint = paintOf(operation.style) ?? (unbounded ? () => null : null);
    if (!paint || !(operation.alpha > 0 || unbounded)) return;
    const runs = flatten(operation.d);
    const covered =
      operation.kind === 'fill'
        ? coverageOf(runs, operation.rule, this.width, this.height)
        : coverageOf(
            stroked(runs, operation.line, operation.matrix),
            'nonzero',
            this.width,
            this.height,
          );
    const mask = this.maskOf(operation.clips);
    if (mode === 'source-over') {
      if (covered) this.laid(covered, paint, operation.alpha, mask);
    } else this.composited(mode, covered, paint, operation.alpha, mask);
  }

  /**
   * Lay a paint by another way than source-over. One that clears what is under no source is laid
   * over the whole canvas, with none of the shape's paint where the shape is not.
   */
  private composited(
    mode: string,
    covered: Coverage | null,
    paint: Paint,
    alpha: number,
    mask: Float32Array | null,
  ): void {
    const box = isUnbounded(mode)
      ? { left: 0, top: 0, width: this.width, height: this.height }
      : covered;
    if (!box) return;
    const unbounded = isUnbounded(mode);
    for (let y = box.top; y < box.top + box.height; y++) {
      for (let x = box.left; x < box.left + box.width; x++) {
        const clipped = mask ? mask[y * this.width + x]! : 1;
        if (clipped > 0) this.layAt(x, y, mode, unbounded, covered, paint, alpha, clipped);
      }
    }
  }

  /**
   * Lay a paint over one pixel by a way other than source-over, as much as a clip lets through.
   * A bounded way changes only what the shape covers, by as much as it covers it, as Chrome lays
   * one: `clear` empties a pixel under any source at all.
   */
  private layAt(
    x: number,
    y: number,
    mode: string,
    unbounded: boolean,
    covered: Coverage | null,
    paint: Paint,
    alpha: number,
    clipped: number,
  ): void {
    const share = covered ? coveredAt(covered, x, y) : 0;
    if (!unbounded && share <= 0) return;
    const colour = share > 0 ? paint(x + 0.5, y + 0.5) : null;
    const shown = colour ? colour[3] * alpha * (unbounded ? share : 1) : 0;
    const through = unbounded ? clipped : clipped * share;
    laidBy(mode, this.data, (y * this.width + x) * 4, colour, shown, through);
  }

  /** Pixels written as they are, over what was there: `putImageData`. */
  put(image: ImageData, x: number, y: number, from: readonly [number, number, number, number]) {
    const [left, top, wide, high] = from;
    for (let row = top; row < top + high; row++) {
      const to = y + row;
      if (to < 0 || to >= this.height) continue;
      for (let column = left; column < left + wide; column++) {
        const across = x + column;
        if (across < 0 || across >= this.width) continue;
        const source = (row * image.width + column) * 4;
        this.data.set(image.data.subarray(source, source + 4), (to * this.width + across) * 4);
      }
    }
  }

  /** The pixels of a box of it, those outside it transparent black. */
  read(target: ImageData, x: number, y: number): void {
    for (let row = 0; row < target.height; row++) {
      const from = y + row;
      if (from < 0 || from >= this.height) continue;
      const left = Math.max(0, -x);
      const right = Math.min(target.width, this.width - x);
      if (right <= left) continue;
      const start = (from * this.width + x + left) * 4;
      target.data.set(
        this.data.subarray(start, start + (right - left) * 4),
        (row * target.width + left) * 4,
      );
    }
  }

  /** Lay a paint over the pixels a shape covers, as much as it covers each, source-over. */
  private laid(covered: Coverage, paint: Paint, alpha: number, mask: Float32Array | null): void {
    const { data, width } = this;
    for (let row = 0; row < covered.height; row++) {
      const y = covered.top + row;
      for (let column = 0; column < covered.width; column++) {
        const x = covered.left + column;
        const share =
          covered.values[row * covered.width + column]! * (mask ? mask[y * width + x]! : 1);
        if (share <= 0) continue;
        const colour = paint(x + 0.5, y + 0.5);
        if (colour) over(data, (y * width + x) * 4, colour, colour[3] * alpha * share);
      }
    }
  }

  private clear(d: string, clips: readonly ClipPath[]): void {
    const covered = coverageOf(flatten(d), 'nonzero', this.width, this.height);
    if (!covered) return;
    const mask = this.maskOf(clips);
    const { data, width } = this;
    for (let row = 0; row < covered.height; row++) {
      const y = covered.top + row;
      for (let column = 0; column < covered.width; column++) {
        const x = covered.left + column;
        const share =
          covered.values[row * covered.width + column]! * (mask ? mask[y * width + x]! : 1);
        const at = (y * width + x) * 4 + 3;
        data[at] = data[at]! * (1 - share);
        if (data[at] === 0) data.fill(0, at - 3, at);
      }
    }
  }

  /** How much of each pixel a set of clips lets through: where every one of them covers. */
  private maskOf(clips: readonly ClipPath[]): Float32Array | null {
    if (!clips.length) return null;
    const known = this.masks.get(clips);
    if (known) return known;
    const mask = new Float32Array(this.width * this.height).fill(1);
    for (const clip of clips) {
      const covered = coverageOf(flatten(clip.d), clip.rule, this.width, this.height);
      const inside = new Float32Array(mask.length);
      if (covered) {
        for (let row = 0; row < covered.height; row++) {
          const start = (covered.top + row) * this.width + covered.left;
          inside.set(
            covered.values.subarray(row * covered.width, (row + 1) * covered.width),
            start,
          );
        }
      }
      for (let at = 0; at < mask.length; at++) mask[at]! *= inside[at]!;
    }
    this.masks.set(clips, mask);
    return mask;
  }
}

/** How much of a pixel a shape covers, from its coverage: none outside the box of it. */
function coveredAt(covered: Coverage, x: number, y: number): number {
  const [column, row] = [x - covered.left, y - covered.top];
  if (column < 0 || row < 0 || column >= covered.width || row >= covered.height) return 0;
  return covered.values[row * covered.width + column]!;
}

/**
 * The outlines of a line along some runs on the canvas's grid, drawn under a transform: drawn on
 * the grid of the transform and moved back, so a line scaled more one way than the other is
 * wider that way. Under one that flattens the grid, there is none.
 */
function stroked(runs: readonly Subpath[], line: LineStyle, matrix: Matrix): Subpath[] {
  const undo = inverted(matrix);
  return undo ? mapped(strokeOutlines(mapped(runs, undo), line), matrix) : [];
}

/** Lay a colour at an alpha over the pixel at `at`. */
function over(data: Uint8ClampedArray, at: number, colour: Rgba, alpha: number): void {
  if (alpha <= 0) return;
  const under = (data[at + 3]! / 255) * (1 - alpha);
  const out = alpha + under;
  for (let channel = 0; channel < 3; channel++) {
    data[at + channel] = (colour[channel]! * alpha + data[at + channel]! * under) / out;
  }
  data[at + 3] = out * 255;
}

/** Whether a point is inside a path by a rule: `isPointInPath`. */
export const pathContains = (d: string, rule: FillRule, x: number, y: number): boolean =>
  contains(flatten(d), rule, x, y);

/** Whether a point is on a path's line drawn in a style: `isPointInStroke`. */
export const strokeContains = (
  d: string,
  line: LineStyle,
  matrix: Matrix,
  x: number,
  y: number,
): boolean => contains(stroked(flatten(d), line, matrix), 'nonzero', x, y);
