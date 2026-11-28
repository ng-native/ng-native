import { double, own, parseFloatingPoint, type Reflecting, type Reflection } from './reflect.ts';

/**
 * A `<progress>`'s value and max as its attributes say, and its properties: what `progress.ts`
 * fills its bar to. A module of its own, which the element's other members import without the
 * rest of the package.
 */

/** `max`, a number above zero, or 1. */
export function maxOf(node: Reflecting): number {
  const max = parseFloatingPoint(node.getAttribute('max') ?? '') ?? Number.NaN;
  return Number.isFinite(max) && max > 0 ? max : 1;
}

/** `value`, between 0 and `max`, or null where it has none and is indeterminate. */
export function valueOf(node: Reflecting): number | null {
  const written = node.getAttribute('value');
  if (written === null) return null;
  const value = parseFloatingPoint(written) ?? Number.NaN;
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), maxOf(node));
}

/**
 * A progress bar's properties: its value, as its attribute, and how far along it is. Its `max` is
 * reflected as HTML's other numbers are (see `reflected-attributes.ts`). The bar is filled again
 * after the commit a change makes.
 */
export const PROGRESS: Readonly<Record<string, Reflection>> = {
  // Set as HTML's other numbers are, a value that is not a finite number refused.
  value: own((node) => valueOf(node) ?? 0, double('value').set),
  position: own((node) => {
    const value = valueOf(node);
    return value === null ? -1 : value / maxOf(node);
  }),
};
