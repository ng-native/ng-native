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
  return undefined;
}
