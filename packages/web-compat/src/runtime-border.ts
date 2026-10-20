import { expand } from './declaration-block.ts';

/**
 * A border, an outline or a box's corners in a `<style>` made while the app runs, as the props
 * the build compiles the same declaration to: `border: 1px solid red` is each side's width, style
 * and colour, and the one style native draws every side with. The shorthand is read into its
 * longhands as the CSSOM reads it, and each value is left as CSS for the caller to read.
 *
 * ponytail: the physical sides, the outline and the corners. `border-block` and `border-inline`
 * and their sides, and their longhands, are passed over, as a corner with two radii is.
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
 * The props a declaration is, each as the CSS it is written with: a width as a length, a colour
 * as one or `currentcolor`. Nothing for one native cannot draw, as the build drops it.
 */
export function lineProps(name: string, value: string): Record<string, string> | undefined {
  const longhands = expand(name, value);
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
