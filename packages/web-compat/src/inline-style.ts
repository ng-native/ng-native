import type { EngineNode } from '@ng-native/fabric';

/**
 * CSS a library binds as an inline style, as the declarations a native view reads. A stylesheet's
 * CSS is compiled when the app is built; a `[style.inset-inline-start]` is set as the app runs,
 * with what the library computed, and the renderer sets it by the name it was written with.
 */

/** A side's inset, by its CSS name in camel case: the key the view reads, and that side's margin. */
const SIDES: Record<string, readonly [inset: string, margin: string]> = {
  insetInlineStart: ['start', 'marginStart'],
  insetInlineEnd: ['end', 'marginEnd'],
  insetBlockStart: ['top', 'marginTop'],
  insetBlockEnd: ['bottom', 'marginBottom'],
  top: ['top', 'marginTop'],
  bottom: ['bottom', 'marginBottom'],
  left: ['left', 'marginLeft'],
  right: ['right', 'marginRight'],
};

/** The shorthands for two sides: `inset-inline: 0px 70%` is a start and an end. */
const PAIRS: Record<string, readonly [string, string]> = {
  insetInline: ['insetInlineStart', 'insetInlineEnd'],
  insetBlock: ['insetBlockStart', 'insetBlockEnd'],
};

/** `calc(30% + 4px)`, the one sum of a percentage and a length a layout here can be given. */
const PERCENT_AND_LENGTH = /^calc\(\s*(-?[\d.]+%)\s*([+-])\s*(-?[\d.]+)px\s*\)$/;

/** The margins set for a `calc()`, to take away when the inset is no longer one. */
const margins = new WeakMap<EngineNode, Set<string>>();

const camelCase = (name: string): string =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** One side's inset: where it is, and the margin that carries the length of a `calc()`. */
function side(node: EngineNode, name: string, value: unknown, out: Record<string, unknown>): void {
  const [inset, margin] = SIDES[name]!;
  const sum = typeof value === 'string' ? PERCENT_AND_LENGTH.exec(value) : null;
  const set = margins.get(node);
  if (sum) {
    // A percentage of the parent and a length, which no one value says: the percentage is the
    // inset, and the length moves the element on from there, as a margin on that side does.
    out[inset] = sum[1];
    out[margin] = (sum[2] === '-' ? -1 : 1) * parseFloat(sum[3]!);
    if (set) set.add(margin);
    else margins.set(node, new Set([margin]));
    return;
  }
  out[inset] = value ?? null;
  if (set?.delete(margin)) out[margin] = null;
}

/**
 * What a bound style is set as, or nothing for one the renderer sets as written. The name is
 * dash-cased from a binding and camel-cased from a `style` attribute.
 */
export function inlineStyle(
  node: EngineNode,
  name: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const key = camelCase(name);
  const out: Record<string, unknown> = {};
  if (key in SIDES) {
    side(node, key, value, out);
    return out;
  }
  const pair = PAIRS[key];
  if (pair) {
    // One value is both sides, two are the start and the end.
    const values = typeof value === 'string' ? value.trim().split(/\s+(?![^(]*\))/) : [value];
    side(node, pair[0], values[0], out);
    side(node, pair[1], values[1] ?? values[0], out);
    return out;
  }
  // Hidden and still taking its space, which is an element drawn with no opacity.
  // ponytail: an opacity bound beside it is replaced; keep both apart if a library binds both.
  if (key === 'visibility') return { opacity: value === 'hidden' ? 0 : null };
  if (key === 'transformOrigin') return { transformOrigin: originOf(value) };
  return unreadable(key, value);
}

/** Where each word for a side is along its axis. */
const SIDES_OF_ORIGIN: Readonly<Record<string, string>> = {
  left: '0%',
  top: '0%',
  center: '50%',
  right: '100%',
  bottom: '100%',
};

/**
 * A `transform-origin` as the `[x, y, z]` a view reads, each a number of points or a percentage.
 * A view is given the array or nothing: Android throws on the string.
 */
function originOf(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  const [first = 'center', second = 'center', depth] = value.trim().split(/\s+/);
  // The words may come in either order: `top right` is `right top`.
  const swapped = ['top', 'bottom'].includes(first) || ['left', 'right'].includes(second);
  const along = (part: string) =>
    SIDES_OF_ORIGIN[part] ?? (part.endsWith('%') ? part : parseFloat(part) || 0);
  const [x, y] = swapped ? [second, first] : [first, second];
  return [along(x), along(y), depth ? parseFloat(depth) || 0 : 0];
}

/** A root em, which is sixteen points wherever the app has not said otherwise. */
const REM = /^(-?[\d.]+)rem$/;
/** A length relative to a font or to the window, neither of which a native view measures by. */
const FOREIGN_LENGTH = /^-?[\d.]+(em|ch|ex|lh|vw|vh|vmin|vmax)$/;
/** The properties whose `none` is the absence of a value, where a native view reads a list. */
const NONE = new Set(['boxShadow', 'textShadow', 'filter', 'transform']);

/**
 * What to set in place of a value a native view cannot read, or nothing for one it can. A view
 * is not asked to make sense of CSS: Android throws on a string where it reads a number.
 */
function unreadable(key: string, value: unknown): Record<string, unknown> | undefined {
  if (value === 'none' && NONE.has(key)) return { [key]: null };
  // A line height with no unit is so many times the font size, which is not known here.
  // ponytail: a small bare number is taken for one; 20 is points, as an app writes it.
  if (key === 'lineHeight' && Number(value) <= 4) return { [key]: null };
  if (typeof value !== 'string') return undefined;
  const rem = REM.exec(value);
  if (rem) return { [key]: parseFloat(rem[1]!) * 16 };
  return FOREIGN_LENGTH.test(value) ? { [key]: null } : undefined;
}
