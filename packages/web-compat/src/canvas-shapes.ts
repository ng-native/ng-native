/** How far a corner is rounded across and down. */
export interface Corner {
  readonly x: number;
  readonly y: number;
}

/** A radius a script gave, as a number or as a point of two: a BigInt is no number. */
function cornerOf(radius: unknown): Corner | null {
  if (typeof radius === 'bigint') throw new TypeError('A radius is not a number.');
  if (typeof radius !== 'object' || radius === null) {
    const r = radius === undefined ? 0 : Number(radius);
    return Number.isFinite(r) ? checked({ x: r, y: r }) : null;
  }
  const { x = 0, y = 0 } = radius as { x?: unknown; y?: unknown };
  if (typeof x === 'bigint' || typeof y === 'bigint')
    throw new TypeError('A radius is not a number.');
  const corner = { x: Number(x), y: Number(y) };
  return Number.isFinite(corner.x) && Number.isFinite(corner.y) ? checked(corner) : null;
}

function checked(corner: Corner): Corner {
  if (corner.x < 0 || corner.y < 0) throw new RangeError('A radius is less than 0.');
  return corner;
}

/** Which radius each corner takes, for one to four given, upper left round to lower left. */
const SPREAD: Readonly<Record<number, readonly number[]>> = {
  1: [0, 0, 0, 0],
  2: [0, 1, 0, 1],
  3: [0, 1, 2, 1],
  4: [0, 1, 2, 3],
};

/**
 * The corners of a rounded rectangle, from the radii `roundRect` is given, in the order they are
 * traced from the corner it starts at: upper left, upper right, lower right and lower left where
 * it is given a width and a height, and the others round where either is less than none. Made
 * smaller together where two would overlap. Null for a radius that is not a number, which draws nothing.
 */
export function roundRectCorners(radii: unknown, width: number, height: number): Corner[] | null {
  const given = Array.isArray(radii) ? radii : [radii];
  if (given.length < 1 || given.length > 4) throw new RangeError('One to four radii are needed.');
  const corners = given.map(cornerOf);
  if (corners.some((corner) => corner === null)) return null;
  const [ul, ur, lr, ll] = SPREAD[given.length]!.map((at) => corners[at]!) as [
    Corner,
    Corner,
    Corner,
    Corner,
  ];
  const [wide, tall] = [Math.abs(width), Math.abs(height)];
  const room = (side: number, used: number) => (used > 0 ? side / used : 1);
  const scale = Math.min(
    1,
    room(wide, ul.x + ur.x),
    room(tall, ur.y + lr.y),
    room(wide, lr.x + ll.x),
    room(tall, ll.y + ul.y),
  );
  return [ul, ur, lr, ll].map(({ x, y }) => ({ x: x * scale, y: y * scale }));
}

type Point = readonly [number, number];

/** Where `arcTo` meets the first line, the circle it turns around, and the way it turns. */
export interface ArcTurn {
  readonly from: Point;
  readonly centre: Point;
  readonly start: number;
  readonly end: number;
  readonly counter: boolean;
}

/**
 * The arc `arcTo` draws in the corner from `p0` through `p1` towards `p2`, at a radius: null
 * where there is no corner to round, and a straight line to `p1` is all it draws.
 */
export function arcTurn(p0: Point, p1: Point, p2: Point, radius: number): ArcTurn | null {
  const [ax, ay] = [p0[0] - p1[0], p0[1] - p1[1]];
  const [bx, by] = [p2[0] - p1[0], p2[1] - p1[1]];
  const [la, lb] = [Math.hypot(ax, ay), Math.hypot(bx, by)];
  const cross = ax * by - ay * bx;
  if (!radius || !la || !lb || Math.abs(cross) <= 1e-12 * la * lb) return null;
  const between = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
  const reach = radius / Math.tan(between / 2);
  const from: Point = [p1[0] + (ax / la) * reach, p1[1] + (ay / la) * reach];
  const to: Point = [p1[0] + (bx / lb) * reach, p1[1] + (by / lb) * reach];
  const [mx, my] = [ax / la + bx / lb, ay / la + by / lb];
  const out = radius / Math.sin(between / 2) / Math.hypot(mx, my);
  const centre: Point = [p1[0] + mx * out, p1[1] + my * out];
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  const end = Math.atan2(to[1] - centre[1], to[0] - centre[0]);
  return { from, centre, start, end, counter: cross > 0 };
}
