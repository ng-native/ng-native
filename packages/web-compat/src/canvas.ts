import { nativePlatform, registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { viewBoxProps } from '@ng-native/icons';
import { acceptedColour, canvasColour, serializedColour } from './canvas-colour.ts';
import { isComposite, isUnbounded } from './canvas-composite.ts';
import { inverted, type FillRule, type Matrix } from './canvas-path.ts';
import {
  fitted,
  IMAGE,
  imageProps,
  matrixOf,
  PATTERN,
  Pattern,
  pictureOf,
  registerPictures,
  setPictureProps,
  uriOf,
  type Box,
  type Picture,
  type Placed,
} from './canvas-picture.ts';
import {
  pathContains,
  Raster,
  strokeContains,
  type ClipPath,
  type GradientGeometry,
  type Operation,
  type Pixels,
  type Style,
} from './canvas-raster.ts';
import { arcTurn, roundRectCorners, type Corner } from './canvas-shapes.ts';
import type { LineStyle } from './canvas-stroke.ts';
import { documentOf } from './document.ts';
import { domError } from './dom-error.ts';
import { ImageData, whole } from './image-data.ts';
import { keptOwn } from './in-document.ts';
import { pngOf } from './png.ts';
import { method, own, type Reflection } from './reflect.ts';
import { gradientShapeOf, reshape, shapeOf, textShapeOf } from './svg.ts';
import { widthOf } from './svg-box.ts';
import { engineOf } from './window.ts';

/**
 * A `<canvas>` and its 2D context, for a library that draws a chart on one. There is no bitmap
 * to draw on: what is drawn is kept as the shapes it was, and those are drawn by
 * react-native-svg, as an `<svg>` is. A path filled is a path, and a text is a text.
 *
 * Pixels put on it and pictures drawn on it are react-native-svg images, see
 * `canvas-picture.ts`: an `<img>` by its own URL, and pixels as a PNG made of them when they are
 * shown, which is the one cost a canvas that only draws shapes never pays.
 *
 * ponytail: every shape drawn since the canvas was last cleared, or last filled over all of it
 * with a colour nothing shows through, is a view. One drawn again each frame keeps the views it
 * had and moves them, see `flush`, which a chart of some tens of shapes does at the screen's
 * rate; one of thousands will not. What a bitmap alone can do is not drawn: a way of laying
 * other than source-over (`copy` with no clip is shown, as all there is), a clear of part of
 * it, and the transparent part of pixels put over part of it. A clip drawn is the last one set
 * and not where two overlap.
 * Draw on a native canvas if a library is seen that needs any of them.
 *
 * Pixels read back are worked out when they are read, see `canvas-raster.ts`: what is drawn is
 * also kept as a list of operations, and a read replays what is new on it into pixels kept for
 * the canvas. Text is not in them, and so not in another canvas this one is drawn on.
 */
type Point = readonly [number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface State {
  matrix: Matrix;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  dash: readonly number[];
  lineDashOffset: number;
  globalAlpha: number;
  /** `globalCompositeOperation`: how what is drawn is laid over what is there. */
  composite: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  /** The last clip set, drawn: null for none, and empty for one of no path, which shows nothing. */
  clip: string | null;
  /** Every clip set, each inside the last: what the pixels read back are clipped by. */
  clips: readonly ClipPath[];
}

const START: State = {
  matrix: IDENTITY,
  fillStyle: '#000',
  strokeStyle: '#000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  dash: [],
  lineDashOffset: 0,
  globalAlpha: 1,
  composite: 'source-over',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  clip: null,
  clips: [],
};

/** A shape to draw: the element it is, its attributes, and the words of a text. */
interface Shape {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly words?: string;
  /** The name of what it is clipped by, which is on the canvas's grid and not its own. */
  readonly clippedBy?: string;
  /** The rule of what it is clipped by, which native reads on what is clipped. */
  readonly clipRule?: FillRule;
  /** The colours along a gradient, for a shape that is one. */
  readonly colours?: Gradient['colours'];
  /** A picture shown: by an image in its place, `place`, inside a pattern's tile for one. */
  readonly picture?: Picture;
  readonly place?: Placed;
  readonly tile?: Record<string, unknown>;
  /** The name of what cuts a picture to the part of it drawn, inside what clips it. */
  readonly cropBy?: string;
}

const CAPS = new Set(['butt', 'round', 'square']);
const JOINS = new Set(['miter', 'round', 'bevel']);
const ALIGNS = new Set(['start', 'end', 'left', 'right', 'center']);
const BASELINE_NAMES = new Set(['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom']);

/** A font's size, then its family: what a font a canvas takes has, at least, as CSS writes it. */
const SIZED_FONT =
  /(?:^|\s)(?:[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|%)|(?:xx?-|xxx-)?(?:small|large)|medium|smaller|larger)(?:\/\S+)?\s+\S/i;

/** A canvas's size with nothing said, as a browser has one. */
const DEFAULT_SIZE = { width: 300, height: 150 };

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Whether every number given a call is one: a canvas does nothing for a call given one that is
 * not, which is how a chart leaves a point out of a line, and a path with one in it draws
 * nothing natively and stops the app in a debug build.
 */
const finite = (...numbers: unknown[]): boolean => numbers.map(Number).every(Number.isFinite);

const multiplied = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * A gradient: the numbers it was given for the line or the circles it runs between, and the
 * colours along it. They run under the transform there is when it is drawn with, as a browser
 * has it, and not the one there was when it was made: see `gradientAttributes`.
 */
class Gradient {
  readonly geometry: GradientGeometry;
  readonly colours: [at: number, colour: string][] = [];

  constructor(geometry: GradientGeometry) {
    this.geometry = geometry;
  }

  /** At an offset converted as a number is: `'0.5'` is half way along. */
  addColorStop(at: unknown, colour: string): void {
    const offset = Number(at);
    if (!Number.isFinite(offset)) throw new TypeError(`${String(at)} is not a finite number.`);
    if (offset < 0 || offset > 1) {
      throw domError(`${String(at)} is outside 0 to 1.`, 'IndexSizeError');
    }
    const given = acceptedColour(String(colour));
    if (given === undefined) throw domError(`${String(colour)} is not a colour.`, 'SyntaxError');
    this.colours.push([offset, given]);
  }

  // A library asks what a fill is by this before it eases one colour into another: Chart.js
  // takes anything else for a colour with no channels, and draws black until it has done.
  get [Symbol.toStringTag](): string {
    return 'CanvasGradient';
  }
}

/**
 * A font's size in points and its weight, from the shorthand a context is given: the weight is
 * any word before the size, after a style or a variant as much as before one.
 */
function fontOf(font: string): { size: number; weight: string | undefined } {
  const sized = /([\d.]+)px/i.exec(font);
  const before = sized ? font.slice(0, sized.index) : '';
  const weight = /(?:^|\s)(bold|[1-9]00)(?=\s)/i.exec(before)?.[1];
  return { size: Number(sized?.[1]) || 10, weight };
}

/** Where a text's baseline is against the `y` it is drawn at, as a share of its font size. */
const BASELINES: Readonly<Record<string, number>> = {
  top: 0.88,
  hanging: 0.8,
  middle: 0.34,
  alphabetic: 0,
  ideographic: -0.22,
  bottom: -0.22,
};
const ANCHORS: Readonly<Record<string, string>> = {
  left: 'start',
  start: 'start',
  center: 'middle',
  right: 'end',
  end: 'end',
};

/** The 2D context of a canvas: what a library draws with, kept as shapes. */
class Context2D {
  private state: State = { ...START };
  private readonly saved: State[] = [];
  private path: string[] = [];
  private pending: Shape[] = [];
  private cleared = false;
  private scheduled = false;
  private clips = 0;
  private paints = 0;
  /** What was drawn since the pixels were last worked out, and those pixels: see `pixels`. */
  private operations: Operation[] = [];
  private raster: Raster | null = null;
  private blank = false;
  /** How many times what it holds has changed, and its pixels as they were at one of them. */
  private version = 0;
  private shot: { readonly version: number; readonly pixels: Pixels } | null = null;
  /** The shapes on the canvas, in the order they were drawn, and where the next is drawn. */
  private readonly slots: Slot[] = [];
  private next = 0;

  readonly canvas: EngineNode;
  private readonly engine: Engine;
  /** What the shapes are drawn in: see `canvasCreated`. */
  private readonly layer: EngineNode;

  constructor(canvas: EngineNode, engine: Engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.layer = layers.get(canvas) ?? canvasCreated(canvas, engine)!;
  }

  // --- state ------------------------------------------------------------

  save(): void {
    this.saved.push({ ...this.state });
  }
  restore(): void {
    const state = this.saved.pop();
    if (state) this.state = state;
  }
  /** Everything as a new canvas has it: its size was set again. */
  reset(): void {
    this.state = { ...START };
    this.saved.length = 0;
    this.path = [];
    this.pending = [];
    this.cleared = true;
    this.clips = 0;
    this.paints = 0;
    this.operations = [];
    this.raster = null;
    this.version++;
    this.draw();
  }

  // A style reads back as a browser writes it, and one given what is no colour is no change.
  get fillStyle(): unknown {
    return styleRead(this.state.fillStyle);
  }
  set fillStyle(value: unknown) {
    this.state.fillStyle = styleGiven(value) ?? this.state.fillStyle;
  }
  get strokeStyle(): unknown {
    return styleRead(this.state.strokeStyle);
  }
  set strokeStyle(value: unknown) {
    this.state.strokeStyle = styleGiven(value) ?? this.state.strokeStyle;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: unknown) {
    const width = Number(value);
    if (width > 0 && width !== Infinity) this.state.lineWidth = width;
  }
  get lineCap(): string {
    return this.state.lineCap;
  }
  set lineCap(value: string) {
    if (CAPS.has(value)) this.state.lineCap = value;
  }
  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(value: string) {
    if (JOINS.has(value)) this.state.lineJoin = value;
  }
  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(value: unknown) {
    const limit = Number(value);
    if (limit > 0 && limit !== Infinity) this.state.miterLimit = limit;
  }
  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(value: unknown) {
    const offset = Number(value);
    if (Number.isFinite(offset)) this.state.lineDashOffset = offset;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: unknown) {
    const alpha = Number(value);
    if (alpha >= 0 && alpha <= 1) this.state.globalAlpha = alpha;
  }
  get globalCompositeOperation(): string {
    return this.state.composite;
  }
  set globalCompositeOperation(value: unknown) {
    const mode = String(value);
    if (isComposite(mode)) this.state.composite = mode;
  }
  get font(): string {
    return this.state.font;
  }
  set font(value: string) {
    if (SIZED_FONT.test(String(value))) this.state.font = String(value);
  }
  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(value: string) {
    if (ALIGNS.has(value)) this.state.textAlign = value;
  }
  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(value: string) {
    if (BASELINE_NAMES.has(value)) this.state.textBaseline = value;
  }
  /** A list with one that is no length, or not a number, is no list; an odd one is said twice. */
  setLineDash(given: readonly unknown[]): void {
    const dash = [...given].map(Number);
    if (dash.some((each) => !Number.isFinite(each) || each < 0)) return;
    this.state.dash = dash.length % 2 ? [...dash, ...dash] : dash;
  }
  getLineDash(): number[] {
    return [...this.state.dash];
  }

  // --- transforms -------------------------------------------------------

  // A transform given what is not a number is not made, as a canvas has it.
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(angle: number): void {
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    this.transform(cos, sin, -sin, cos, 0, 0);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const by: Matrix = [a, b, c, d, e, f].map(Number) as unknown as Matrix;
    if (finite(...by)) this.state.matrix = multiplied(this.state.matrix, by);
  }
  /** To six numbers, or to what a `DOMMatrix` of one has: none at all is the identity. */
  setTransform(...given: unknown[]): void {
    const init = given.length === 0 || typeof given[0] === 'object';
    const to = (init ? matrixOf(given[0]) : given.slice(0, 6).map(Number)) as unknown as Matrix;
    if (to.length === 6 && finite(...to)) this.state.matrix = to;
  }
  resetTransform(): void {
    this.state.matrix = IDENTITY;
  }
  getTransform(): Record<string, number> {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { a, b, c, d, e, f };
  }

  /** A point as the canvas has it, from one given under the transform there is now. */
  private at(x: number, y: number): string {
    const [a, b, c, d, e, f] = this.state.matrix;
    return `${round(a * x + c * y + e)} ${round(b * x + d * y + f)}`;
  }

  /** How much longer a length is drawn under the transform: a line's width, a dash. */
  private get stretch(): number {
    const [a, b, c, d] = this.state.matrix;
    return Math.sqrt(Math.abs(a * d - b * c));
  }

  // --- paths ------------------------------------------------------------

  beginPath(): void {
    this.path = [];
  }
  closePath(): void {
    if (this.path.length) this.path.push('Z');
  }
  moveTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.path.push(`M${this.at(x, y)}`);
  }
  lineTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.path.push(`${this.path.length ? 'L' : 'M'}${this.at(x, y)}`);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!finite(x1, y1, x2, y2, x, y)) return;
    if (!this.path.length) this.moveTo(x1, y1);
    this.path.push(`C${this.at(x1, y1)} ${this.at(x2, y2)} ${this.at(x, y)}`);
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number): void {
    if (!finite(x1, y1, x, y)) return;
    if (!this.path.length) this.moveTo(x1, y1);
    this.path.push(`Q${this.at(x1, y1)} ${this.at(x, y)}`);
  }
  rect(x: number, y: number, width: number, height: number): void {
    if (!finite(x, y, width, height)) return;
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
  }
  arc(x: number, y: number, radius: number, from: number, to: number, counter = false): void {
    this.ellipse(x, y, radius, radius, 0, from, to, counter);
  }
  /**
   * An arc as the curves that are nearest it, a quarter turn or less each. A radius less than
   * none is refused, as a canvas refuses it, once every number is one.
   */
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    from: number,
    to: number,
    counter = false,
  ): void {
    if (!finite(x, y, radiusX, radiusY, rotation, from, to)) return;
    if (radiusX < 0 || radiusY < 0) throw domError('A radius is less than 0.', 'IndexSizeError');
    const sweep = sweepOf(from, to, counter);
    const parts = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / parts;
    const handle = (4 / 3) * Math.tan(step / 4);
    const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
    const on = (angle: number, tangent: number): [number, number] => {
      const px = radiusX * (Math.cos(angle) - tangent * Math.sin(angle));
      const py = radiusY * (Math.sin(angle) + tangent * Math.cos(angle));
      return [x + px * cos - py * sin, y + px * sin + py * cos];
    };
    this.lineTo(...on(from, 0));
    for (let part = 0; part < parts; part++) {
      const [start, end] = [from + part * step, from + (part + 1) * step];
      const [first, second, last] = [on(start, handle), on(end, -handle), on(end, 0)];
      this.path.push(`C${this.at(...first)} ${this.at(...second)} ${this.at(...last)}`);
    }
  }
  /** The corner from where the path is, through one point, towards another, rounded. */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!finite(x1, y1, x2, y2, radius)) return;
    if (radius < 0) throw domError('The radius is less than 0.', 'IndexSizeError');
    const here = this.pathPoint();
    if (!here) return this.moveTo(x1, y1);
    const corner: Point = [Number(x1), Number(y1)];
    const undo = inverted(this.state.matrix);
    // Where the path already is at the corner, there is no corner: within its rounding.
    const [cx, cy] = this.at(...corner)
      .split(' ')
      .map(Number) as unknown as Point;
    if (!undo || Math.hypot(here[0] - cx, here[1] - cy) < 0.011) return this.lineTo(x1, y1);
    const [a, b, c, d, e, f] = undo;
    const from: Point = [a * here[0] + c * here[1] + e, b * here[0] + d * here[1] + f];
    const turn = arcTurn(from, corner, [Number(x2), Number(y2)], Number(radius));
    if (!turn) return this.lineTo(x1, y1);
    this.arc(turn.centre[0], turn.centre[1], Number(radius), turn.start, turn.end, turn.counter);
  }
  /**
   * A rectangle with its corners rounded, then a new subpath where it began. Traced the other way
   * round where it is given less than no width or height, as a canvas traces it.
   */
  roundRect(x: number, y: number, width: number, height: number, radii: unknown = 0): void {
    if (!finite(x, y, width, height)) return;
    const [left, top, wide, tall] = [x, y, width, height].map(Number) as unknown as Matrix;
    const corners = roundRectCorners(radii, wide, tall);
    if (!corners) return;
    const [ul, ur, lr, ll] = corners as [Corner, Corner, Corner, Corner];
    const [sx, sy] = [wide < 0 ? -1 : 1, tall < 0 ? -1 : 1];
    const [right, bottom] = [left + wide, top + tall];
    this.moveTo(left + sx * ul.x, top);
    this.quarter([right - sx * ur.x, top + sy * ur.y], ur, [0, -sy], [sx, 0]);
    this.quarter([right - sx * lr.x, bottom - sy * lr.y], lr, [sx, 0], [0, sy]);
    this.quarter([left + sx * ll.x, bottom - sy * ll.y], ll, [0, sy], [-sx, 0]);
    this.quarter([left + sx * ul.x, top + sy * ul.y], ul, [-sx, 0], [0, -sy]);
    this.closePath();
    this.moveTo(left, top);
  }
  /** A quarter of an ellipse around a centre, from one side of it to the next, the short way. */
  private quarter(centre: Point, radii: Corner, from: Point, to: Point): void {
    const [start, end] = [Math.atan2(from[1], from[0]), Math.atan2(to[1], to[0])];
    let sweep = end - start;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    this.ellipse(centre[0], centre[1], radii.x, radii.y, 0, start, start + sweep, sweep < 0);
  }
  /** Where the path is now, on the canvas's grid: where its last part ends, or null for none. */
  private pathPoint(): Point | null {
    let at = this.path.length - 1;
    // After a close, where the closed subpath began.
    if (this.path[at] === 'Z') while (at > 0 && !this.path[at]!.startsWith('M')) at--;
    const last = this.path[at];
    if (!last || last === 'Z') return null;
    const numbers = last.slice(1).split(' ').map(Number);
    return [numbers[numbers.length - 2]!, numbers[numbers.length - 1]!];
  }

  // --- drawing ----------------------------------------------------------

  fill(rule?: unknown): void {
    if (!this.path.length) return;
    const d = this.path.join('');
    this.copied();
    const odd: Record<string, string> =
      ruleOf(rule) === 'evenodd' ? { 'fill-rule': 'evenodd' } : {};
    this.add('path', { d, ...odd, ...this.filled() });
    const { fillStyle, globalAlpha: alpha, clips, matrix, composite } = this.state;
    const style = styleOf(fillStyle, matrix);
    this.operation({ kind: 'fill', d, rule: ruleOf(rule), style, alpha, clips, composite });
  }
  stroke(): void {
    if (!this.path.length) return;
    const d = this.path.join('');
    this.copied();
    this.add('path', { d, ...this.stroked() });
    const { strokeStyle, globalAlpha: alpha, clips, matrix, composite } = this.state;
    const [style, line] = [styleOf(strokeStyle, matrix), this.line()];
    this.operation({ kind: 'stroke', d, line, matrix, style, alpha, clips, composite });
  }
  clip(rule?: unknown): void {
    const d = this.path.join('');
    // Inside one of no path is nothing too.
    this.state.clip = this.path.length && this.state.clip !== '' ? d : '';
    this.state.clips = [...this.state.clips, { d, rule: ruleOf(rule) }];
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    if (finite(x, y, width, height) && this.paintsOver(x, y, width, height)) this.overAll();
    this.withPath(
      () => this.rect(x, y, width, height),
      () => this.fill(),
    );
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.withPath(
      () => this.rect(x, y, width, height),
      () => this.stroke(),
    );
  }
  /**
   * A clear of the whole canvas is a new drawing. Of part of it, nothing drawn, see the note
   * above, and that part of the pixels read back is cleared.
   */
  clearRect(x: number, y: number, width: number, height: number): void {
    if (!finite(x, y, width, height)) return;
    if (!this.covers(x, y, width, height)) return this.clearPart(x, y, width, height);
    // Under a clip, the pixels are cleared only inside it. The shapes all go, see the note above.
    if (this.state.clips.length) this.clearPart(x, y, width, height);
    else [this.operations, this.blank] = [[], true];
    this.version++;
    this.startOver();
  }
  fillText(text: string, x: number, y: number): void {
    this.text(text, x, y, this.filled());
  }
  strokeText(text: string, x: number, y: number): void {
    this.text(text, x, y, this.stroked());
  }
  measureText(text: string): Record<string, number> {
    const { size, weight } = fontOf(this.state.font);
    const width = widthOf(String(text), size, weight);
    // From the baseline `textBaseline` names, as a browser measures and `text` draws.
    const shift = (BASELINES[this.state.textBaseline] ?? 0) * size;
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: size * 0.75 - shift,
      actualBoundingBoxDescent: size * 0.22 + shift,
      fontBoundingBoxAscent: size * 0.88 - shift,
      fontBoundingBoxDescent: size * 0.22 + shift,
    };
  }
  createLinearGradient(x1: number, y1: number, x2: number, y2: number): Gradient {
    if (!finite(x1, y1, x2, y2)) throw new TypeError('A point of the gradient is not a number.');
    const [x0, y0, x3, y3] = [x1, y1, x2, y2].map(Number) as [number, number, number, number];
    return new Gradient({ kind: 'linear', x0, y0, x1: x3, y1: y3 });
  }
  /** Between two circles: drawn from the middle of the first out to the edge of the second. */
  createRadialGradient(
    x1: number,
    y1: number,
    radius1: number,
    x2: number,
    y2: number,
    radius2: number,
  ): Gradient {
    if (!finite(x1, y1, radius1, x2, y2, radius2)) {
      throw new TypeError('A circle of the gradient is not a number.');
    }
    if (radius1 < 0 || radius2 < 0) throw domError('A radius is less than 0.', 'IndexSizeError');
    const [x0, y0, r0, x3, y3, r1] = [x1, y1, radius1, x2, y2, radius2].map(
      Number,
    ) as unknown as Matrix;
    return new Gradient({ kind: 'radial', x0, y0, r0, x1: x3, y1: y3, r1 });
  }
  /** A picture repeated: null for an image that has not loaded, which has nothing to repeat. */
  createPattern(image: unknown, repetition: unknown): Pattern | null {
    const picture = pictureOf(image, pixelsOfCanvas);
    // Refused for a repetition that is none whether or not the picture is ready.
    const pattern = new Pattern(
      picture ?? { width: 0, height: 0 },
      repetition === null ? '' : String(repetition),
    );
    return picture ? pattern : null;
  }
  /**
   * A picture drawn: at a place, stretched over a box, or a part of it over a box. Shown as an
   * image of it, cut to the part drawn, and in the pixels read back where its own are known.
   */
  drawImage(image: unknown, ...numbers: unknown[]): void {
    const picture = pictureOf(image, pixelsOfCanvas);
    if (![2, 4, 8].includes(numbers.length))
      throw new TypeError('drawImage takes 3, 5 or 9 arguments.');
    if (!finite(...numbers) || !picture) return;
    const given = numbers.map(Number);
    const whole: Box = [0, 0, picture.width, picture.height];
    const source = given.length === 8 ? (given.slice(0, 4) as unknown as Box) : whole;
    const at = given.length === 8 ? given.slice(4) : given;
    const target: Box = [at[0]!, at[1]!, at[2] ?? picture.width, at[3] ?? picture.height];
    const parts = fitted(source, target, picture);
    if (parts) this.picture(picture, ...parts);
  }
  /** Whether a point on the canvas's grid, not under the transform, is in the path. */
  isPointInPath(x: unknown, y: unknown, rule?: unknown): boolean {
    // ponytail: a `Path2D` of its own is not kept. Answer one if a library is seen asking.
    if (typeof x === 'object' || !finite(x, y) || !this.path.length) return false;
    return pathContains(this.path.join(''), ruleOf(rule), Number(x), Number(y));
  }
  isPointInStroke(x: unknown, y: unknown): boolean {
    if (typeof x === 'object' || !finite(x, y) || !this.path.length) return false;
    const { matrix } = this.state;
    return strokeContains(this.path.join(''), this.line(), matrix, Number(x), Number(y));
  }

  // --- pixels -----------------------------------------------------------

  /** The pixels of a box of the canvas, worked out now from what was drawn. */
  getImageData(sx: unknown, sy: unknown, sw: unknown, sh: unknown): ImageData {
    const [x, width] = spanOf(whole(sx), whole(sw));
    const [y, height] = spanOf(whole(sy), whole(sh));
    const image = new (imageDataClass())(width, height);
    this.pixels().read(image, x, y);
    return image;
  }
  createImageData(widthOrImage: unknown, height?: unknown): ImageData {
    if (isImageData(widthOrImage)) {
      return new (imageDataClass())(widthOrImage.width, widthOrImage.height);
    }
    const [wide, high] = [whole(widthOrImage), whole(height)];
    if (!wide || !high) throw domError('The width and height must not be zero.', 'IndexSizeError');
    return new (imageDataClass())(Math.abs(wide), Math.abs(high));
  }
  /**
   * Pixels written over a box of the canvas as they are: not laid over, and not clipped. Shown
   * as an image of them over what is drawn, or as all there is where they cover the canvas.
   */
  putImageData(image: unknown, dx: unknown, dy: unknown, ...dirty: unknown[]): void {
    if (!isImageData(image)) throw new TypeError('The image is not an ImageData.');
    const [x, y] = [whole(dx), whole(dy)];
    const box =
      dirty.length >= 4 ? dirty.slice(0, 4).map(whole) : [0, 0, image.width, image.height];
    const [left, wide] = dirtySpan(box[0]!, box[2]!, image.width);
    const [top, high] = dirtySpan(box[1]!, box[3]!, image.height);
    if (wide <= 0 || high <= 0) return;
    this.pixels().put(image, x, y, [left, top, wide, high]);
    this.version++;
    const size = canvasSize(this.canvas);
    const [at, down] = [x + left, y + top];
    if (at <= 0 && down <= 0 && at + wide >= size.width && down + high >= size.height) {
      this.startOver();
    }
    const pixels = cropped(image, left, top, wide, high);
    const place = { x: at, y: down, width: wide, height: high };
    this.pending.push({
      name: 'image',
      attrs: {},
      picture: { width: wide, height: high, pixels },
      place,
    });
    this.draw();
  }

  /** Its pixels as they are now: the same object until it changes, see `drawImage`. */
  snapshot(): Pixels {
    if (this.shot?.version === this.version) return this.shot.pixels;
    const raster = this.pixels();
    const pixels = { width: raster.width, height: raster.height, data: raster.data.slice() };
    this.shot = { version: this.version, pixels };
    return pixels;
  }

  /**
   * The canvas's pixels, with what was drawn since they were last asked for laid on them. The
   * first read of a canvas replays all of its drawing since it was last cleared whole.
   */
  private pixels(): Raster {
    const { width, height } = canvasSize(this.canvas);
    if (!this.raster) this.raster = new Raster(width, height);
    else if (this.blank) this.raster.data.fill(0);
    this.blank = false;
    for (const operation of this.operations) this.raster.apply(operation);
    this.operations = [];
    return this.raster;
  }

  /** Whether a box under the transform covers all of the canvas's grid. */
  private covers(x: number, y: number, width: number, height: number): boolean {
    const undo = inverted(this.state.matrix);
    if (!undo) return false;
    const { width: wide, height: high } = canvasSize(this.canvas);
    const [a, b, c, d, e, f] = undo;
    const [left, right] = [Math.min(x, x + width), Math.max(x, x + width)];
    const [top, bottom] = [Math.min(y, y + height), Math.max(y, y + height)];
    const corners: Point[] = [
      [0, 0],
      [wide, 0],
      [0, high],
      [wide, high],
    ];
    return corners.every(([cx, cy]) => {
      const [px, py] = [a * cx + c * cy + e, b * cx + d * cy + f];
      return px >= left - 1e-9 && px <= right + 1e-9 && py >= top - 1e-9 && py <= bottom + 1e-9;
    });
  }

  /**
   * Whether a box filled now hides all that was drawn before: a colour that lets nothing
   * through, laid over as it is, unclipped, over all of the grid.
   */
  private paintsOver(x: number, y: number, width: number, height: number): boolean {
    const { fillStyle, globalAlpha, composite, clips } = this.state;
    if (globalAlpha < 1 || composite !== 'source-over' || clips.length) return false;
    const colour = typeof fillStyle === 'string' ? canvasColour(fillStyle) : null;
    return (colour?.[3] ?? 0) >= 1 && this.covers(x, y, width, height);
  }

  /** What was drawn before is hidden by what is drawn now: a new drawing, as a whole clear is. */
  private overAll(): void {
    [this.operations, this.blank] = [[], true];
    this.startOver();
  }

  private clearPart(x: number, y: number, width: number, height: number): void {
    const d = this.rectPath(x, y, width, height);
    if (d) this.operation({ kind: 'clear', d, clips: this.state.clips });
  }

  /** A box under the transform, as a path on the canvas's grid. */
  private rectPath(x: number, y: number, width: number, height: number): string {
    const held = this.path;
    this.path = [];
    this.rect(x, y, width, height);
    const d = this.path.join('');
    this.path = held;
    return d;
  }

  /** Something drawn, for the pixels read back: what this canvas holds has changed. */
  private operation(operation: Operation): void {
    this.operations.push(operation);
    this.version++;
  }

  /** A new drawing: what is kept to be drawn goes, and the shapes there are go when it is. */
  private startOver(): void {
    this.pending = [];
    this.cleared = true;
    // Named from the first again: a drawing made again names what clips it as it did.
    this.clips = 0;
    this.paints = 0;
    this.draw();
  }

  /** What is drawn by `copy` with nothing clipping it is all there is: shown as a new drawing. */
  private copied(): void {
    if (this.state.composite === 'copy' && !this.state.clips.length) this.startOver();
  }

  /**
   * Draw part of a picture over a box: shown as an image of the whole of it, placed so that the
   * part is over the box, and cut to the box where it is not the whole.
   */
  private picture(picture: Picture, source: Box, target: Box): void {
    const [sx, sy, sw, sh] = source;
    const [dx, dy, dw, dh] = target;
    const [kx, ky] = [dw / sw, dh / sh];
    const { matrix, globalAlpha: alpha, clips, composite } = this.state;
    const d = this.rectPath(dx, dy, dw, dh);
    const style: Style = picture.pixels
      ? {
          pixels: picture.pixels,
          matrix: multiplied(matrix, [kx, 0, 0, ky, dx - sx * kx, dy - sy * ky]),
          repeatX: false,
          repeatY: false,
          within: [sx, sy, sx + sw, sy + sh],
        }
      : 'transparent';
    this.operation({ kind: 'fill', d, rule: 'nonzero', style, alpha, clips, composite });
    this.copied();
    const place = {
      x: dx - sx * kx,
      y: dy - sy * ky,
      width: picture.width * kx,
      height: picture.height * ky,
      matrix,
      opacity: alpha,
    };
    const whole = sx === 0 && sy === 0 && sw === picture.width && sh === picture.height;
    const cropBy = whole ? undefined : `canvas-clip-${this.clips++}`;
    if (cropBy) this.pending.push({ name: 'clipPath', attrs: { id: cropBy, d } });
    this.add('image', {}, undefined, { picture, place, cropBy });
  }

  /** The line a stroke is drawn with now, on the grid of the transform there is. */
  private line(): LineStyle {
    const { lineWidth: width, lineCap: cap, lineJoin: join, miterLimit, dash } = this.state;
    return { width, cap, join, miterLimit, dash, dashOffset: this.state.lineDashOffset };
  }

  /** Draw one path of its own, and leave the path being built as it was. */
  private withPath(build: () => void, drawIt: () => void): void {
    const held = this.path;
    this.path = [];
    build();
    drawIt();
    this.path = held;
  }

  private text(text: string, x: number, y: number, paint: Record<string, string>): void {
    if (!finite(x, y)) return;
    // Its pixels are not read back, but what it clears of what was there is, as with a shape.
    const { globalAlpha: alpha, clips, composite } = this.state;
    if (isUnbounded(composite)) {
      this.operation({
        kind: 'fill',
        d: '',
        rule: 'nonzero',
        style: 'transparent',
        alpha,
        clips,
        composite,
      });
    }
    this.copied();
    const { size, weight } = fontOf(this.state.font);
    const [a, b, c, d, e, f] = this.state.matrix;
    this.add(
      'text',
      {
        x: '0',
        y: String(round((BASELINES[this.state.textBaseline] ?? 0) * size)),
        transform: `matrix(${[a, b, c, d, round(a * x + c * y + e), round(b * x + d * y + f)].join(' ')})`,
        'font-size': String(size),
        ...(weight ? { 'font-weight': weight } : {}),
        'text-anchor': ANCHORS[this.state.textAlign] ?? 'start',
        ...paint,
      },
      String(text),
    );
  }

  private filled(): Record<string, string> {
    return { fill: this.paint(this.state.fillStyle), ...this.seenThrough() };
  }

  /** A paint as a shape names it: a colour, or a gradient kept to be drawn before the shape. */
  private paint(style: unknown): string {
    if (style instanceof Pattern) return this.tiled(style);
    if (!(style instanceof Gradient)) return typeof style === 'string' ? style : '#000';
    if (!style.colours.length) return 'none';
    const id = `canvas-paint-${this.paints++}`;
    const { name, attrs } = gradientAttributes(style.geometry, this.state.matrix);
    // As they are now: a colour added after it is drawn with is not on what was drawn.
    this.pending.push({ name, attrs: { ...attrs, id }, colours: [...style.colours] });
    return `url(#${id})`;
  }

  /**
   * A pattern kept to be drawn before the shape: a tile of its picture, on the grid of the
   * transform there is. Along a side it does not repeat, the tile is as long as the canvas is
   * there, so that no other picture of it is on the canvas.
   */
  private tiled(pattern: Pattern): string {
    const id = `canvas-paint-${this.paints++}`;
    const matrix = multiplied(this.state.matrix, pattern.matrix);
    const { width, height } = pattern.picture;
    const [x, y, wide, high] = tileOf(matrix, pattern, canvasSize(this.canvas));
    const tile = {
      name: id,
      x,
      y,
      width: wide,
      height: high,
      patternUnits: 1,
      patternContentUnits: 1,
      patternTransform: [...matrix],
    };
    const place = { x: 0, y: 0, width, height };
    this.pending.push({ name: 'pattern', attrs: {}, picture: pattern.picture, place, tile });
    return `url(#${id})`;
  }

  private stroked(): Record<string, string> {
    const { lineWidth, lineCap, lineJoin, miterLimit, dash, lineDashOffset } = this.state;
    const stretch = this.stretch;
    return {
      fill: 'none',
      stroke: this.paint(this.state.strokeStyle),
      'stroke-width': String(round(lineWidth * stretch)),
      'stroke-linecap': lineCap,
      'stroke-linejoin': lineJoin,
      'stroke-miterlimit': String(miterLimit),
      ...(dash.length
        ? {
            'stroke-dasharray': dash.map((each) => round(each * stretch)).join(' '),
            'stroke-dashoffset': String(round(lineDashOffset * stretch)),
          }
        : {}),
      ...this.seenThrough(),
    };
  }

  private seenThrough(): Record<string, string> {
    return this.state.globalAlpha < 1 ? { opacity: String(this.state.globalAlpha) } : {};
  }

  /** Keep a shape to draw, under the clip there is now, and draw what is kept before long. */
  private add(
    name: string,
    attrs: Record<string, string>,
    words?: string,
    more: Partial<Shape> = {},
  ): void {
    const clip = this.state.clip;
    if (clip === '') return;
    const id = clip ? `canvas-clip-${this.clips++}` : undefined;
    // The rule of the last clip set, which is the one drawn.
    const clipRule = this.state.clips.at(-1)?.rule;
    if (clip && id) {
      this.pending.push({ name: 'clipPath', attrs: { id, d: clip, 'clip-rule': clipRule! } });
    }
    this.pending.push({ name, attrs, words, clippedBy: id, clipRule, ...more });
    this.draw();
  }

  /** Draw what is kept once the script drawing it is done: a chart is drawn in one go. */
  private draw(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /**
   * Draw what is kept. A canvas cleared and drawn again is drawn over the shapes it had: each
   * is kept where the one drawn in its place is of its kind, and given what that one says, so
   * a frame of an animation moves the views there are and makes none. From the first that is
   * of another kind they are made afresh, and what is left over of the last drawing goes.
   */
  private flush(): void {
    this.scheduled = false;
    const { layer, engine, canvas } = this;
    // Back in the canvas where a script took what it holds out: `textContent = ''` clears a
    // canvas's fallback content, and not what is drawn on it.
    if (layer.parent !== canvas) engine.appendChild(canvas, layer);
    if (this.cleared) this.next = 0;
    for (const shape of this.pending) {
      const held = this.slots[this.next];
      if (held?.kind === kindOf(shape)) redrawn(held, shape, engine);
      else {
        this.forget(this.next);
        const slot = slotOf(shape, engine);
        this.slots.push(slot);
        engine.appendChild(layer, slot.node);
      }
      this.next++;
    }
    if (this.cleared) this.forget(this.next);
    this.cleared = false;
    this.pending = [];
    engine.commit();
  }

  /** Take away the shapes kept from `from` on. */
  private forget(from: number): void {
    for (const slot of this.slots.splice(from)) this.engine.removeChild(this.layer, slot.node);
  }
}

