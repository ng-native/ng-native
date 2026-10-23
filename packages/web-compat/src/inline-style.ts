import { backgroundLayers, type EngineNode } from '@ng-native/fabric';
import { reduceCalc } from './calc.ts';
import { filtersOf } from './filter-list.ts';
import { bandOf } from './image-band.ts';
import { transitionOf, transitionPart } from './transition-style.ts';

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
  written: unknown,
): Record<string, unknown> | undefined {
  const key = camelCase(name);
  // A sum a library wrote out, as the one sum of a percentage and a length a layout takes.
  const reduced = typeof written === 'string' ? reduceCalc(written) : undefined;
  const out = converted(node, key, reduced ?? written);
  // What it came to is what is set, where nothing more is made of it.
  return out ?? (reduced === undefined ? undefined : { [key]: reduced });
}

function converted(
  node: EngineNode,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined {
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
  // Hidden and still taking its space: drawn with no opacity, over its own, and touched by no
  // finger, which the engine commits for it as it does for a stylesheet's.
  if (key === 'visibility') return { visibility: value === 'hidden' ? 'hidden' : null };
  const own = OWN[key];
  if (own) return own(value);
  if (key === 'transition') return transitionOf(value, propsOf);
  const part = transitionPart(key, value, propsOf);
  if (part) return part;
  // A number, which a library writes as text: Android throws on a string where it reads one.
  if (key === 'opacity' && typeof value === 'string') return { opacity: Number(value) };
  return unreadable(key, value);
}

/** A length or a number as a view reads it: points as a number, anything else as written. */
const sized = (part: string): unknown => (/^-?[\d.]+(px)?$/.test(part) ? parseFloat(part) : part);

/** What each word a `flex` can be stands for, as grow, shrink and basis. */
const FLEX_WORDS: Readonly<Record<string, string>> = { auto: '1 1 auto', none: '0 0 auto' };

/**
 * A `flex` as a view reads it: one number as it is, and one written with more parts as each
 * part, since a view's `flex` is one number. `flex: 50 1 0` is how a panel shares a row.
 */
function flexOf(value: unknown): Record<string, unknown> {
  const text = typeof value === 'string' ? (FLEX_WORDS[value.trim()] ?? value.trim()) : '';
  const [grow, second, basis] = text.split(/\s+/);
  if (second === undefined) {
    const flex = typeof value === 'string' ? sized(value.trim()) : (value ?? null);
    return { flex, flexGrow: null, flexShrink: null, flexBasis: null };
  }
  // Two parts are a grow and a shrink, or a grow and a basis when the second is not a number.
  const shrinks = /^[\d.]+$/.test(second);
  return {
    flex: null,
    flexGrow: Number(grow),
    flexShrink: shrinks ? Number(second) : 1,
    flexBasis: sized(basis ?? (shrinks ? '0' : second)),
  };
}

const FOUR = ['Top', 'Right', 'Bottom', 'Left'];
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];

/**
 * The shorthands of sides and corners, each as the props it is set as. A rule's compiles to a
 * value a side, and a view reads a side before the shorthand: written whole over a rule, a
 * bound `border-radius` would be the rule's corners.
 */
const BOXES: Readonly<Record<string, readonly string[]>> = {
  padding: FOUR.map((side) => `padding${side}`),
  margin: FOUR.map((side) => `margin${side}`),
  borderWidth: FOUR.map((side) => `border${side}Width`),
  borderColor: FOUR.map((side) => `border${side}Color`),
  borderRadius: CORNERS.map((corner) => `border${corner}Radius`),
  gap: ['rowGap', 'columnGap'],
};

/** A part of a shorthand as a view reads it: points as a number, a root em as sixteen of them. */
function part(text: string): unknown {
  const rem = REM.exec(text);
  if (rem) return parseFloat(rem[1]!) * 16;
  return FOREIGN_LENGTH.test(text) ? null : sized(text);
}

/**
 * A shorthand's parts on the props it stands for, as CSS shares them out: one is every side,
 * two are a pair repeated, and of three the last side takes the second's.
 */
function boxOf(props: readonly string[], value: unknown): Record<string, unknown> {
  // Up to a slash, which sets a corner's other radius: a view has one a corner.
  const text = typeof value === 'number' ? String(value) : value;
  const parts =
    typeof text === 'string'
      ? text
          .split('/')[0]!
          .trim()
          .split(/\s+(?![^(]*\))/)
          .map(part)
      : [];
  return Object.fromEntries(
    props.map((prop, at) => [prop, parts[at] ?? parts[at - 2] ?? parts[0] ?? null]),
  );
}

const LINE_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset']);
const NO_LINE = new Set(['none', 'hidden']);

/**
 * A border written whole, `1px solid red` in any order, on the sides it is for: a width, a
 * colour and a style. `none` is a border of no width. With no colour written it is the text's,
 * which the engine gives a border that has none.
 */
