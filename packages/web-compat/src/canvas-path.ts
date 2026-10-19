/**
 * A canvas path as the straight lines nearest it, and the share of each pixel a set of them
 * covers: what `canvas-raster.ts` works out the pixels of a drawing from.
 */

/** One run of joined lines: its points as `x, y, x, y, ...`, and whether it is closed. */
export interface Subpath {
  readonly points: number[];
  closed: boolean;
}

export type FillRule = 'nonzero' | 'evenodd';

/** A transform as `a b c d e f` have it: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

/** The transform that undoes one, or null for one that flattens the grid and has none. */
export function inverted([a, b, c, d, e, f]: Matrix): Matrix | null {
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const POINT = /(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?) (-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;

/** A path as `canvas.ts` writes one, with each point moved by a transform. */
export function pathUnder(path: string, [a, b, c, d, e, f]: Matrix): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  return path.replace(POINT, (_, given: string, other: string) => {
    const [x, y] = [Number(given), Number(other)];
    return `${round(a * x + c * y + e)} ${round(b * x + d * y + f)}`;
  });
}

/** Some runs with each point moved by a transform. */
export function mapped(runs: readonly Subpath[], [a, b, c, d, e, f]: Matrix): Subpath[] {
  return runs.map(({ points, closed }) => {
    const moved: number[] = [];
    for (let at = 0; at < points.length; at += 2) {
      const [x, y] = [points[at]!, points[at + 1]!];
      moved.push(a * x + c * y + e, b * x + d * y + f);
    }
    return { points: moved, closed };
  });
}

const TOKEN = /[MLCQZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** A curve as as many lines as keep it within a small part of a pixel of where it is. */
function pieces(...points: number[]): number {
  let length = 0;
  for (let at = 2; at < points.length; at += 2) {
    length += Math.hypot(points[at]! - points[at - 2]!, points[at + 1]! - points[at - 1]!);
  }
  return Math.min(256, Math.max(1, Math.ceil(length / 2)));
}

/** Builds the subpaths of a path from its commands, each as `canvas.ts` writes them. */
class Flattener {
  readonly subpaths: Subpath[] = [];
  private current: Subpath | null = null;
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;

  move(x: number, y: number): void {
    this.current = { points: [x, y], closed: false };
    this.subpaths.push(this.current);
    [this.x, this.y, this.startX, this.startY] = [x, y, x, y];
  }
  line(x: number, y: number): void {
    // After a close, a new subpath goes on from where the closed one began.
    if (!this.current) this.move(this.x, this.y);
    this.current!.points.push(x, y);
    [this.x, this.y] = [x, y];
  }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const [x0, y0] = [this.x, this.y];
    const count = pieces(x0, y0, x1, y1, x2, y2, x, y);
    for (let step = 1; step <= count; step++) {
      const t = step / count;
      const u = 1 - t;
      const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      this.line(a * x0 + b * x1 + c * x2 + d * x, a * y0 + b * y1 + c * y2 + d * y);
    }
  }
  quadratic(x1: number, y1: number, x: number, y: number): void {
    const [x0, y0] = [this.x, this.y];
    const count = pieces(x0, y0, x1, y1, x, y);
    for (let step = 1; step <= count; step++) {
      const t = step / count;
      const u = 1 - t;
      this.line(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
  }
  close(): void {
    if (!this.current) return;
    this.current.closed = true;
    this.current = null;
    [this.x, this.y] = [this.startX, this.startY];
  }
}

const ARGUMENTS: Readonly<Record<string, number>> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

/** The subpaths of a path written as `canvas.ts` writes one: M, L, C, Q and Z, on its grid. */
export function flatten(d: string): Subpath[] {
  const tokens = d.match(TOKEN) ?? [];
  const path = new Flattener();
  let at = 0;
  while (at < tokens.length) {
    const command = tokens[at++]!.toUpperCase();
    const count = ARGUMENTS[command] ?? 0;
    const n = tokens.slice(at, at + count).map(Number);
    at += count;
    if (command === 'M') path.move(n[0]!, n[1]!);
    else if (command === 'L') path.line(n[0]!, n[1]!);
    else if (command === 'C') path.cubic(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!);
    else if (command === 'Q') path.quadratic(n[0]!, n[1]!, n[2]!, n[3]!);
    else if (command === 'Z') path.close();
  }
  return path.subpaths;
}

/** An edge of a shape, top to bottom, and which way round it went. */
interface Edge {
  readonly x0: number;
  readonly y0: number;
  readonly y1: number;
  readonly slope: number;
  readonly winding: number;
}

/** The edges of some outlines, each closed whether it says so or not, as a fill has them. */
function edgesOf(outlines: readonly Subpath[]): Edge[] {
  const edges: Edge[] = [];
  for (const { points } of outlines) {
    const count = points.length / 2;
    for (let at = 0; at < count; at++) {
      const next = (at + 1) % count;
      const [ax, ay, bx, by] = [
        points[at * 2]!,
        points[at * 2 + 1]!,
        points[next * 2]!,
        points[next * 2 + 1]!,
      ];
      if (ay === by) continue;
      const down = ay < by;
      const [x0, y0, x1, y1] = down ? [ax, ay, bx, by] : [bx, by, ax, ay];
      edges.push({ x0, y0, y1, slope: (x1 - x0) / (y1 - y0), winding: down ? 1 : -1 });
    }
  }
  return edges.sort((a, b) => a.y0 - b.y0);
}

/** The share of each pixel of a box a shape covers, from 0 to 1, row by row. */
export interface Coverage {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

/** Rows each pixel row is sampled at: a sixteenth of a pixel up and down, exact across. */
const SAMPLES = 16;

/** The box of some edges, on a grid of a size, in whole pixels: null where it is empty. */
function boxOf(outlines: readonly Subpath[], width: number, height: number) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { points } of outlines) {
    for (let at = 0; at < points.length; at += 2) {
      minX = Math.min(minX, points[at]!);
      maxX = Math.max(maxX, points[at]!);
      minY = Math.min(minY, points[at + 1]!);
      maxY = Math.max(maxY, points[at + 1]!);
    }
  }
  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const right = Math.min(width, Math.ceil(maxX));
  const bottom = Math.min(height, Math.ceil(maxY));
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

/**
 * One row of pixels being covered: a span adds what it covers of the pixel at each end, and
 * marks where the whole pixels between start and stop, summed once the row is done.
 */
class Row {
  readonly width: number;
  readonly part: Float32Array;
  readonly whole: Float32Array;

  constructor(width: number) {
    this.width = width;
    this.part = new Float32Array(width);
    this.whole = new Float32Array(width + 1);
  }

  span(from: number, to: number, weight: number): void {
    const [a, b] = [Math.max(0, from), Math.min(this.width, to)];
    if (b <= a) return;
    const [first, last] = [Math.floor(a), Math.floor(b)];
    if (first === last) {
      this.part[first]! += (b - a) * weight;
      return;
    }
    this.part[first]! += (first + 1 - a) * weight;
    this.whole[first + 1]! += weight;
    this.whole[last]! -= weight;
    if (last < this.width) this.part[last]! += (b - last) * weight;
  }

  /** Write the row out, and start the next. */
  into(values: Float32Array, offset: number): void {
    let running = 0;
    for (let x = 0; x < this.width; x++) {
      running += this.whole[x]!;
      values[offset + x] = Math.min(1, running + this.part[x]!);
    }
    this.part.fill(0);
    this.whole.fill(0);
  }
}

/** Drop the edges that end above a row, in place: this runs sixteen times a pixel row. */
function retire(active: Edge[], y: number): void {
  let kept = 0;
  for (const edge of active) if (edge.y1 > y) active[kept++] = edge;
  active.length = kept;
}

/** Where the edges crossing a row cross it, left to right, with which way each went. */
function crossingsAt(active: readonly Edge[], y: number, xs: number[], windings: number[]): void {
  xs.length = 0;
  windings.length = 0;
  for (const edge of active) {
    const x = edge.x0 + (y - edge.y0) * edge.slope;
    let at = xs.length;
    // In order as they come: a row crosses few edges, so a sort by insertion is the quickest.
    while (at > 0 && xs[at - 1]! > x) {
      xs[at] = xs[at - 1]!;
      windings[at] = windings[at - 1]!;
      at--;
    }
    xs[at] = x;
    windings[at] = edge.winding;
  }
}

/** Goes down a shape's edges a row at a time, keeping those the row crosses. */
class Scan {
  private readonly edges: readonly Edge[];
  private readonly active: Edge[] = [];
  private readonly xs: number[] = [];
  private readonly windings: number[] = [];
  private next = 0;

  constructor(edges: readonly Edge[]) {
    this.edges = edges;
  }

  /** Keep the edges a height crosses: those begun above it and not yet ended. */
  reach(at: number): void {
    const { edges, active } = this;
    while (this.next < edges.length && edges[this.next]!.y0 <= at) active.push(edges[this.next++]!);
    retire(active, at);
  }

  /** Cover a row between the crossings at a height that are inside by a rule, by a weight. */
  sample(row: Row, at: number, rule: FillRule, shift: number, weight: number): void {
    const { active, xs, windings } = this;
    this.reach(at);
    crossingsAt(active, at, xs, windings);
    let winding = 0;
    for (let index = 0; index < xs.length - 1; index++) {
      winding += windings[index]!;
      const inside = rule === 'evenodd' ? winding % 2 !== 0 : winding !== 0;
      if (inside) row.span(xs[index]! - shift, xs[index + 1]! - shift, weight);
    }
  }

  /**
   * Whether a row from `y` is the same all the way down, once the edges at its first sample
   * are kept: no edge starts or ends in it, and every edge it crosses is upright. Most rows of a
   * rectangle are, and one sample of them is as good as sixteen.
   */
  steady(y: number): boolean {
    const coming = this.edges[this.next];
    if (coming && coming.y0 < y + 1) return false;
    return this.active.every((edge) => edge.slope === 0 && edge.y1 >= y + 1);
  }
}

/**
 * How much of each pixel some outlines cover by a fill rule, on a grid of a size: sampled
 * sixteen times a pixel down, and exactly across, so a side on a pixel's edge is sharp and one
 * through it is shaded as a browser shades it. Null where nothing on the grid is covered.
 */
export function coverageOf(
  outlines: readonly Subpath[],
  rule: FillRule,
  width: number,
  height: number,
): Coverage | null {
  const box = boxOf(outlines, width, height);
  if (!box) return null;
  const edges = edgesOf(outlines);
  const values = new Float32Array(box.width * box.height);
  const row = new Row(box.width);
  const scan = new Scan(edges);
  for (let y = box.top; y < box.top + box.height; y++) {
    scan.reach(y + 0.5 / SAMPLES);
    if (scan.steady(y)) scan.sample(row, y + 0.5 / SAMPLES, rule, box.left, 1);
    else {
      for (let sample = 0; sample < SAMPLES; sample++) {
        scan.sample(row, y + (sample + 0.5) / SAMPLES, rule, box.left, 1 / SAMPLES);
      }
    }
    row.into(values, (y - box.top) * box.width);
  }
  return { ...box, values };
}

/** Whether a point is on a side of some outlines, each closed. */
function onSide(outlines: readonly Subpath[], x: number, y: number): boolean {
  for (const { points } of outlines) {
    const count = points.length / 2;
    for (let at = 0; at < count; at++) {
      const next = ((at + 1) % count) * 2;
      const [ax, ay, bx, by] = [
        points[at * 2]!,
        points[at * 2 + 1]!,
        points[next]!,
        points[next + 1]!,
      ];
      const [dx, dy] = [bx - ax, by - ay];
      const length = dx * dx + dy * dy;
      if (!length) continue;
      const along = (x - ax) * dx + (y - ay) * dy;
      const off = Math.abs(dx * (y - ay) - dy * (x - ax));
      if (along >= 0 && along <= length && off <= 1e-9 * Math.sqrt(length)) return true;
    }
  }
  return false;
}

/** Whether a point is inside some outlines by a fill rule, or on one of their sides. */
export function contains(outlines: readonly Subpath[], rule: FillRule, x: number, y: number) {
  if (onSide(outlines, x, y)) return true;
  let winding = 0;
  for (const edge of edgesOf(outlines)) {
    if (y < edge.y0 || y >= edge.y1) continue;
    if (edge.x0 + (y - edge.y0) * edge.slope > x) winding += edge.winding;
  }
  return rule === 'evenodd' ? winding % 2 !== 0 : winding !== 0;
}