/**
 * What a style is given as: a gradient, a pattern, or a colour as it was written. Undefined for
 * no colour.
 */
function styleGiven(value: unknown): unknown {
  return value instanceof Gradient || value instanceof Pattern
    ? value
    : acceptedColour(String(value));
}

const styleRead = (style: unknown): unknown =>
  typeof style === 'string' ? serializedColour(style) : style;

const ruleOf = (rule: unknown): FillRule => (rule === 'evenodd' ? 'evenodd' : 'nonzero');

/**
 * A gradient as a shape draws it, on the canvas's grid under a transform: the points it runs
 * between where the transform puts them, and its outer circle's radius as long as the transform
 * makes a length. A radial one drawn under a transform that stretches one way more than another
 * is drawn as a circle, not the ellipse it is in the pixels read back.
 */
function gradientAttributes(
  geometry: GradientGeometry,
  [a, b, c, d, e, f]: Matrix,
): { name: string; attrs: Record<string, string> } {
  const at = (x: number, y: number) => [round(a * x + c * y + e), round(b * x + d * y + f)];
  const userSpace = { gradientUnits: 'userSpaceOnUse' };
  if (geometry.kind === 'linear') {
    const [[x1, y1], [x2, y2]] = [at(geometry.x0, geometry.y0), at(geometry.x1, geometry.y1)];
    const ends = { x1: x1!, y1: y1!, x2: x2!, y2: y2! };
    return { name: 'linearGradient', attrs: { ...stringsOf(ends), ...userSpace } };
  }
  const [[fx, fy], [cx, cy]] = [at(geometry.x0, geometry.y0), at(geometry.x1, geometry.y1)];
  const r = round(geometry.r1 * Math.sqrt(Math.abs(a * d - b * c)));
  const circles = { fx: fx!, fy: fy!, cx: cx!, cy: cy!, r };
  return { name: 'radialGradient', attrs: { ...stringsOf(circles), ...userSpace } };
}

