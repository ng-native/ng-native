import {
  BACKGROUND_PLACING,
  backgroundLayers,
  boundDeclaration,
  firstFamily,
  parseColor,
  platformColourOf,
  splitLayers,
  tokenFromValue,
  type DeferredDeclaration,
} from '@ng-native/fabric';

/**
 * The shorthands in a `style` attribute or a `[style]` binding whose parts are of different kinds,
 * as the props a stylesheet compiles them to. A stylesheet's are read by the compiler when the app
 * is built; the same text set on an element is only known as the app runs, and no parser of the
 * compiler's comes with it, so the props are read here, by the same rules. Each value is left as
 * CSS for `setStyle` to read, as a longhand set on its own is.
 *
 * ponytail: `border` and its sides, `outline`, `box-shadow`, `background`, `font` and
 * `text-decoration`. A token is read where a stylesheet reads one that native can tell the part of:
 * in a line of written parts, as the colour under a `background`, or as all of it. A `background`
 * has no position, size, repeat, `url()` or token in a gradient, and its gradients are those
 * `backgroundLayers` reads. A `box-shadow` has no relative length, no colour worked out on the node, and a token only as all
 * of it. A `font` has no
 * `small-caps`, stretch, keyword size or system font. Anything else is dropped with a warning.
 */
export interface ReadShorthand {
  /** The longhands the shorthand sets, `null` for one back at its initial value. */
  readonly set: readonly (readonly [string, unknown])[];
  /** What the node works out where it is set, once the tokens are known. */
  readonly deferred?: DeferredDeclaration;
  /** The style one side was written in, which native has for the whole box and so draws solid. */
  readonly drawnSolid?: string;
}

/** Why a value is none the shorthand takes, or null where it is left as it is. */
type Reading = ReadShorthand | string;

/** CSS whitespace, which a no-break space is not. */
const CSS_SPACE = /[ \t\n\r\f]/;

