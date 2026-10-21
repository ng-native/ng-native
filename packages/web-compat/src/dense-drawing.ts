import type { Engine, EngineNode } from '@ng-native/fabric';
import { thinnedPath } from './dense-path.ts';

/** A path with fewer characters than this is never thinned: see `thinnedPath`. */
export const LONG_PATH = 4000;

/** What drawing a path needs to read of the shapes it is in. */
export interface DrawingReader {
  /** The props a shape was last drawn with. */
  props(node: EngineNode): Readonly<Record<string, unknown>>;
  /** The attributes a shape is drawn by. */
  attrs(node: EngineNode): Readonly<Record<string, string>>;
}

/** What each path was last thinned from and to, so drawing it again for another reason is free. */
interface Thinned {
  readonly d: string;
  readonly scale: number;
  readonly across: number;
  readonly drawn: string;
}
const thinned = new WeakMap<EngineNode, Thinned>();

/** The apps with a path long enough to be thinned, whose groups are watched for a new scale. */
const anyLong = new WeakSet<Engine>();

/**
 * How many units of a shape's own go to a point across, from the transforms of the groups it is
 * in up to its drawing, and how far across it can reach in them. Nothing where a group turns or
 * skews it, which a column is of no use in.
 */
function scaleOf(
  node: EngineNode,
  read: DrawingReader,
): { scale: number; across: number } | undefined {
  let scale = 1;
  for (let at = node.parent; at; at = at.parent) {
    const matrix = read.props(at)['matrix'] as readonly number[] | undefined;
    if (Array.isArray(matrix)) {
      if (Math.abs(matrix[1]!) > 1e-9 || Math.abs(matrix[2]!) > 1e-9) return undefined;
      scale *= Math.abs(matrix[0]!);
    }
    if (at.tag === 'svg') {
      // A drawing as wide as its view box, as a chart's is, draws a unit to a point.
      const box = read.props(at)['vbWidth'] as number | undefined;
      const width = Number.parseFloat(read.attrs(at)['width'] ?? '');
      if (box) scale *= width > 0 ? width / box : NaN;
      if (Number.isNaN(scale)) return undefined;
      return { scale, across: (width > 0 ? width : Infinity) / scale };
    }
  }
  return { scale, across: Infinity };
}

/**
 * The `d` a path is drawn with: as written, or where it is a long run of straight segments, one
 * across a point at a time, thinned. What a script reads of it is the written one: see
 * `thinnedPath` for what is thinned, and why.
 */
export function drawnPathData(
  node: EngineNode,
  d: string,
  read: DrawingReader,
  engine: Engine,
): string {
  if (d.length < LONG_PATH) {
    thinned.delete(node);
    return d;
  }
  anyLong.add(engine);
  const { scale, across } = scaleOf(node, read) ?? {};
  if (scale === undefined) {
    thinned.delete(node);
    return d;
  }
  const was = thinned.get(node);
  if (was && was.d === d && was.scale === scale && was.across === across) return was.drawn;
  const drawn = thinnedPath(d, scale, across);
  thinned.set(node, { d, scale, across: across!, drawn });
  return drawn;
}

/**
 * Draw again the long paths under a group, a drawing included, whose scale may have changed:
 * a group given a transform, or a drawing given a size or a view box, or put in one.
 */
export function redrawLongPathsUnder(
  group: EngineNode,
  engine: Engine,
  redraw: (path: EngineNode) => void,
): void {
  if (!anyLong.has(engine)) return;
  for (const child of group.childList) {
    if (child.tag === 'path') {
      if (thinned.has(child) || isLong(child)) redraw(child);
    } else redrawLongPathsUnder(child, engine, redraw);
  }
}

const isLong = (path: EngineNode): boolean => String(path.props['d'] ?? '').length >= LONG_PATH;