const stringsOf = (numbers: Record<string, number>): Record<string, string> =>
  Object.fromEntries(Object.entries(numbers).map(([key, value]) => [key, String(value)]));

/** A style as the pixels are painted with it: a colour, or a gradient or a pattern as it is now. */
function styleOf(style: unknown, matrix: Matrix): Style {
  if (style instanceof Gradient) {
    return { geometry: style.geometry, colours: [...style.colours], matrix };
  }
  if (style instanceof Pattern) {
    const { pixels } = style.picture;
    if (!pixels) return 'transparent';
    const { repeatX, repeatY } = style;
    return { pixels, matrix: multiplied(matrix, style.matrix), repeatX, repeatY };
  }
  return typeof style === 'string' ? style : '#000';
}

/** Pixels of a box of an image, copied: what is put stays as it was put. */
function cropped(image: ImageData, left: number, top: number, wide: number, high: number): Pixels {
  const data = new Uint8ClampedArray(wide * high * 4);
  for (let row = 0; row < high; row++) {
    const from = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(from, from + wide * 4), row * wide * 4);
  }
  return { width: wide, height: high, data };
}

/**
 * A pattern's tile on its own grid: its picture along a side it repeats along, and along one it
 * does not, all of the canvas and the picture, which no other tile is then on.
 */
