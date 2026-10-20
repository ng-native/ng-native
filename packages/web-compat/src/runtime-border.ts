import { tokenFromValue, type DeferredDeclaration } from '@ng-native/fabric';
import { expand } from './declaration-block.ts';
import { pieces } from './css-style-declaration.ts';

/**
 * A border, an outline or a box's corners in a `<style>` made while the app runs, as the props
 * the build compiles the same declaration to: `border: 1px solid red` is each side's width, style
 * and colour, and the one style native draws every side with. The shorthand is read into its
 * longhands as the CSSOM reads it, and each value is left as CSS for the caller to read.
 *
 * A line with a token in it, `border: 1px solid var(--c)`, is the build's template for the node
 * to fill in: see `lineWithTokens`.
 *
 * ponytail: the physical sides, the outline and the corners. `border-block` and `border-inline`
 * and their sides, and their longhands, are passed over, as a corner with two radii is, and a
 * function in a line with a token, `calc()` or `color-mix()`.
 */

/** The native side, or outline, of each line a longhand is for. */
const LINES: Readonly<Record<string, string>> = {
  'border-top': 'borderTop',
  'border-right': 'borderRight',
  'border-bottom': 'borderBottom',
  'border-left': 'borderLeft',
  outline: 'outline',
};
const PARTS: Readonly<Record<string, 'Width' | 'Style' | 'Color'>> = {
  width: 'Width',
  style: 'Style',
  color: 'Color',
};
/** Each corner, in the order the build writes them. */
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** The width each keyword is, as a browser draws it. */
const WIDTHS: Readonly<Record<string, string>> = { thin: '1px', medium: '3px', thick: '5px' };
/** The styles native draws a line in, and those that draw none. */
const DRAWN = new Set(['solid', 'dashed', 'dotted']);
const NO_LINE = new Set(['none', 'hidden']);

/** Whether a property is one read here. */
export const isLine = (name: string): boolean =>
  /^border(-(top|right|bottom|left))?(-(width|style|color))?$/.test(name) ||
  /^outline(-(width|style|color))?$/.test(name) ||
  /^border(-(top|bottom)-(left|right))?-radius$/.test(name);

type Line = Partial<Record<'Width' | 'Style' | 'Color', string>>;

/**
 * Whether an outline is written `auto`, the platform's focus ring, which native has none of: the
 * build drops it. One left out of `outline` is `auto` too, which is the text's colour.
 */
const focusRing = (name: string, value: string): boolean =>
  name.startsWith('outline') && /(^|\s)auto(\s|$)/i.test(value);

/**
 * The props a declaration is, each as the CSS it is written with: a width as a length, a colour
 * as one or `currentcolor`. Nothing for one native cannot draw, as the build drops it.
 */
export function lineProps(name: string, value: string): Record<string, string> | undefined {
  const longhands = focusRing(name, value) ? undefined : expand(name, value);
  if (!longhands) return undefined;
  if (name.endsWith('radius')) return corners(longhands);
  const lines = new Map<string, Line>();
  for (const [longhand, text] of Object.entries(longhands)) {
    const [, line, part] = /^(.+)-(width|style|color)$/.exec(longhand) ?? [];
    // `border` sets the image too, back to none, which is no image to draw.
    if (!line || !LINES[line]) continue;
    const parts = lines.get(LINES[line]) ?? lines.set(LINES[line], {}).get(LINES[line])!;
    parts[PARTS[part!]!] = text;
  }
  const out: Record<string, string> = {};
  for (const [prefix, line] of lines) if (!drawn(prefix, line, out)) return undefined;
  return oneStyle(name, out) ? out : undefined;
}

/**
 * One line's props: a style that draws none is no width where the width is written with it, and
 * a colour nobody can see is left out.
 */