function lineOf(sides: readonly string[], value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const words = typeof value === 'string' ? value.trim().split(/\s+(?![^(]*\))/) : [];
  const style = words.find((word) => LINE_STYLES.has(word) || NO_LINE.has(word));
  const width = words.find((word) => /^-?[\d.]/.test(word));
  const colour = words.find((word) => word !== style && word !== width);
  for (const side of sides) {
    if (!words.length) out[`border${side}Width`] = null;
    else if (style && NO_LINE.has(style)) out[`border${side}Width`] = 0;
    // `medium`, which is what a border with a style and no width is.
    else out[`border${side}Width`] = width ? part(width) : 3;
    out[`border${side}Color`] = colour ?? null;
  }
  if (sides.length === 4) out['borderStyle'] = style && !NO_LINE.has(style) ? style : null;
  return out;
}

/** The properties set as something a view reads another way, each by what it makes of a value. */
const OWN: Readonly<Record<string, (value: unknown) => Record<string, unknown>>> = {
  flex: (value) => flexOf(value),
  background: (value) => backgroundOf(value),
  transformOrigin: (value) => ({ transformOrigin: originOf(value) }),
  ...Object.fromEntries(
    Object.entries(BOXES).map(([name, props]) => [name, (value: unknown) => boxOf(props, value)]),
  ),
  border: (value) => lineOf(FOUR, value),
  boxShadow: (value) => ({ boxShadow: shadowsOf(value) }),
  filter: (value) => ({ filter: filtersOf(value) }),
  // A band of the box, which an image is drawn through, as a library's sheet has it: see
  // `image-band.ts`. Any other clip is set as written.
  clipPath: (value) =>
    bandOf(value)
      ? { clipBand: value, clipPath: null }
      : {
          // Written and no band, it is no band over the sheet's; taken away, the sheet's again.
          clipBand: value === undefined || value === null || value === '' ? null : 'none',
          clipPath: value ?? null,
        },
  ...Object.fromEntries(
    FOUR.map((side) => [`border${side}`, (value: unknown) => lineOf([side], value)]),
  ),
};

/**
 * A `background` written whole: the gradients it holds over the colour under them, or the colour
 * it is. A view has the two apart, and each is taken away where the new value has none of it.
 */
function backgroundOf(value: unknown): Record<string, unknown> {
  const layers = typeof value === 'string' ? backgroundLayers(value) : undefined;
  if (layers) {
    return { experimental_backgroundImage: layers.images, backgroundColor: layers.color ?? null };
  }
  return { experimental_backgroundImage: null, backgroundColor: value ?? null };
}

/** A length in a shadow: pixels, a bare zero or root ems. */
function shadowLength(part: string): number | undefined {
  const rem = REM.exec(part);
  if (rem) return parseFloat(rem[1]!) * 16;
  return /^-?[\d.]+(px)?$/.test(part) && (part.endsWith('px') || parseFloat(part) === 0)
    ? parseFloat(part)
    : undefined;
}

/**
 * A `box-shadow` as the list of shadows a view reads: Android throws on the text, which iOS
 * parses. A shadow is two to four lengths, with `inset` and a colour beside them; the
 * whole list is unset where one of its shadows is none of that.
 */
function shadowsOf(value: unknown): readonly Record<string, unknown>[] | null {
  if (typeof value !== 'string') return Array.isArray(value) ? value : null;
  const shadows = value
    .trim()
    .split(/,(?![^(]*\))/)
    .map(shadowOf);
  return shadows.includes(null) ? null : (shadows as Record<string, unknown>[]);
}

/** One shadow of a list, or null for one that is none. */
function shadowOf(text: string): Record<string, unknown> | null {
  const lengths: number[] = [];
  let color: string | undefined;
  let inset = false;
  for (const part of text.trim().split(/\s+(?![^(]*\))/)) {
    const length = shadowLength(part);
    if (length !== undefined) lengths.push(length);
    else if (part === 'inset' && !inset) inset = true;
    else if (color === undefined) color = part;
    else return null;
  }
  if (lengths.length < 2 || lengths.length > 4) return null;
  const [offsetX, offsetY, blurRadius, spreadDistance] = lengths;
  return {
    offsetX,
    offsetY,
    ...(blurRadius === undefined ? {} : { blurRadius }),
    ...(spreadDistance === undefined ? {} : { spreadDistance }),
    ...(color === undefined ? {} : { color }),
    ...(inset ? { inset } : {}),
  };
}

/**
 * The props a property sets, learnt by setting it: `margin` is four. One that takes no length, a
 * colour, is the prop of its own name.
 */
function propsOf(property: string): readonly string[] {
  if (property === 'background') return ['backgroundColor'];
  const key = camelCase(property);
  // On a node of its own, so the margins kept for a real one's `calc()` are left alone.
  const set = converted({} as EngineNode, key, '1px') ?? {};
  const props = Object.keys(set).filter((name) => set[name] !== null);
  return props.length ? props : [key];
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