function tileOf(matrix: Matrix, pattern: Pattern, size: { width: number; height: number }): Box {
  const undo = inverted(matrix) ?? IDENTITY;
  const [a, b, c, d, e, f] = undo;
  const corners = [
    [0, 0],
    [size.width, 0],
    [0, size.height],
    [size.width, size.height],
  ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f] as const);
  const span = (side: 0 | 1, length: number, repeats: boolean): [number, number] => {
    if (repeats) return [0, length];
    const from = Math.floor(Math.min(0, ...corners.map((corner) => corner[side])));
    const to = Math.ceil(Math.max(length, ...corners.map((corner) => corner[side])));
    return [from, to - from];
  };
  const [x, wide] = span(0, pattern.picture.width, pattern.repeatX);
  const [y, high] = span(1, pattern.picture.height, pattern.repeatY);
  return [x, y, wide, high];
}

/** Where a box read starts along one side, and how long it is: a negative size reads back. */
function spanOf(start: number, size: number): [number, number] {
  if (!size) throw domError('The source width and height must not be zero.', 'IndexSizeError');
  return size < 0 ? [start + size, -size] : [start, size];
}

/** The part of an image along one side that a put writes: within the image, and not reversed. */
function dirtySpan(start: number, size: number, length: number): [number, number] {
  let [from, to] = size < 0 ? [start + size, start] : [start, start + size];
  from = Math.max(0, from);
  to = Math.min(length, to);
  return [from, to - from];
}