function drawn(prefix: string, line: Line, out: Record<string, string>): boolean {
  const { Style } = line;
  if (Style !== undefined && !DRAWN.has(Style) && !NO_LINE.has(Style)) return false;
  const none = Style !== undefined && NO_LINE.has(Style);
  const width = widthOf(line, none);
  const style = none ? 'none' : Style;
  if (width !== undefined) out[`${prefix}Width`] = width;
  // An outline has no style of none: it is a width of nothing.
  if (style !== undefined && !(none && prefix === 'outline')) out[`${prefix}Style`] = style;
  const colour = seen(line, width === '0px');
  if (colour !== undefined) out[`${prefix}Color`] = colour;
  return true;
}

/** A line's width as a length: none where its style draws none, a keyword as the length it is. */
function widthOf({ Width }: Line, none: boolean): string | undefined {
  if (Width === undefined) return undefined;
  return none ? '0px' : (WIDTHS[Width] ?? Width);
}

/** A line's colour, where it can be seen: `auto` is the text's, and a line of no width has none. */
function seen({ Style, Color }: Line, noWidth: boolean): string | undefined {
  const colour = Color === 'auto' ? 'currentcolor' : Color;
  const unseen =
    noWidth && ((Style !== undefined && NO_LINE.has(Style)) || colour === 'currentcolor');
  return unseen ? undefined : colour;
}

/**
 * The one style native draws every side in, from a declaration that styles them all: which must
 * then style them alike.
 */
function oneStyle(name: string, out: Record<string, string>): boolean {
  if (name !== 'border' && name !== 'border-style') return true;
  const written = Object.values(LINES).map((line) => out[`${line}Style`]);
  const styles = new Set(written.filter((style) => style !== undefined));
  if (styles.size > 1) return false;
  const [style] = styles;
  if (style !== undefined) out['borderStyle'] = style;
  return true;
}

const capital = (word: string): string => word[0]!.toUpperCase() + word.slice(1);

/** Each corner's radius, where it has one: native has no corner of two. */
function corners(longhands: Readonly<Record<string, string>>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const corner of CORNERS) {
    const radius = longhands[`border-${corner}-radius`];
    if (radius === undefined) continue;
    if (/\s/.test(radius)) return undefined;
    const [vertical, horizontal] = corner.split('-') as [string, string];
    out[`border${capital(vertical)}${capital(horizontal)}Radius`] = radius;
  }
  return out;
}

type Template = NonNullable<DeferredDeclaration['line']>;
type Reference = Template['references'][number];

/** The sides of each line a token can be written in, and the prop of its one style, if it has one. */
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const TEMPLATES: Readonly<Record<string, { sides: string[]; style?: string }>> = {
  border: { sides: SIDES.map((side) => `border${side}`), style: 'borderStyle' },
  outline: { sides: ['outline'], style: 'outlineStyle' },
  ...Object.fromEntries(
    SIDES.map((side) => [`border-${side.toLowerCase()}`, { sides: [`border${side}`] }]),
  ),
};

/** `var(--c)`, `var(--c, red)` or `var(--c,)` as the token a line is filled in from. */
function referenceOf(part: string): Reference | undefined {
  const [, reference, comma, fallback = ''] =
    /^var\(\s*(--[\w-]+)\s*(?:(,)([^()]*))?\)$/i.exec(part) ?? [];
  if (!reference) return undefined;
  if (!comma) return { reference };
  if (!fallback.trim()) return { reference, empty: true };
  const token = tokenFromValue(fallback.trim());
  return token ? { reference, fallback: token } : undefined;
}

interface Written {
  readonly references: Reference[];
  width?: string;
  style?: string;
  colour?: string;
}

