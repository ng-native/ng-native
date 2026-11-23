/**
 * Shapes an icon draws one after another with the same stroke and no fill, drawn as one path.
 *
 * An outline icon is several shapes in one paint: lucide's are four on average. Each is a native
 * view, and a view costs far more to create, commit and mount than the path data it draws. Where
 * drawing them as one path cannot change a pixel, they are drawn as one.
 *
 * It cannot where shapes overlap and the overlap would show: a fill (a path's own subpaths can
 * cancel each other's), an opacity below one (a path paints its overlap once, two shapes twice), a
 * dash (each shape starts its own pattern), a marker (drawn at each shape's ends). Nor where an
 * attribute is about the element itself: a mask, a clip, a transform, an `id` something points
 * at. Those shapes are drawn as they are, and so is a shape with a paint from a custom property,
 * which the cascade settles per shape.
 */
import { parseColor } from '@ng-native/fabric';
import type { SvgNode } from './parse-svg.ts';
import { pointsToPath, styleAttributes } from './svg-props.ts';

/** The attributes that say where a shape is, which merged shapes may differ in. */
const GEOMETRY: ReadonlySet<string> = new Set([
  ...['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height'],
  ...['x1', 'y1', 'x2', 'y2', 'points'],
]);

/** What makes a shape's own drawing show where it overlaps another, or is about the element. */
const UNMERGEABLE: ReadonlySet<string> = new Set([
  ...['mask', 'clip-path', 'transform', 'filter', 'class'],
  ...['opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset'],
  ...['marker', 'marker-start', 'marker-mid', 'marker-end', 'pathLength', 'vector-effect'],
  'visibility',
  'display',
]);

/**
 * What a shape's own `style` may set and still merge: what each shape draws alike, as heroicons,
 * huge-icons and tdesign write the stroke width the app picks.
 */
const STYLED: ReadonlySet<string> = new Set([
  ...['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'],
]);

/** The stroke width ng-icons hands an icon, the one custom property a merged shape may read. */
const STROKE_WIDTH = /^var\(\s*--ng-icon__stroke-width\s*(,[^()]*)?\)$/;

function mergeableStyle(style: string): boolean {
  return style.split(';').every((declaration) => {
    if (!declaration.trim()) return true;
    const colon = declaration.indexOf(':');
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    return colon > 0 && STYLED.has(name) && (!value.includes('var(') || STROKE_WIDTH.test(value));
  });
}