/** The `ImageData` a script makes its own with: the runtime's, where it has one. */
const imageDataClass = (): typeof ImageData =>
  (globalThis as unknown as { ImageData?: typeof ImageData }).ImageData ?? ImageData;

const isImageData = (value: unknown): value is ImageData =>
  value instanceof ImageData || value instanceof imageDataClass();

/** How far an arc turns: all the way round where its ends say so, and the way it is asked to. */
function sweepOf(from: number, to: number, counter: boolean): number {
  const turn = Math.PI * 2;
  const sweep = to - from;
  if (!counter && sweep >= turn) return turn;
  if (counter && sweep <= -turn) return -turn;
  // The other way round, as far as the end's angle is: from 0 to a whole turn back is a circle.
  if (!counter && sweep < 0) return turn - (-sweep % turn);
  if (counter && sweep > 0) return -(turn - (sweep % turn));
  return sweep;
}

/** A shape on the canvas: the node the canvas holds for it, and the one that draws it. */
interface Slot {
  readonly kind: string;
  readonly node: EngineNode;
  readonly shape: EngineNode;
}

/** What a shape can be drawn over: one of its element, with words, a clip or a cut as it has. */
const kindOf = (shape: Shape): string =>
  [
    shape.name,
    shape.words === undefined ? '' : ' words',
    shape.clippedBy ? ' clipped' : '',
    shape.cropBy ? ' cut' : '',
  ].join('');

