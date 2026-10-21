/**
 * A `transform` as a browser computes one: the matrix its functions come to. A library that drags
 * reads how far it has moved a box from `matrix(1, 0, 0, 1, 0, 150)`, by its fifth or sixth number.
 *
 * ponytail: moves and scales in points, which keep to `matrix(a, 0, 0, d, x, y)`. Anything else,
 * a turn or a percentage, is handed back as written; work the full matrix out if one is read.
 */
export function computedTransform(written: unknown): string {
  if (typeof written !== 'string' || !written.trim() || written.trim() === 'none') return 'none';
  let [a, d, x, y] = [1, 1, 0, 0];
  for (const [, name, inside] of written.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const parts = inside!.split(',').map((part) => part.trim());
    if (parts.some((part) => !/^-?[\d.]+(px)?$/.test(part))) return written;
    const [first = 0, second] = parts.map(Number.parseFloat);
    const by = APPLY[name!]?.(first, second);
    if (!by) return written;
    [x, y] = [x + a * by.x, y + d * by.y];
    [a, d] = [a * by.a, d * by.d];
  }
  return `matrix(${a}, 0, 0, ${d}, ${x}, ${y})`;
}

type Step = { a: number; d: number; x: number; y: number };
const move = (x: number, y: number): Step => ({ a: 1, d: 1, x, y });
const scale = (a: number, d: number): Step => ({ a, d, x: 0, y: 0 });

/** What each function a matrix of this shape can hold does to it. */
const APPLY: Readonly<Record<string, (first: number, second?: number) => Step>> = {
  translate: (x, y = 0) => move(x, y),
  translate3d: (x, y = 0) => move(x, y),
  translateX: (x) => move(x, 0),
  translateY: (y) => move(0, y),
  scale: (a, d = a) => scale(a, d),
  scaleX: (a) => scale(a, 1),
  scaleY: (d) => scale(1, d),
};
