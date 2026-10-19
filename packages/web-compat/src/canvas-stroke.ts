import type { Subpath } from './canvas-path.ts';

/** How a line is drawn: its width, its ends, its corners, its dashes, on the grid it is in. */
export interface LineStyle {
  readonly width: number;
  readonly cap: string;
  readonly join: string;
  readonly miterLimit: number;
  readonly dash: readonly number[];
  readonly dashOffset: number;
}

type Point = readonly [number, number];

/** A closed outline of points, turned the one way round so that outlines laid over add up. */
function outline(points: number[]): Subpath {
  let area = 0;
  for (let at = 0; at < points.length; at += 2) {
    const next = (at + 2) % points.length;
    area += points[at]! * points[next + 1]! - points[next]! * points[at + 1]!;
  }
  if (area >= 0) return { points, closed: true };
  const turned: number[] = [];
  for (let at = points.length - 2; at >= 0; at -= 2) turned.push(points[at]!, points[at + 1]!);
  return { points: turned, closed: true };
}

function circle([x, y]: Point, radius: number): Subpath {
  const count = Math.min(256, Math.max(8, Math.ceil(radius * 2)));
  const points: number[] = [];
  for (let at = 0; at < count; at++) {
    const angle = (at / count) * Math.PI * 2;
    points.push(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
  }
  return outline(points);
}

/** The points of a run, with any that repeat the one before left out. */
function pointsOf(points: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let at = 0; at < points.length; at += 2) {
    const last = out[out.length - 1];
    if (!last || last[0] !== points[at] || last[1] !== points[at + 1]) {
      out.push([points[at]!, points[at + 1]!]);
    }
  }
  return out;
}

/** Half a line's width across a direction, to its left. */
const across = (direction: Point, half: number): Point => [
  -direction[1] * half,
  direction[0] * half,
];

/** The corner between two lines meeting at a point, on the outside of the turn. */
function join(at: Point, into: Point, out: Point, style: LineStyle, shapes: Subpath[]): void {
  const half = style.width / 2;
  const cross = into[0] * out[1] - into[1] * out[0];
  const dot = into[0] * out[0] + into[1] * out[1];
  if (Math.abs(cross) < 1e-9 && dot > 0) return;
  if (style.join === 'round') return void shapes.push(circle(at, half));
  const side = cross > 0 ? -half : half;
  const a: Point = [at[0] - into[1] * side, at[1] + into[0] * side];
  const b: Point = [at[0] - out[1] * side, at[1] + out[0] * side];
  const halfTurn = Math.sqrt((1 + dot) / 2);
  if (style.join === 'miter' && halfTurn > 0 && 1 / halfTurn <= style.miterLimit) {
    const [mx, my] = [a[0] + b[0] - 2 * at[0], a[1] + b[1] - 2 * at[1]];
    const reach = half / halfTurn / Math.hypot(mx, my);
    return void shapes.push(outline([...at, ...a, at[0] + mx * reach, at[1] + my * reach, ...b]));
  }
  shapes.push(outline([...at, ...a, ...b]));
}

/** The end of an open line at a point, going the way `direction` points out of it. */
function cap(at: Point, direction: Point, style: LineStyle, shapes: Subpath[]): void {
  const half = style.width / 2;
  if (style.cap === 'round') return void shapes.push(circle(at, half));
  if (style.cap !== 'square') return;
  const [dx, dy] = [direction[0] * half, direction[1] * half];
  const [nx, ny] = [-dy, dx];
  shapes.push(
    outline([
      ...[at[0] + nx, at[1] + ny],
      ...[at[0] + nx + dx, at[1] + ny + dy],
      ...[at[0] - nx + dx, at[1] - ny + dy],
      ...[at[0] - nx, at[1] - ny],
    ]),
  );
}

/** The band each line of a run is, and the way each goes. */
function bands(points: readonly Point[], closed: boolean, half: number, shapes: Subpath[]) {
  const count = closed ? points.length : points.length - 1;
  const directions: Point[] = [];
  for (let at = 0; at < count; at++) {
    const [from, to] = [points[at]!, points[(at + 1) % points.length]!];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const direction: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    directions.push(direction);
    const [nx, ny] = across(direction, half);
    shapes.push(
      outline([
        ...[from[0] + nx, from[1] + ny, to[0] + nx, to[1] + ny],
        ...[to[0] - nx, to[1] - ny, from[0] - nx, from[1] - ny],
      ]),
    );
  }
  return directions;
}

/**
 * The outlines of one run of lines drawn in a style. A run of no length is pruned, as a
 * browser prunes it, but for a dash of none, which is a dot where the ends are round or square.
 */
