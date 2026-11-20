/**
 * Comparing a node's committed style with what a test expects, and colours with each other: what
 * the visual matchers in `visual-matchers.ts` decide by, apart from `expect`.
 */
import { isColorProp, parseColor } from '@ng-native/fabric';
import type { FakeFabricNode } from '../test-utils.ts';

export type Rgba = [number, number, number, number];

/** A colour as RGBA (alpha 0 to 1): a CSS colour string, or the integer `processColor` gives. */
export function rgba(value: unknown): Rgba | null {
  if (typeof value === 'number') {
    const argb = value >>> 0;
    return [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, (argb >>> 24) / 255];
  }
  return parseColor(value);
}

export const sameColour = (a: Rgba, b: Rgba, tolerance: number) =>
  a.slice(0, 3).every((channel, i) => Math.abs(channel - b[i]!) <= tolerance) &&
  Math.abs(a[3] - b[3]) <= tolerance / 255;

export const show = (colour: Rgba | null, raw: unknown) =>
  colour ? `rgba(${colour.slice(0, 3).join(', ')}, ${+colour[3].toFixed(3)})` : JSON.stringify(raw);

/** A length as points: a number, or `'12px'`. Anything else is compared as it is. */
const points = (value: unknown) =>
  typeof value === 'string' && /^-?[\d.]+px$/.test(value) ? Number.parseFloat(value) : value;

/**
 * The longhands the engine commits for a shorthand it never commits whole: `border-radius: 12px`
 * reaches native as four corners. A shorthand a node does carry is compared as it is.
 */
const LONGHANDS: Record<string, readonly string[]> = {
  borderRadius: [
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
  ],
  borderWidth: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
  borderColor: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
};

/** Where `key` of `expected` differs from what the node committed, as a line saying how. */
function mismatch(key: string, want: unknown, got: unknown): string | null {
  if (isColorProp(key)) {
    const [a, b] = [rgba(want), rgba(got)];
    return a && b && sameColour(a, b, 0) ? null : `${key}: ${show(a, want)}, got ${show(b, got)}`;
  }
  const [a, b] = [points(want), points(got)];
  const equal =
    typeof a === 'number' && typeof b === 'number'
      ? Math.abs(a - b) < 0.01
      : JSON.stringify(a) === JSON.stringify(b);
  return equal ? null : `${key}: ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
}

export function styleMismatches(node: FakeFabricNode, expected: Record<string, unknown>): string[] {
  const misses: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const longhands = !(key in node.props) && LONGHANDS[key];
    for (const each of longhands || [key]) {
      const miss = mismatch(each, want, node.props[each]);
      if (miss) misses.push(miss);
    }
  }
  return misses;
}