/** Put one part of a line in `written` as what it says it is, and answer whether it was read. */
function readPart(part: string, written: Written): boolean {
  const word = part.toLowerCase();
  if (/^var\(/i.test(part)) {
    const reference = referenceOf(part);
    if (reference) written.references.push(reference);
    return reference !== undefined;
  }
  if (part.includes('(') && !/^(rgba?|hsla?)\(/i.test(part)) return false;
  if (DRAWN.has(word) || NO_LINE.has(word)) written.style = word;
  else if (WIDTHS[word] || /^-?[\d.]+[a-z%]*$/.test(word)) written.width = WIDTHS[word] ?? word;
  // A line has one colour: CSS reads a second as an invalid declaration.
  else if (written.colour !== undefined) return false;
  else written.colour = word;
  return true;
}

/** A line's parts: its tokens, and what each other part says it is. Nothing for one not read. */
function partsOfLine(value: string): Written | undefined {
  const written: Written = { references: [] };
  const parts = pieces(value, (char, depth) => depth === 0 && /\s/.test(char));
  // A token alone is any part, or all of them, which only the build's parser can tell.
  if (parts.length < 2 || !parts.every((part) => readPart(part, written))) return undefined;
  return written.references.length ? written : undefined;
}

/** The longhands of a line's sides, and the prop of its one style if it has one. */
interface Sides {
  readonly widths: string[];
  readonly colors: string[];
  readonly marks: string[];
  readonly style?: string;
}

function sidesOf(name: string): Sides | undefined {
  const of = TEMPLATES[name];
  if (!of) return undefined;
  const { sides, style } = of;
  return {
    widths: sides.map((side) => `${side}Width`),
    colors: sides.map((side) => `${side}Color`),
    // Each side's own style, which the line's is written to as well. An outline has no sides.
    marks: name === 'outline' ? [] : sides.map((side) => `${side}Style`),
    ...(style ? { style } : {}),
  };
}

const every = (props: readonly string[], to: string): Record<string, string> =>
  Object.fromEntries(props.map((prop) => [prop, to]));

/** The parts of a line that are written, as props. */
function writtenProps({ width, style, colour }: Written, sides: Sides): Record<string, string> {
  return {
    ...(width === undefined ? {} : every(sides.widths, width)),
    ...(colour === undefined ? {} : every(sides.colors, colour)),
    ...(sides.style && style !== undefined ? { [sides.style]: style } : {}),
    ...(style === undefined ? {} : every(sides.marks, style)),
  };
}

/**
 * What the node fills a line's tokens in to: every longhand the line sets, which tokens it makes
 * nothing of unset, and the roles the written parts leave the tokens.
 */
function template(
  { width, style, colour, references }: Written,
  sides: Sides,
): DeferredDeclaration {
  const { widths, colors, marks, style: styleProp } = sides;
  // With no style written, a token may be the style.
  const open = styleProp !== undefined && style === undefined;
  const roles: Template['roles'][number][] = [
    ...(width === undefined ? (['width'] as const) : []),
    ...(open ? (['style'] as const) : []),
    ...(colour === undefined ? (['color'] as const) : []),
  ];
  const styles = styleProp ? [styleProp, ...(open ? marks : [])] : [];
  // A written `currentcolor` is the colour in scope, which the node fills in on its own.
  const painted = colour === 'currentcolor' ? [] : colors;
  const line: Template = {
    references,
    roles,
    widths,
    colors,
    ...(styleProp ? { style: styleProp } : {}),
    ...(open && marks.length ? { marks } : {}),
  };
  return { props: [...widths, ...styles, ...painted], line };
}

/**
 * `border: 1px solid var(--c)`: the parts written as props, each as the CSS it is written with,
 * and the template the build writes for the rest, whose tokens the node gives the role each
 * one's form says. Nothing for a line with no token, or with a part not read.
 */
export function lineWithTokens(
  name: string,
  value: string,
): { props: Record<string, string>; deferred?: DeferredDeclaration } | undefined {
  const sides = sidesOf(name);
  const written = sides && partsOfLine(value);
  if (!sides || !written) return undefined;
  // A line of no style is none, whatever its tokens are.
  if (written.style !== undefined && NO_LINE.has(written.style)) {
    return { props: { ...every(sides.widths, '0px'), ...every(sides.marks, 'none') } };
  }
  return { props: writtenProps(written, sides), deferred: template(written, sides) };
}