function strokeRun(run: Subpath, style: LineStyle, dots: boolean, shapes: Subpath[]): void {
  const points = pointsOf(run.points);
  const ends = [points[0], points[points.length - 1]];
  if (
    run.closed &&
    points.length > 1 &&
    ends[0]![0] === ends[1]![0] &&
    ends[0]![1] === ends[1]![1]
  ) {
    points.pop();
  }
  if (points.length < 2) {
    if (dots && points.length === 1) {
      cap(points[0]!, [1, 0], style, shapes);
      if (style.cap === 'square') cap(points[0]!, [-1, 0], style, shapes);
    }
    return;
  }
  const directions = bands(points, run.closed, style.width / 2, shapes);
  const count = directions.length;
  for (let at = run.closed ? 0 : 1; at < count; at++) {
    join(points[at]!, directions[(at - 1 + count) % count]!, directions[at]!, style, shapes);
  }
  if (run.closed) return;
  cap(points[0]!, [-directions[0]![0], -directions[0]![1]], style, shapes);
  cap(points[points.length - 1]!, directions[count - 1]!, style, shapes);
}

/** Walks a run, cutting it into its dashes. */
class Dasher {
  readonly pieces: Subpath[] = [];
  private readonly dash: readonly number[];
  private index = 0;
  private left: number;
  private current: number[] | null = null;

  constructor(dash: readonly number[], offset: number, total: number, start: Point) {
    this.dash = dash;
    this.left = dash[0]!;
    for (let skip = ((offset % total) + total) % total; skip > 0;) {
      const step = Math.min(skip, this.left);
      skip -= step;
      this.left -= step;
      if (this.left <= 0) this.left = dash[(this.index = (this.index + 1) % dash.length)]!;
    }
    if (this.index % 2 === 0) this.current = [...start];
  }

  /** Go along one line of the run, ending dashes and starting gaps as the pattern says. */
  walk(from: Point, to: Point): void {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    // A line of no length, as a closed run that ends where it began closes with, has no dashes.
    if (!length) return;
    let done = 0;
    for (;;) {
      const step = Math.min(this.left, length - done);
      done += step;
      this.left -= step;
      const t = done / length;
      const place: Point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      this.current?.push(...place);
      if (this.left > 1e-9) return;
      this.next(place);
      if (length - done <= 1e-9 && this.left > 0) return;
    }
  }

  /** End what the pattern was at, at a place, and start what comes after it there. */
  private next(place: Point): void {
    if (this.current) this.pieces.push({ points: this.current, closed: false });
    this.index = (this.index + 1) % this.dash.length;
    this.left = this.dash[this.index]!;
    this.current = this.index % 2 === 0 ? [...place] : null;
  }

  finish(): Subpath[] {
    if (this.current && this.current.length > 2) {
      this.pieces.push({ points: this.current, closed: false });
    }
    return this.pieces;
  }
}

/** A run cut into its dashes, each a run of its own, the pattern started again for each run. */
function dashed(run: Subpath, dash: readonly number[], offset: number): Subpath[] {
  const total = dash.reduce((sum, each) => sum + each, 0);
  const points = pointsOf(run.points);
  if (points.length < 2) return [];
  if (run.closed) points.push(points[0]!);
  const dasher = new Dasher(dash, offset, total, points[0]!);
  for (let at = 1; at < points.length; at++) dasher.walk(points[at - 1]!, points[at]!);
  return dasher.finish();
}

/** How long a run is, around to its start again where it is closed. */
function lengthOf(run: Subpath): number {
  const { points } = run;
  const count = run.closed ? points.length : points.length - 2;
  let length = 0;
  for (let at = 0; at < count; at += 2) {
    const next = (at + 2) % points.length;
    length += Math.hypot(points[next]! - points[at]!, points[next + 1]! - points[at + 1]!);
  }
  return length;
}

/** As many dashes as a line is cut into, past which it is drawn solid, as Skia draws it. */
const MAX_DASHES = 1_000_000;

/** Whether a path's line is cut into more dashes than are drawn. */
function tooManyDashes(runs: readonly Subpath[], dash: readonly number[]): boolean {
  const period = dash.reduce((sum, each) => sum + each, 0);
  const length = runs.reduce((sum, run) => sum + lengthOf(run), 0);
  return (length * (dash.length / 2)) / period > MAX_DASHES;
}

/** The outlines a path's line is drawn as, in a style, to be filled together, nonzero. */
export function strokeOutlines(runs: readonly Subpath[], style: LineStyle): Subpath[] {
  const shapes: Subpath[] = [];
  const dashes =
    style.dash.length > 0 &&
    style.dash.some((each) => each > 0) &&
    !tooManyDashes(runs, style.dash);
  for (const run of runs) {
    if (!dashes) strokeRun(run, style, false, shapes);
    else
      for (const piece of dashed(run, style.dash, style.dashOffset))
        strokeRun(piece, style, true, shapes);
  }
  return shapes;
}