/**
 * What clips by a clip path: with its rule said, as native is even-odd with none said where a
 * canvas is non-zero.
 */
const clipping = (id: string, rule: FillRule = 'nonzero'): Record<string, string> => ({
  'clip-path': `url(#${id})`,
  'clip-rule': rule,
});

/** The path a clip path holds: its rule as well, which is where a browser reads it. */
const clipPathOf = ({ id: _, ...path }: Readonly<Record<string, string>>) => path;

/** A shape as the nodes that draw it. What clips others holds the path it clips to. */
function slotOf(shape: Shape, engine: Engine): Slot {
  const kind = kindOf(shape);
  if (shape.picture) return pictureSlot(shape, engine);
  if (shape.colours) {
    const node = gradientShapeOf(engine, shape.name, shape.attrs, shape.colours);
    return { kind, node, shape: node };
  }
  if (shape.name === 'clipPath') {
    // Inside a definition: Android warns on every draw of a clip path outside one.
    const clip = shapeOf(engine, 'clipPath', { id: shape.attrs['id']! });
    const path = shapeOf(engine, 'path', clipPathOf(shape.attrs));
    engine.appendChild(clip, path);
    const node = shapeOf(engine, 'defs', {});
    engine.appendChild(node, clip);
    return { kind, node, shape: path };
  }
  const drawn =
    shape.words === undefined
      ? shapeOf(engine, shape.name, shape.attrs)
      : textShapeOf(engine, shape.attrs, shape.words);
  if (shape.clippedBy === undefined) return { kind, node: drawn, shape: drawn };
  // Around the shape, and not on it: a clip is read where what it clips is drawn, and a text
  // is moved to its place by a transform of its own.
  const node = shapeOf(engine, 'g', clipping(shape.clippedBy, shape.clipRule));
  engine.appendChild(node, drawn);
  return { kind, node, shape: drawn };
}

