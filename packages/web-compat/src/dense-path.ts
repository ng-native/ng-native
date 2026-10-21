/**
 * A path of more straight segments than the points it is drawn across, thinned for the native
 * drawing to the lowest and highest point of each column one point wide: what is seen of a line
 * of ten thousand readings on a phone's width is that, and react-native-svg on iOS clips to the
 * outline of every stroke it draws, which for a line that crosses itself thousands of times is
 * seconds of the main thread for each drawing. Chrome draws every point, at the screen's pixels.
 *
 * Only runs of straight segments that go one way across, as a series of a chart does, are thinned:
 * a curve, an arc, or a run that turns back is drawn as it is written.
 */

/** Fewer characters than this is a path too short to be worth reading. */
const LONG = 4000;

interface Vertex {
  readonly x: number;
  readonly y: number;
  /** The two numbers as written, to write back unchanged. */
  readonly text: string;
}

const COMMAND = /^[A-Za-z]$/;

/** A path's commands, where every one is a move or a line to a point given absolutely, or a close. */
function vertices(d: string): (Vertex | 'M' | 'Z')[] | undefined {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return undefined;
  const out: (Vertex | 'M' | 'Z')[] = [];
  let command = '';
  for (let at = 0; at < tokens.length;) {
    const token = tokens[at]!;
    if (COMMAND.test(token)) {
      command = token;
      at++;
      if (!opened(command, out)) return undefined;
      continue;
    }
    const point = pairAt(tokens, at, command);
    if (!point) return undefined;
    out.push(point);
    at += 2;
    // More pairs after a move are lines to them.
    if (command === 'M') command = 'L';
  }
  return out;
}

/** Note a command, answering whether it is one a thinned path can be made of. */
function opened(command: string, out: (Vertex | 'M' | 'Z')[]): boolean {
  if (command === 'Z' || command === 'z') {
    out.push('Z');
    return true;
  }
  if (command === 'M') out.push('M');
  return command === 'M' || command === 'L';
}

/** The point two numbers at `at` give, after a move or a line. */
function pairAt(tokens: readonly string[], at: number, command: string): Vertex | undefined {
  if (command !== 'M' && command !== 'L') return undefined;
  const [x, y] = [tokens[at]!, tokens[at + 1]];
  if (y === undefined || COMMAND.test(y)) return undefined;
  return { x: Number(x), y: Number(y), text: `${x} ${y}` };
}

/** Whether a point goes on in the run's direction across: `0` before the direction is known. */
const along = (from: Vertex, to: Vertex, direction: number): boolean =>
  direction === 0 || Math.sign(to.x - from.x) === direction || to.x === from.x;

/**
 * A run of points that goes one way across, thinned to the lowest and highest of each column. Where
 * a column held more than those two, they are drawn down its middle: a stroke a point wide there
 * covers the column, as the many it stands for did, where two at their own places leave gaps.
 */
function thin(run: readonly Vertex[], scale: number): Vertex[] {
  if (run.length < 4) return [...run];
  const kept: Vertex[] = [run[0]!];
  let column = Math.floor(run[1]!.x * scale);
  let [low, high, count] = [1, 1, 1];
  const close = () => {
    const middle = (column + 0.5) / scale;
    for (const at of low === high ? [low] : [Math.min(low, high), Math.max(low, high)]) {
      const point = run[at]!;
      if (count < 3) {
        if (kept.at(-1) !== point) kept.push(point);
      } else kept.push({ x: middle, y: point.y, text: `${round(middle)} ${round(point.y)}` });
    }
  };
  for (let at = 2; at < run.length - 1; at++) {
    const point = run[at]!;
    const now = Math.floor(point.x * scale);
    if (now !== column) {
      close();
      [column, low, high, count] = [now, at, at, 1];
    } else {
      count++;
      if (point.y < run[low]!.y) low = at;
      if (point.y > run[high]!.y) high = at;
    }
  }
  close();
  kept.push(run.at(-1)!);
  return kept;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** A path written again as its runs across are thinned, one point at a time. */
class Thinned {
  readonly written: string[] = [];
  count = 0;
  private run: Vertex[] = [];
  private direction = 0;
  /** Whether the run goes on from the last, whose end is written already. */
  private goesOn = false;

  private readonly scale: number;

  constructor(scale: number) {
    this.scale = scale;
  }

  add(part: Vertex | 'M' | 'Z'): void {
    if (part === 'M' || part === 'Z') {
      this.flush();
      if (part === 'Z') this.written.push('Z');
      return;
    }
    const last = this.run.at(-1);
    if (last && !along(last, part, this.direction)) {
      // A turn back: the run so far is thinned, and the next goes on from where it ended.
      this.flush();
      [this.run, this.goesOn] = [[last], true];
    }
    if (last && this.direction === 0 && part.x !== last.x) {
      this.direction = Math.sign(part.x - last.x);
    }
    this.run.push(part);
  }

  flush(): void {
    if (!this.run.length) return;
    const kept = thin(this.run, this.scale);
    this.count += kept.length;
    kept.forEach((point, at) => {
      if (at > 0 || !this.goesOn) this.written.push(`${at === 0 ? 'M' : 'L'} ${point.text}`);
    });
    [this.run, this.direction, this.goesOn] = [[], 0, false];
  }
}

/** Whether a path is too short, or has too few points for its reach, to be worth reading. */
const tooFew = (d: string, scale: number, across: number): boolean =>
  d.length < LONG ||
  !(scale > 0) ||
  // Fewer points than two to each column of what it can reach across is never made half as long.
  (Number.isFinite(across) && d.split('L').length < 2 * across * scale);

/**
 * A path's `d` thinned to columns `1 / scale` of its units wide, or as it is where it is short,
 * not made of straight runs across, or not made much shorter. `across` is as far across as it
 * can reach in its units, where that is known, which tells a path of too few points unread.
 */
export function thinnedPath(d: string, scale: number, across = Infinity): string {
  if (tooFew(d, scale, across)) return d;
  const parts = vertices(d);
  if (!parts) return d;
  const thinned = new Thinned(scale);
  for (const part of parts) thinned.add(part);
  thinned.flush();
  // Thinned by less than half, it is drawn as written.
  const all = parts.filter((part) => typeof part !== 'string').length;
  return thinned.count * 2 > all ? d : thinned.written.join(' ');
}