/** The ids something in the drawing points at: a merged shape's `id` must be one of none. */
function referenced(node: SvgNode, into = new Set<string>()): Set<string> {
  for (const value of Object.values(node.attrs)) {
    for (const match of value.matchAll(/url\(\s*['"]?#([^)'"\s]+)|^#(.+)$/g))
      into.add(match[1] ?? match[2]!);
  }
  for (const child of node.children) referenced(child, into);
  return into;
}

/** What an element hands its children that decides whether they may merge. */
interface Inherited {
  readonly fill: string | undefined;
  readonly blocked: boolean;
  readonly referenced: ReadonlySet<string>;
  /** The stroke width it draws with, NaN where that is not a number known here. */
  readonly stroke: number;
  /** The width ng-icons hands the icon, for a `var(--ng-icon__stroke-width)`. */
  readonly handed: number | string | undefined;
  /** The stroke it paints with, `none` where nothing above it says one. */
  readonly paint: string;
  /** Whether the colour the icon draws `currentColor` in is known to be opaque. */
  readonly opaque: boolean;
}

/**
 * Whether a stroke paints each pixel it covers once, as two shapes crossing are covered twice
 * only where it is not opaque: a stroke with any transparency in it shows the crossing darker
 * drawn as two shapes, and as one path does not. A colour not read here counts as not opaque.
 */
function opaquePaint(paint: string, opaque: boolean): boolean {
  if (paint === 'none') return true;
  // The icon's colour: an SVG `color` attribute is not sent to native, which paints `currentColor`
  // in the colour of the svg view.
  if (/^currentcolor$/i.test(paint)) return opaque;
  const colour = parseColor(paint);
  return colour !== null && colour[3] >= 1;
}

/** An element's own stroke width, or undefined where it has none and takes its parent's. */
function strokeOf(node: SvgNode, handed: number | string | undefined): number | undefined {
  const declared = node.attrs['style']
    ?.split(';')
    .map((declaration) => declaration.split(':'))
    .filter(([name]) => name?.trim() === 'stroke-width')
    .at(-1)?.[1]
    ?.trim();
  const written = declared ?? node.attrs['stroke-width'];
  if (written === undefined) return undefined;
  const fallback = /^var\(\s*--ng-icon__stroke-width\s*(?:,([^()]*))?\)$/.exec(written);
  const value = fallback ? String(handed ?? fallback[1] ?? '') : written;
  return /^\s*(\d+\.?\d*|\.\d+)(px)?\s*$/.test(value) ? Number.parseFloat(value) : Number.NaN;
}

/**
 * Whether a shape is closed and no wider or taller than its stroke: see `closesWithinStroke`. A
 * stroke width not known here counts as wider than any closed shape.
 */
function closedWithinStroke(node: SvgNode, stroke: number): boolean {
  const width = Number.isNaN(stroke) ? Number.POSITIVE_INFINITY : stroke;
  const size = SMALLEST_SIDE.get(node.tag);
  if (size) return size(node.attrs) <= width;
  if (node.tag !== 'path' && node.tag !== 'polygon') return false;
  const d =
    node.tag === 'path' ? (node.attrs['d'] ?? '') : pointsToPath(node.attrs['points'] ?? '', true);
  const segments = parsePath(d);
  return segments === undefined || closesWithinStroke(segments, width);
}

type Attributes = Readonly<Record<string, string>>;

/** The narrower side of a closed shape that is not a path. */
const SMALLEST_SIDE = new Map<string, (a: Attributes) => number>([
  ['circle', (a) => 2 * (number(a['r']) ?? 0)],
  ['ellipse', (a) => 2 * Math.min(number(a['rx']) ?? 0, number(a['ry']) ?? 0)],
  ['rect', (a) => Math.min(number(a['width']) ?? 0, number(a['height']) ?? 0)],
]);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function number(value: string | undefined): number | undefined {
  if (value === undefined || !NUMBER.test(value.trim())) return undefined;
  return Number(value);
}

/** Whether every one of them is a number. */
const known = (values: readonly (number | undefined)[]): values is number[] =>
  values.every((value) => value !== undefined);

/** A shape as path data an `M` starts, or undefined where native would draw it some other way. */
export function pathData(node: SvgNode): string | undefined {
  return PATH_DATA.get(node.tag)?.(node.attrs);
}

/** A map, so that a tag named like something on `Object.prototype` is no shape. */
const PATH_DATA = new Map<string, (a: Attributes) => string | undefined>([
  ['path', pathOf],
  ['line', lineOf],
  ['polyline', (a) => pointsOf(a, false)],
  ['polygon', (a) => pointsOf(a, true)],
  ['circle', (a) => ellipseOf(a, a['r'], a['r'])],
  ['ellipse', (a) => ellipseOf(a, a['rx'], a['ry'])],
  ['rect', rect],
]);

function pathOf(a: Attributes): string | undefined {
  const d = a['d']?.trim();
  // Native stops drawing a path at an error in its data, so a shape after a bad one in the
  // same path would go too. Only data that reads to its end is merged.
  if (!d || !/^[Mm]/.test(d) || !wellFormed(d)) return undefined;
  // A leading `m` is from the origin only when it is first: after another path it would be
  // from where that one ended. A move to the origin first keeps it where it was.
  return d.startsWith('m') ? `M0 0${d}` : d;
}

function lineOf(a: Attributes): string | undefined {
  const ends = ['x1', 'y1', 'x2', 'y2'].map((name) => number(a[name] ?? '0'));
  if (!known(ends)) return undefined;
  const [x1, y1, x2, y2] = ends;
  return `M${x1} ${y1}L${x2} ${y2}`;
}

function pointsOf(a: Attributes, close: boolean): string | undefined {
  const d = pointsToPath(a['points'] ?? '', close);
  return d.startsWith('M') && wellFormed(d) ? d : undefined;
}

function ellipseOf(
  a: Attributes,
  rx: string | undefined,
  ry: string | undefined,
): string | undefined {
  const values = [number(a['cx'] ?? '0'), number(a['cy'] ?? '0'), number(rx), number(ry)];
  if (!known(values) || values[2]! <= 0 || values[3]! <= 0) return undefined;
  return ellipse(...(values as [number, number, number, number]));
}

/** How many numbers each command takes, per repeat. */
const ARGUMENTS: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

const NUMBER_AT = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
/** Space, which may come anywhere a separator may. */
const SPACE = /\s*/y;
/** What may come between two numbers: space, and at most one comma in it. */
const BETWEEN = /\s*,?\s*/y;

/** One command of path data and its numbers, every repeat of them. */
interface Segment {
  readonly command: string;
  readonly numbers: readonly number[];
}

/**
 * Path data read to its end as SVG's grammar has it: each command followed by whole repeats of its
 * arguments, and an arc's two flags as single digits that may run together. Undefined where it
 * does not read to its end.
 */
function parsePath(d: string): Segment[] | undefined {
  const segments: Segment[] = [];
  let at = 0;
  const skip = (pattern: RegExp) => {
    pattern.lastIndex = at;
    pattern.exec(d);
    at = pattern.lastIndex;
  };
  // A comma goes between two numbers only: not after a command, before one or twice. Android's
  // parser stops at one anywhere else, which would take the shapes merged after it with it.
  const readNumber = (flag: boolean, first: boolean): number | undefined => {
    skip(first ? SPACE : BETWEEN);
    if (flag) {
      if (d[at] !== '0' && d[at] !== '1') return undefined;
      return Number(d[at++]);
    }
    NUMBER_AT.lastIndex = at;
    const match = NUMBER_AT.exec(d);
    if (!match) return undefined;
    at = NUMBER_AT.lastIndex;
    return Number(match[0]);
  };
  skip(SPACE);
  while (at < d.length) {
    const command = d[at]!;
    const count = ARGUMENTS[command.toLowerCase()];
    if (count === undefined) return undefined;
    at++;
    const numbers: number[] = [];
    segments.push({ command, numbers });
    // At least one repeat, then more while a number follows.
    let more = count > 0;
    while (more) {
      for (let i = 0; i < count; i++) {
        const value = readNumber(
          command.toLowerCase() === 'a' && (i === 3 || i === 4),
          i === 0 && numbers.length === 0,
        );
        if (value === undefined) return undefined;
        numbers.push(value);
      }
      const end = at;
      skip(BETWEEN);
      NUMBER_AT.lastIndex = at;
      more = at < d.length && NUMBER_AT.test(d);
      at = end;
    }
    skip(SPACE);
  }
  return segments;
}

/** Whether path data reads to its end: see `parsePath`. */
export const wellFormed = (d: string): boolean => parsePath(d) !== undefined;

/**
 * Whether a closed part of the path is no wider or taller than the stroke drawn round it. Its
 * stroke's inner edge folds back over itself, and iOS fills the fold of one in a path of several
 * otherwise than it fills one drawn alone: tdesign's dots, squares 0.004 across stroked 2 wide,
 * came out hollow. Measured by the points each command ends at, which is never more than the
 * part's size, so a part this calls large is.
 */
function closesWithinStroke(segments: readonly Segment[], stroke: number): boolean {
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let box = [0, 0, 0, 0];
  const reach = (toX: number, toY: number) => {
    x = toX;
    y = toY;
    box = [Math.min(box[0]!, x), Math.min(box[1]!, y), Math.max(box[2]!, x), Math.max(box[3]!, y)];
  };
  for (const { command, numbers } of segments) {
    const relative = command === command.toLowerCase();
    const at = (dx: number, dy: number): [number, number] =>
      relative ? [x + dx, y + dy] : [dx, dy];
    const lower = command.toLowerCase();
    if (lower === 'z') {
      if (Math.min(box[2]! - box[0]!, box[3]! - box[1]!) <= stroke) return true;
      x = startX;
      y = startY;
      box = [x, y, x, y];
      continue;
    }
    const count = ARGUMENTS[lower]!;
    for (let i = 0; i < numbers.length; i += count) {
      const n = numbers.slice(i, i + count);
      if (lower === 'm' && i === 0) {
        [startX, startY] = at(n[0]!, n[1]!);
        x = startX;
        y = startY;
        box = [x, y, x, y];
      } else if (lower === 'h') reach(relative ? x + n[0]! : n[0]!, y);
      else if (lower === 'v') reach(x, relative ? y + n[0]! : n[0]!);
      else reach(...at(n[count - 2]!, n[count - 1]!));
    }
  }
  return false;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;

/** A corner radius as written: undefined where none or `auto` is, null where it is no number. */
const radius = (value: string | undefined): number | null | undefined =>
  value === undefined || value === 'auto' ? undefined : (number(value) ?? null);

function rect(a: Attributes): string | undefined {
  const box = [
    number(a['x'] ?? '0'),
    number(a['y'] ?? '0'),
    number(a['width']),
    number(a['height']),
  ];
  const [givenX, givenY] = [radius(a['rx']), radius(a['ry'])];
  if (!known(box) || box[2]! <= 0 || box[3]! <= 0 || givenX === null || givenY === null)
    return undefined;
  const [x, y, width, height] = box as [number, number, number, number];
  // One radius given is both, as SVG reads it, and each is at most half its side.
  const rx = Math.min(Math.max(givenX ?? givenY ?? 0, 0), width / 2);
  const ry = Math.min(Math.max(givenY ?? givenX ?? 0, 0), height / 2);
  return roundedRect(x, y, width, height, rx, ry);
}

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  if (rx === 0 || ry === 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`
  );
}

/** The attributes merged shapes share, as one key, or undefined where the shape stays itself. */
function paintKey(node: SvgNode, inherited: Inherited): string | undefined {
  if (inherited.blocked || node.children.length > 0) return undefined;
  if ((node.attrs['fill'] ?? inherited.fill) !== 'none') return undefined;
  const shared: [string, string][] = [];
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!mergeableAttribute(name, value, inherited.referenced)) return undefined;
    if (!GEOMETRY.has(name) && name !== 'id') shared.push([name, value]);
  }
  return JSON.stringify(shared.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Whether a shape with this attribute can be drawn as part of another. */
function mergeableAttribute(name: string, value: string, referenced: ReadonlySet<string>): boolean {
  if (UNMERGEABLE.has(name)) return false;
  if (name === 'style') return mergeableStyle(value);
  // A gradient or pattern is laid out by the box of the shape it paints, by default: over a
  // merged path it would spread across every shape in it.
  if (value.includes('var(') || value.includes('url(')) return false;
  // An id nothing points at names nothing: the merged path goes without it.
  return name !== 'id' || !referenced.has(value);
}

/**
 * The tree with each run of mergeable siblings drawn as one path, or the same tree where nothing
 * merged. Only a run: a shape between them in another paint is drawn over the first and under the
 * last, and would not be if they were one.
 */
export function mergeShapes(
  root: SvgNode,
  handed: number | string | undefined,
  opaque: boolean,
): SvgNode {
  return merged(root, {
    fill: undefined,
    blocked: false,
    referenced: referenced(root),
    stroke: 1,
    handed,
    paint: 'none',
    opaque,
  });
}

/**
 * What an element hands down applies to each shape under it alike, so it merges them as it drew
 * them, except what is drawn per shape: a stroke opacity shows where two overlap, a dash starts
 * again with each, and a marker is drawn at each one's ends.
 */
const DRAWN_PER_SHAPE = [
  ...['stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset'],
  ...['marker', 'marker-start', 'marker-mid', 'marker-end'],
];

/** What an element hands its children, from what it says itself and what it was handed. */
function handedDown(node: SvgNode, from: Inherited): Inherited {
  const own = { ...node.attrs, ...styleAttributes(node.attrs['style'] ?? '', {}) };
  return {
    ...from,
    fill: own['fill'] ?? from.fill,
    blocked:
      from.blocked ||
      DRAWN_PER_SHAPE.some((name) => own[name] !== undefined) ||
      own['stroke']?.includes('url(') === true,
    stroke: strokeOf(node, from.handed) ?? from.stroke,
    paint: own['stroke'] ?? from.paint,
  };
}

/** A shape's paint key and path data, or undefined where it is drawn as it is. */
function mergeable(child: SvgNode, inherited: Inherited): { key: string; d: string } | undefined {
  const stroke = strokeOf(child, inherited.handed) ?? inherited.stroke;
  if (closedWithinStroke(child, stroke)) return undefined;
  const paint = child.attrs['stroke'] ?? inherited.paint;
  if (!opaquePaint(paint, inherited.opaque)) return undefined;
  const key = paintKey(child, inherited);
  const d = key === undefined ? undefined : pathData(child);
  return key === undefined || d === undefined ? undefined : { key, d };
}

/** A run of shapes as what is drawn: the one shape, or the path they make together. */
function drawnRun(first: SvgNode, d: readonly string[]): SvgNode {
  if (d.length === 1) return first;
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(first.attrs)) {
    if (!GEOMETRY.has(name) && name !== 'id') attrs[name] = value;
  }
  attrs['d'] = d.join('');
  return { tag: 'path', attrs, children: [] };
}

function merged(node: SvgNode, from: Inherited): SvgNode {
  const inherited = handedDown(node, from);
  const children: SvgNode[] = [];
  let run: { key: string; first: SvgNode; d: string[] } | undefined;
  const flush = () => {
    if (run) children.push(drawnRun(run.first, run.d));
    run = undefined;
  };
  let changed = false;
  for (const child of node.children) {
    const shape = child.tag === 'g' ? undefined : mergeable(child, inherited);
    if (!shape) {
      flush();
      const drawn = child.tag === 'g' ? merged(child, inherited) : child;
      changed ||= drawn !== child;
      children.push(drawn);
      continue;
    }
    if (run?.key !== shape.key) {
      flush();
      run = { key: shape.key, first: child, d: [] };
    } else changed = true;
    run.d.push(shape.d);
  }
  flush();
  return changed ? { ...node, children } : node;
}