/**
 * A picture as the nodes that show it: an image, inside a pattern for one, or inside what cuts
 * it to the part drawn and what clips it.
 */
function pictureSlot(shape: Shape, engine: Engine): Slot {
  const kind = kindOf(shape);
  const image = engine.createElement(IMAGE);
  setPictureProps(engine, image, imageProps(shape.picture!, shape.place!));
  let node = image;
  if (shape.tile) {
    // Inside a definition, which draws nothing where it is: a pattern outside one draws its
    // tile at the drawing's corner as well as filling with it.
    const pattern = engine.createElement(PATTERN);
    setPictureProps(engine, pattern, shape.tile);
    engine.appendChild(pattern, image);
    const defined = shapeOf(engine, 'defs', {});
    engine.appendChild(defined, pattern);
    return { kind, node: defined, shape: image };
  }
  for (const [by, rule] of [[shape.cropBy], [shape.clippedBy, shape.clipRule]] as const) {
    if (by === undefined) continue;
    const group = shapeOf(engine, 'g', clipping(by, rule));
    engine.appendChild(group, node);
    node = group;
  }
  return { kind, node, shape: image };
}

/** Give the nodes of a picture what another of its kind says. */
function repictured(slot: Slot, shape: Shape, engine: Engine): void {
  setPictureProps(engine, slot.shape, imageProps(shape.picture!, shape.place!));
  if (shape.tile) return setPictureProps(engine, slot.shape.parent!, shape.tile);
  if (shape.cropBy) reshape(engine, slot.shape.parent!, clipping(shape.cropBy));
  if (shape.clippedBy) reshape(engine, slot.node, clipping(shape.clippedBy, shape.clipRule));
}

/** Give the nodes of a shape what another of its kind says. */
function redrawn(slot: Slot, shape: Shape, engine: Engine): void {
  if (shape.picture) return repictured(slot, shape, engine);
  if (shape.colours) {
    reshape(engine, slot.node, shape.attrs);
    return void gradientShapeOf(engine, shape.name, shape.attrs, shape.colours, slot.node);
  }
  if (shape.name === 'clipPath') {
    reshape(engine, slot.shape.parent!, { id: shape.attrs['id']! });
    return reshape(engine, slot.shape, clipPathOf(shape.attrs));
  }
  reshape(engine, slot.shape, shape.attrs);
  if (shape.clippedBy !== undefined) {
    reshape(engine, slot.node, clipping(shape.clippedBy, shape.clipRule));
  }
  // A text's words are all it holds.
  const words = slot.shape.childList[0];
  if (shape.words !== undefined && words && words.nodeText !== shape.words) {
    engine.setText(words, shape.words);
  }
}

const contexts = new WeakMap<EngineNode, Context2D>();
const layers = new WeakMap<EngineNode, EngineNode>();

/**
 * Give a canvas the group its shapes are drawn in, as it is made: Android repaints a drawing for
 * a shape added to a group in it, and not for one added to the drawing itself, or to a group
 * that came with the shape, once it was first painted.
 */
export function canvasCreated(node: EngineNode, engine: Engine): EngineNode | undefined {
  if (node.tag !== 'canvas') return;
  const layer = shapeOf(engine, 'g', {});
  // What it draws is its own, and no child a script sees: see `keptOwn`.
  keptOwn.add(layer);
  engine.appendChild(node, layer);
  layers.set(node, layer);
  return layer;
}
/** The `width` and `height` each canvas was given, as written: what its size is read from. */
const written = new WeakMap<EngineNode, Record<string, string>>();

/** A canvas's `width` and `height` as `getAttribute` reads them. */
export const canvasAttributes = (node: EngineNode): Readonly<Record<string, string>> =>
  written.get(node) ?? NONE;
const NONE: Readonly<Record<string, string>> = {};

/** The props of a canvas's view box, which it is drawn by and are no attribute of it. */
const VIEW_BOX = new Set(Object.keys(viewBoxProps('0 0 1 1')));
export const isCanvasBox = (node: EngineNode, key: string): boolean =>
  node.tag === 'canvas' && VIEW_BOX.has(key);