/** The values in `text`, split on CSS whitespace outside parentheses: `4px calc(2px + 2px)` is two. */
export function cssValues(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (const char of text) {
    if (depth === 0 && CSS_SPACE.test(char)) {
      if (part) parts.push(part);
      part = '';
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

const hasToken = (text: string): boolean => /var\(/i.test(text);

/** A colour as `setStyle` reads one: written out, or worked out on the node. */
function isColour(part: string): boolean {
  if (/^currentcolor$/i.test(part) || parseColor(part) || platformColourOf(part)) return true;
  return /^(?:color-mix\(|[a-z]+\([ \t\n\r\f]*from[ \t\n\r\f])/i.test(part);
}

/** `var(--c)` as the token it reads, or nothing for a part that is more than one token. */
function lineReference(part: string): LineReference | undefined {
  const token = tokenFromValue(part);
  if (!token?.alias) return undefined;
  if (/,[ \t\n\r\f]*\)$/.test(part)) return { reference: token.alias, empty: true };
  return { reference: token.alias, ...(token.fallback && { fallback: token.fallback }) };
}

type LineTemplate = NonNullable<DeferredDeclaration['line']>;
type LineReference = LineTemplate['references'][number];

/** The sides each line is drawn on, and the prop of the one style it has, if it has one. */
const SIDES = ['Top', 'Right', 'Bottom', 'Left'].map((side) => `border${side}`);
const LINES: Readonly<Record<string, { sides: readonly string[]; style?: string }>> = {
  border: { sides: SIDES, style: 'borderStyle' },
  outline: { sides: ['outline'], style: 'outlineStyle' },
  borderTop: { sides: ['borderTop'] },
  borderRight: { sides: ['borderRight'] },
  borderBottom: { sides: ['borderBottom'] },
  borderLeft: { sides: ['borderLeft'] },
  // One value for both sides is left and right, as in a stylesheet, which a later `border-left`
  // overrides. A start or an end follows the direction.
  borderInline: { sides: ['borderLeft', 'borderRight'] },
  borderInlineStart: { sides: ['borderStart'] },
  borderInlineEnd: { sides: ['borderEnd'] },
  borderBlock: { sides: ['borderTop', 'borderBottom'] },
  borderBlockStart: { sides: ['borderTop'] },
  borderBlockEnd: { sides: ['borderBottom'] },
};

const LINE_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge']);
LINE_STYLES.add('inset').add('outset');
/** The styles native draws a whole box in. */
const DRAWN = new Set(['solid', 'dashed', 'dotted']);
const NO_LINE = new Set(['none', 'hidden']);
const LINE_WIDTHS: Readonly<Record<string, string>> = { thin: '1px', medium: '3px', thick: '5px' };
const LENGTH = /^\+?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px|rem|em|vw|vh|vmin|vmax)$|^[+-]?0$|^calc\(/i;

interface Line {
  width?: string;
  style?: string;
  colour?: string;
  readonly references: LineReference[];
}

/** What a written part of a line is, by its form. */
function linePartRole(part: string): 'width' | 'style' | 'colour' | undefined {
  const word = part.toLowerCase();
  if (Object.hasOwn(LINE_WIDTHS, word) || LENGTH.test(part)) return 'width';
  if (LINE_STYLES.has(word) || NO_LINE.has(word)) return 'style';
  return isColour(part) ? 'colour' : undefined;
}

/** One part of a line, kept as what its form says it is. False for one it cannot be. */
function readLinePart(part: string, line: Line): boolean {
  if (hasToken(part)) {
    const reference = lineReference(part);
    if (reference) line.references.push(reference);
    return reference !== undefined;
  }
  const role = linePartRole(part);
  if (!role || line[role] !== undefined) return false;
  const word = part.toLowerCase();
  line[role] = role === 'style' ? word : role === 'width' ? (LINE_WIDTHS[word] ?? word) : part;
  return true;
}

const each = (props: readonly string[], part: string, value: unknown) =>
  props.map((prop) => [`${prop}${part}`, value] as const);

/** The name no token has: a part of a line written out reads as its fallback. */
const WRITTEN = '--';

const written = (part: string | undefined): LineReference[] => {
  const fallback = part === undefined ? undefined : tokenFromValue(part);
  return fallback ? [{ reference: WRITTEN, fallback }] : [];
};

/**
 * What a line with a token in it leaves the node, all of it, the written parts as tokens with
 * nothing else to say: an unset token makes the whole line invalid, which is over a value
 * written beside it, and a part of a style set on the element would stand after that.
 */
function lineTemplate(line: Line, sides: readonly string[], styleProp?: string) {
  const { width, style, colour, references } = line;
  const widths = sides.map((side) => `${side}Width`);
  const colors = sides.map((side) => `${side}Color`);
  const marks = styleProp && sides[0] !== 'outline' ? sides.map((side) => `${side}Style`) : [];
  const template: LineTemplate = {
    references: [
      ...written(width),
      ...written(styleProp && style),
      ...written(colour),
      ...references,
    ],
    roles: styleProp ? ['width', 'style', 'color'] : ['width', 'color'],
    widths,
    colors,
    ...(styleProp && { style: styleProp }),
    ...(marks.length ? { marks } : {}),
  };
  return {
    props: [...widths, ...(styleProp ? [styleProp] : []), ...marks, ...colors],
    line: template,
  };
}

/** A line of written parts: a style left out is none, and draws nothing, as a browser has it. */
function writtenLine(line: Line, sides: readonly string[], styleProp?: string): Reading {
  const { width, style, colour } = line;
  if (style === undefined || NO_LINE.has(style)) return { set: each(sides, 'Width', '0px') };
  if (styleProp && !DRAWN.has(style)) return NOT_DRAWN;
  return {
    set: [
      ...each(sides, 'Width', width ?? '3px'),
      ...(styleProp ? [[styleProp, style] as const] : []),
      ...each(sides, 'Color', colour ?? 'currentcolor'),
    ],
    ...(!styleProp && style !== 'solid' && { drawnSolid: style }),
  };
}

/** A line with a token in it, which may be the style too unless the line says it draws none. */
function tokenLine(line: Line, sides: readonly string[], styleProp?: string): Reading {
  const { style } = line;
  if (style !== undefined && NO_LINE.has(style)) return { set: each(sides, 'Width', '0px') };
  if (styleProp && style !== undefined && !DRAWN.has(style)) return NOT_DRAWN;
  return { set: [], deferred: lineTemplate(line, sides, styleProp) };
}

function readLine(key: string, text: string): Reading {
  const { sides, style: styleProp } = LINES[key]!;
  const line: Line = { references: [] };
  const parts = cssValues(text);
  if (parts.length > 3 || !parts.every((part) => readLinePart(part, line))) return NOT_A_LINE;
  if (!line.references.length) return writtenLine(line, sides, styleProp);
  return parts.length < 2 ? ONE_TOKEN : tokenLine(line, sides, styleProp);
}

const NOT_DRAWN = 'native draws a box solid, dashed or dotted';
const NOT_A_LINE = 'a line takes one width, one style and one colour';
const ONE_TOKEN = 'a token alone may be any part of a line, which only the build can tell';

/** A length in a shadow, in points, or nothing for one the node would have to measure. */
function shadowLength(part: string): number | undefined {
  if (/^[+-]?0$/.test(part)) return 0;
  const [, value, unit] = /^([+-]?(?:\d*\.)?\d+)(px|rem)$/i.exec(part) ?? [];
  if (value === undefined) return undefined;
  return Number(value) * (unit!.toLowerCase() === 'rem' ? 16 : 1);
}

const CURRENT_COLOUR = Object.freeze({ __colour: Object.freeze({ color: 'currentcolor' }) });

interface Shadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blurRadius: number;
  readonly spreadDistance: number;
  readonly color: unknown;
  readonly inset: boolean;
}

/** A colour a shadow's list can carry, which the node does not work out: no function of tokens. */
const isShadowColour = (part: string): boolean =>
  /^currentcolor$/i.test(part) || !!parseColor(part);

/** The parts of a shadow: lengths, together, with `inset` and a colour either side. */
function shadowParts(text: string) {
  const out = { lengths: [] as number[], inset: false, color: undefined as string | undefined };
  let ended = false;
  for (const part of cssValues(text)) {
    const length = shadowLength(part);
    if (length !== undefined && ended) return undefined;
    if (length !== undefined) out.lengths.push(length);
    else if (/^inset$/i.test(part) && !out.inset) out.inset = true;
    else if (out.color === undefined && isShadowColour(part)) out.color = part;
    else return undefined;
    ended ||= length === undefined && out.lengths.length > 0;
  }
  return out;
}

/** One shadow of a list: two to four lengths, `inset` and a colour. */
function readShadow(text: string): Shadow | undefined {
  const parts = shadowParts(text);
  if (!parts) return undefined;
  const { lengths, color, inset } = parts;
  const [offsetX, offsetY, blurRadius = 0, spreadDistance = 0] = lengths;
  if (offsetX === undefined || offsetY === undefined) return undefined;
  if (lengths.length > 4 || blurRadius < 0) return undefined;
  const painted = color === undefined || /^currentcolor$/i.test(color) ? CURRENT_COLOUR : color;
  return { offsetX, offsetY, blurRadius, spreadDistance, color: painted, inset };
}

/** A `box-shadow` as the list native takes, which it does not read from text. */
function readShadows(text: string, on: string): Reading {
  if (/^none$/i.test(text)) return { set: [['boxShadow', []]] };
  const whole = boundDeclaration('boxShadow', tokenFromValue(text), on);
  if (whole?.reference) return { set: [], deferred: whole };
  const shadows = splitLayers(text).map(readShadow);
  if (shadows.some((shadow) => shadow === undefined)) {
    return 'a shadow is two to four lengths, a colour and inset, none of them a token';
  }
  // A colour worked out on the node makes the list a value the node works out.
  const late = shadows.some((shadow) => shadow!.color === CURRENT_COLOUR);
  return late
    ? { set: [], deferred: { props: ['boxShadow'], within: shadows } }
    : { set: [['boxShadow', shadows]] };
}

const IMAGE = 'experimental_backgroundImage';

/** What `background` puts back of what it does not say, one of each for each of its layers. */
const BACKGROUND_RESTS = Object.entries(BACKGROUND_PLACING);

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const background = (colour: string, images: readonly object[]) => [
  ['backgroundColor', colour] as const,
  [IMAGE, images] as const,
  ...BACKGROUND_RESTS.map(
    ([prop, rest]) => [prop, new Array(Math.max(images.length, 1)).fill(rest)] as const,
  ),
];

const NO_BACKGROUND =
  'a background is a colour, or linear gradients over one, with no position, size or repeat';

/** A `var()` as all of a layer, the background's colour, or nothing for any other. */
function backgroundToken(layer: string, on: string): DeferredDeclaration | undefined {
  if (cssValues(layer).length !== 1) return undefined;
  const declaration = boundDeclaration('backgroundColor', tokenFromValue(layer), on);
  return declaration?.reference ? declaration : undefined;
}

/** A `background: var()`, whose token may hold the images as well as the colour. */
function wholeToken(layer: string, on: string): Reading {
  const token = backgroundToken(layer, on);
  if (!token) return NO_BACKGROUND;
  return { set: [], deferred: { ...token, props: ['backgroundColor', IMAGE], layers: true } };
}

/** Gradients over a token, which is the colour under them. */
function layersOverToken(layers: readonly string[], on: string): Reading {
  const images = backgroundLayers(layers.slice(0, -1).join(','));
  const token = backgroundToken(layers.at(-1)!, on);
  if (!images || images.color !== undefined || !token) return NO_BACKGROUND;
  // Through any `var()` in its fallback, whose names the declaration already lists.
  let fallbackLayer = tokenFromValue(layers.at(-1)!);
  while (fallbackLayer?.alias) fallbackLayer = fallbackLayer.fallback;
  return {
    set: background(TRANSPARENT, images.images).slice(2),
    deferred: {
      ...token,
      props: ['backgroundColor', IMAGE],
      layers: true,
      over: { [IMAGE]: images.images },
      ...(fallbackLayer ? { fallbackLayer } : {}),
    },
  };
}

function readBackground(text: string, on: string): Reading {
  const layers = splitLayers(text);
  if (hasToken(layers.at(-1)!)) {
    return layers.length === 1 ? wholeToken(text, on) : layersOverToken(layers, on);
  }
  if (/^none$/i.test(text)) return { set: background(TRANSPARENT, []) };
  if (isColour(text) && cssValues(text).length === 1) return { set: background(text, []) };
  const read = backgroundLayers(text);
  return read ? { set: background(read.color ?? TRANSPARENT, read.images) } : NO_BACKGROUND;
}

const FONT_STYLE = /^(?:normal|italic|oblique)$/i;
const FONT_WEIGHT = /^(?:normal|bold|\d+(?:\.\d+)?)$/i;
const FONT_SIZE = /^(?:(?:\d*\.)?\d+(?:px|rem|em|vw|vh|vmin|vmax)|0)$/i;
const NO_FONT = 'a font is a size and a family, after a style and a weight';
/** The words no family takes unquoted, which CSS keeps for itself. */
const RESERVED_FAMILY = /^(?:inherit|initial|unset|revert|revert-layer|default)$/i;

/** A weight as a stylesheet writes one: a word `normal`, and any other as its number's text. */
const fontWeight = (word: string): string =>
  /^bold$/i.test(word) ? '700' : /^normal$/i.test(word) ? 'normal' : word;

/** A line height as a value of its own: a percentage is the multiple it is, and `normal` none. */
function fontLineHeight(height: string | undefined): unknown {
  if (height === undefined || /^normal$/i.test(height)) return null;
  return height.endsWith('%') ? String(Number(height.slice(0, -1)) / 100) : height;
}

/** `font: italic bold 12px/1.5 Georgia, serif`: all a browser sets, the left out at its initial. */
function readFont(text: string): Reading {
  const parts = cssValues(text.replace(/[ \t\n\r\f]*\/[ \t\n\r\f]*/, '/'));
  let style = 'normal';
  let weight = 'normal';
  let at = 0;
  for (; at < parts.length; at++) {
    const part = parts[at]!;
    if (FONT_SIZE.test(part.split('/')[0]!)) break;
    if (FONT_WEIGHT.test(part) && !/^normal$/i.test(part)) weight = fontWeight(part);
    else if (FONT_STYLE.test(part)) style = /^normal$/i.test(part) ? style : 'italic';
    else return NO_FONT;
  }
  const [size, height] = (parts[at] ?? '').split('/');
  const family = parts.slice(at + 1).join(' ');
  const first = family ? firstFamily(family) : undefined;
  const reserved = splitLayers(family).some((name) => RESERVED_FAMILY.test(name));
  if (!size || first === undefined || reserved) return NO_FONT;
  return {
    set: [
      ['fontSize', size],
      ['fontFamily', first],
      ['fontStyle', style],
      ['fontWeight', weight],
      ['lineHeight', fontLineHeight(height)],
    ],
  };
}

const DECORATION_LINES = ['underline', 'overline', 'line-through'];
const DECORATION_STYLES = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);
const NO_DECORATION = 'a text decoration is its lines, a style and a colour';

/** Whether a part of a `text-decoration` was one it takes, kept in `found` if so. */
function readDecorationPart(part: string, found: Decoration): boolean {
  const word = part.toLowerCase();
  if (word === 'none') found.none = true;
  else if (DECORATION_LINES.includes(word)) found.lines.add(word);
  else if (found.style === undefined && DECORATION_STYLES.has(word)) found.style = word;
  else if (found.colour !== undefined || hasToken(part) || !isColour(part)) return false;
  else found.colour = part;
  return true;
}

interface Decoration {
  readonly lines: Set<string>;
  none?: boolean;
  style?: string;
  colour?: string;
}

/** `text-decoration: underline dotted red`, each part at its initial value where left out. */
function readDecoration(text: string): Reading {
  const found: Decoration = { lines: new Set() };
  const read = cssValues(text).every((part) => readDecorationPart(part, found));
  if (!read || (found.none && found.lines.size)) return NO_DECORATION;
  const line = DECORATION_LINES.filter((each) => found.lines.has(each)).join(' ');
  return {
    set: [
      ['textDecorationLine', line || 'none'],
      ['textDecorationStyle', found.style ?? 'solid'],
      ['textDecorationColor', found.colour ?? 'currentcolor'],
    ],
  };
}

/** Each shorthand of mixed parts by the key a style has it under, and what reads it. */
export const MIXED_SHORTHANDS: ReadonlyMap<string, (text: string, on: string) => Reading> = new Map<
  string,
  (text: string, on: string) => Reading
>([
  ...Object.keys(LINES).map(
    (key) => [key, (text: string) => readLine(key, text)] as [string, (text: string) => Reading],
  ),
  ['boxShadow', readShadows],
  ['background', readBackground],
  ['font', readFont],
  ['textDecoration', readDecoration],
]);