/** Give a copy of a canvas the size it was given: see `cloneNode`. */
export function copyCanvas(from: EngineNode, to: EngineNode, engine: Engine): void {
  const given = written.get(from);
  // Sized where what it is a copy of is: by what was written, or by a context it was drawn by.
  if (to.tag !== 'canvas' || (!given && !contexts.has(from))) return;
  if (given) written.set(to, { ...given });
  sizeCanvas(to, engine);
}

/**
 * `canvas.getContext('2d')`: the one context a canvas has. No other kind is drawn, and a canvas
 * in an app that did not ask for the package draws none.
 */
export function contextOf(node: EngineNode, kind: unknown, engine: Engine): Context2D | null {
  if (node.tag !== 'canvas' || kind !== '2d' || !documentOf(engine)) return null;
  let context = contexts.get(node);
  if (!context) {
    contexts.set(node, (context = new Context2D(node, engine)));
    sizeCanvas(node, engine);
  }
  return context;
}

/** A canvas's own size: the grid it is drawn on, which its style then fits to a box. */
export function canvasSize(node: EngineNode): { width: number; height: number } {
  const { width, height } = canvasAttributes(node);
  return { width: sizeGiven(width, 'width'), height: sizeGiven(height, 'height') };
}

/**
 * `width` or `height` set on a canvas, as an attribute or a property, or taken away: the grid
 * it is drawn on is that size, and everything drawn on it is gone, as a browser has it. Answers
 * whether the node is a canvas.
 */
export function setCanvasSize(
  node: EngineNode,
  side: string,
  value: unknown,
  engine: Engine,
): boolean {
  if (node.tag !== 'canvas' || (side !== 'width' && side !== 'height')) return false;
  const { [side]: _, ...rest } = canvasAttributes(node);
  // One set again keeps its place, as a browser keeps an attribute's.
  const given = { ...canvasAttributes(node), [side]: String(value) };
  written.set(node, value == null ? rest : given);
  sizeCanvas(node, engine);
  contexts.get(node)?.reset();
  return true;
}

/**
 * A canvas's side as a non-negative whole number is read, as a browser reads one: what is not one
 * is the size it has with nothing said, and none is a canvas of no size.
 */
function sizeGiven(value: unknown, side: 'width' | 'height'): number {
  const digits = /^[\t\n\f\r ]*\+?(\d+)/.exec(
    typeof value === 'number' ? String(Math.trunc(value)) : String(value),
  );
  return digits ? Number(digits[1]) : DEFAULT_SIZE[side];
}

function sizeCanvas(node: EngineNode, engine: Engine) {
  const size = canvasSize(node);
  const box = viewBoxProps(`0 0 ${size.width} ${size.height}`);
  // A view box of no size is none: native divides by it.
  const drawn = size.width > 0 && size.height > 0;
  for (const [key, value] of Object.entries(box)) engine.setProp(node, key, drawn ? value : null);
  // As large as its grid where no style says, as a browser draws one.
  engine.setDefaultStyle(node, size);
}

/** Register the canvas element, and answer what takes it away again. */
export function registerCanvas(): () => void {
  const root = nativePlatform() === 'android' ? 'RNSVGSvgViewAndroid' : 'RNSVGSvgView';
  const unregisterCanvas = registerViewName('canvas', root);
  const unregisterPictures = registerPictures();
  const unregister = () => {
    unregisterCanvas();
    unregisterPictures();
  };
  // What a script asks a context or a paint is, and makes pixels with to put on a canvas, where
  // the runtime has none of its own.
  const target = globalThis as Record<string, unknown>;
  const added = Object.keys(GLOBALS).filter((name) => target[name] === undefined);
  for (const name of added) target[name] = GLOBALS[name];
  return () => {
    unregister();
    for (const name of added) if (target[name] === GLOBALS[name]) delete target[name];
  };
}

/**
 * What answers `instanceof` for a class, and is not it: a script that changes a global class's
 * prototype would change it for every app after, where a browser's page has its own.
 */
const askedOf = (of: abstract new (...args: never[]) => unknown) =>
  class {
    static [Symbol.hasInstance](value: unknown): boolean {
      return value instanceof of;
    }
  };

const GLOBALS: Readonly<Record<string, unknown>> = {
  ImageData,
  CanvasRenderingContext2D: askedOf(Context2D),
  CanvasGradient: askedOf(Gradient),
  CanvasPattern: askedOf(Pattern),
};

/** A canvas's pixels as they are now: none drawn, for one with no context. */
function pixelsOfCanvas(node: EngineNode): Pixels {
  const context = contexts.get(node);
  if (context) return context.snapshot();
  const { width, height } = canvasSize(node);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * `toDataURL`: the canvas's pixels as a PNG, whatever type is asked, as a browser answers one it
 * does not write. One of no size is `data:,`.
 */
export function canvasUrl(node: EngineNode): string {
  const pixels = pixelsOfCanvas(node);
  if (!pixels.width || !pixels.height) return 'data:,';
  return uriOf({ width: pixels.width, height: pixels.height, pixels });
}

/**
 * `toBlob`: the PNG, handed to the callback once the script asking is done.
 *
 * ponytail: React Native's `Blob` is made of text and other blobs, not of bytes, so there the
 * callback is handed null, as a browser hands it one it could not make. Read `toDataURL` there.
 */
export function canvasBlob(node: EngineNode, callback: unknown): void {
  if (typeof callback !== 'function') throw new TypeError('toBlob needs a callback.');
  const pixels = pixelsOfCanvas(node);
  const png =
    pixels.width && pixels.height ? pngOf(pixels.width, pixels.height, pixels.data) : null;
  setTimeout(() => (callback as (blob: Blob | null) => void)(png ? blobOf(png) : null), 0);
}

function blobOf(bytes: Uint8Array): Blob | null {
  try {
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  } catch {
    return null;
  }
}

/**
 * A canvas's side as a script sets it: the attribute, which is what sizes the grid. The value is
 * an `unsigned long`, converted as a number is (`'50px'` is 0), and one past what an attribute
 * holds is the size it has with nothing said.
 */
const side = (name: 'width' | 'height'): Reflection =>
  own(
    (node) => canvasSize(node)[name],
    (node, value) => node.setAttribute(name, String(unsignedOf(value, DEFAULT_SIZE[name]))),
  );

function unsignedOf(value: unknown, fallback: number): number {
  const number = Number(value);
  const whole = Number.isFinite(number) ? Math.trunc(number) : 0;
  const unsigned = ((whole % 2 ** 32) + 2 ** 32) % 2 ** 32;
  return unsigned > 2 ** 31 - 1 ? fallback : unsigned;
}

/** A canvas's members, by element, over what HTML reflects: see `html-members.ts`. */
export const CANVAS_MEMBERS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  canvas: {
    width: side('width'),
    height: side('height'),
    getContext: method(function (this: EngineNode, kind: never) {
      return contextOf(this, kind, engineOf(this));
    }),
    toDataURL: method(function (this: EngineNode) {
      return canvasUrl(this);
    }),
    toBlob: method(function (this: EngineNode, callback: never) {
      canvasBlob(this, callback);
    }),
  },
};
