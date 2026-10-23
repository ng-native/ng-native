/**
 * A custom property's value set on an element at run time, `[style.--tint]="tint()"` or
 * `style="--gap: 4px"`, as a token the cascade can read.
 *
 * A stylesheet's custom properties are converted when the app is built, where there is a CSS
 * parser (`@ng-native/metro/css/values.cjs`). A bound one only exists here, where there is not,
 * so this takes the shapes a binding actually holds and nothing more: a length in `px`, `%`,
 * `rem`, `em` or a viewport unit, two to four lengths in `px`, a number, a colour as React Native
 * writes one, a `platform-color()`, a colour's three channels, a word, another token,
 * `var(--brand)`, and one made of others, `calc(var(--gap) * 2)`, `calc(10px * 2)` or a
 * `color-mix()` (see inline-derived-token.ts).
 * Anything else is kept as a word, which leaves a use site that wants a length or a colour unset,
 * as a token of the wrong kind does.
 */
import {
  CSS_SPACE,
  type DeferredDeclaration,
  type PlatformColour,
  type TokenValue,
} from './css.ts';
import { derivedToken } from './inline-derived-token.ts';
import { HUE_DEGREES, isNamedColor } from './transition.ts';

const PX = /^(-?\d*\.?\d+)px$/;
const PERCENT = /^-?\d*\.?\d+%$/;
const RELATIVE = /^(-?\d*\.?\d+)(rem|em|vw|vh|vmin|vmax)$/i;
const NUMBER = /^-?\d*\.?\d+$/;
const ANGLE = /^(-?\d*\.?\d+)(deg|grad|rad|turn)$/i;
/** `#fff`, `rgb()`, `rgba()`, `hsl()`, `hsla()` and `hwb()`: what React Native's `processColor` reads. */
const COLOR_FUNCTION = /^(#[\da-f]{3,8}|(rgba?|hsla?|hwb)\(.*\))$/i;
const WORD = /^-?[a-z][\w-]*$/i;
/** One colour channel: a number, a percentage, or a hue with its unit. */
const CHANNEL = /^(-?(?:\d+\.?\d*|\.\d+))(%|deg|grad|rad|turn)?$/;
/** `var(--name)` or `var(--name, <fallback>)`, the whole value. */
const VAR = /^var\([ \t\n\r\f]*(--[\w-]+)[ \t\n\r\f]*(?:,([\s\S]*))?\)$/i;
/**
 * A value worked out where it is set: one with a `var()` in it, a `calc()`, `min()` or `max()`,
 * a `color-mix()`, or a relative colour, of tokens or of values written out.
 */
const DERIVED = /var\(|^(?:calc|min|max|color-mix)\(|^[a-z]+\([ \t\n\r\f]*from[ \t\n\r\f]/i;
const WEIGHTS: Record<string, string> = { normal: '400', bold: '700' };
/**
 * CSS whitespace at either end: a space, a tab, a newline, a carriage return or a form feed. A
 * no-break space is part of the value, as it is in a browser, where `trim()` would drop it.
 */
const PADDED = new RegExp(`^${CSS_SPACE.source}|${CSS_SPACE.source}$`, 'g');
export const cssTrim = (text: string): string => text.replace(PADDED, '');
/** A family name's parts: a quoted string, which may hold escapes, or a bare word. */
const FAMILY_PART = /^(?:'((?:[^'\\]|\\[\s\S])*)'|"((?:[^"\\]|\\[\s\S])*)"|(-?[a-z_][\w-]*))/i;
const LEADING_SPACE = new RegExp(`^${CSS_SPACE.source}`);
/**
 * A CSS escape: up to six hex digits and one whitespace after them, a newline, which only joins
 * the lines either side, or any other character.
 */
const ESCAPE = /\\([\da-f]{1,6})(?:\r\n|[ \t\n\r\f])?|\\(\r\n|[\n\r\f])|\\([\s\S])/gi;

/** A quoted string's text with its escapes decoded. One naming no character is U+FFFD. */
const decodeEscapes = (text: string): string =>
  text.replace(ESCAPE, (_, hex: string | undefined, newline: string | undefined, char: string) => {
    if (newline !== undefined) return '';
    if (hex === undefined) return char;
    const code = parseInt(hex, 16);
    return code && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : '\ufffd';
  });

/**
 * The first family of a `font-family` stack, as a stylesheet reads it (`firstFamily` in
 * values.cjs): `'Inter Display', sans-serif` is `Inter Display`, and `Segoe UI` is one name of two
 * words. Undefined for anything that is not a stack.
 */
export function firstFamily(value: string): string | undefined {
  let rest = cssTrim(value);
  const words: string[] = [];
  while (rest && !rest.startsWith(',')) {
    const part = FAMILY_PART.exec(rest);
    if (!part) return undefined;
    const quoted = part[1] ?? part[2];
    words.push(quoted === undefined ? part[3]! : decodeEscapes(quoted));
    rest = rest.slice(part[0].length).replace(LEADING_SPACE, '');
  }
  return words.length ? words.join(' ') : undefined;
}

/**
 * A value kept as written, and a family too when it reads as one: `'Inter-Bold'` is the family
 * `Inter-Bold`, and a stack its first. The written word stays the keyword, so a quoted `"none"` is
 * still no display.
 */
function fromText(text: string): TokenValue {
  const family = firstFamily(text);
  return family === undefined || family === text ? { keyword: text } : { keyword: text, family };
}

/**
 * CSS takes a bare 0 wherever it takes a length, and no other bare number. A number from 1 to 1000
 * is a weight as well, at the nearest hundred, which is every weight native draws.
 */
function fromNumber(value: number): TokenValue | undefined {
  if (!Number.isFinite(value)) return undefined;
  const weight =
    value >= 1 && value <= 1000
      ? { weight: String(Math.min(900, Math.max(100, Math.round(value / 100) * 100))) }
      : {};
  // And a line height, as a multiple of the font size, as the stylesheet's own reads it.
  const lineHeight = {
    lineHeight: { __defer: { unit: 'em' as const, factor: value, multiple: true as const } },
  };
  return value === 0
    ? { number: 0, length: 0, ...lineHeight }
    : { number: value, ...weight, ...lineHeight };
}

/**
 * A word is a keyword, `row`, and may be a colour, `red`, or a weight, `bold`, as well: every form
 * it can take, as the build-time conversion gives, and a use site reads the one it needs.
 */
function fromWord(text: string): TokenValue {
  const lower = text.toLowerCase();
  const weight = Object.hasOwn(WEIGHTS, lower) ? WEIGHTS[lower] : undefined;
  return {
    keyword: text,
    ...(isNamedColor(text) ? { color: text } : {}),
    ...(weight ? { weight } : {}),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * `13 110 253`, `13, 110, 253`, `100% 0% 0%` or `0 100% 50%`, in the forms `rgb()` and `hsl()` read
 * channels in, by the same rules the build-time conversion uses (`channelForms` in values.cjs).
 */
function fromChannels(text: string): TokenValue | undefined {
  const commas = text.split(',');
  const spaced = commas.length === 1;
  const words = spaced ? text.split(CSS_SPACE) : commas.map(cssTrim);
  const parsed = words.map((word) => CHANNEL.exec(word));
  if (parsed.length !== 3 || parsed.some((match) => !match)) return undefined;
  const values = parsed.map((match) => ({ n: Number(match![1]), unit: match![2] ?? '' }));
  const channels = rgbChannels(values);
  const hslChannels = hslOf(values, spaced);
  if (!channels && !hslChannels) return undefined;
  return { ...(channels ? { channels } : {}), ...(hslChannels ? { hslChannels } : {}) };
}

interface Channel {
  readonly n: number;
  readonly unit: string;
}

/** As `rgb()` reads them: three numbers, or three percentages of 255. */
function rgbChannels(values: readonly Channel[]): number[] | undefined {
  const scale = values.every((v) => v.unit === '')
    ? 1
    : values.every((v) => v.unit === '%')
      ? 255 / 100
      : 0;
  if (!scale) return undefined;
  return values.map((v) => Math.round(clamp(v.n * scale, 0, 255) * 1000) / 1000);
}

/** As `hsl()` reads them: a hue, then two percentages, which the space syntax may write bare. */
function hslOf([hue, ...rest]: readonly Channel[], spaced: boolean): number[] | undefined {
  const degrees = hue!.n * (hue!.unit === '' ? 1 : (HUE_DEGREES[hue!.unit] ?? NaN));
  const fractions = rest.map((v) =>
    v.unit === '%' || (spaced && v.unit === '') ? clamp(v.n / 100, 0, 1) : NaN,
  );
  const hsl = [degrees, ...fractions];
  return hsl.every(Number.isFinite) ? hsl : undefined;
}

/**
 * Another token, kept as an alias and resolved where it is set, as a stylesheet's `--x: var(--y)`
 * is. Undefined when the parentheses do not close where the value ends: `var(--a, 1px) var(--b)`.
 */
function fromVar(text: string): TokenValue | undefined {
  const match = VAR.exec(text);
  if (!match) return undefined;
  const alias = match[1]!;
  const rest = match[2];
  if (rest === undefined) return { alias };
  if (!balanced(rest)) return undefined;
  const fallback = tokenFromValue(rest);
  return fallback ? { alias, fallback } : { alias };
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Two to four lengths in `px`, a padding or a margin's sides, as the stylesheet's own reads them. */
function fromLengths(text: string): TokenValue | undefined {
  const parts = text.split(/[ \t\n\r\f]+/);
  if (parts.length < 2 || parts.length > 4) return undefined;
  const lengths = parts.map((part) => (part === '0' ? 0 : Number(PX.exec(part)?.[1] ?? NaN)));
  return lengths.every(Number.isFinite) ? { lengths } : undefined;
}

/** A time as CSS writes one: a number of seconds or milliseconds. */
const TIME = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)$/i;

/** A number with a unit, as the token each is: a length, a percentage, an angle or a time. */
function withUnit(text: string): TokenValue | undefined {
  const px = PX.exec(text);
  if (px) return { length: Number(px[1]) };
  // A `rem` is 16 points, and the others are measured where they are used, as in a stylesheet.
  const relative = RELATIVE.exec(text);
  if (relative) {
    const [, factor, unit] = relative;
    const lower = unit!.toLowerCase();
    if (lower === 'rem') return { length: Number(factor) * 16 };
    const measured = lower as NonNullable<DeferredDeclaration['compute']>['unit'];
    // The shape the stylesheet compiles one to, which `TokenValue` does not spell out.
    const deferred = { __defer: { unit: measured, factor: Number(factor) } };
    return { length: deferred } as unknown as TokenValue;
  }
  // A percentage is a fraction as well, and an angle its degrees, as the build-time conversion
  // reads them: an hsl() of tokens takes its saturation and its hue so.
  if (PERCENT.test(text)) return { length: text, number: Number(text.slice(0, -1)) / 100 };
  const angle = ANGLE.exec(text);
  if (angle) {
    const [, value, unit] = angle;
    return { angle: Number(value) * HUE_DEGREES[unit!.toLowerCase()]!, number: Number(value) };
  }
  const time = TIME.exec(text);
  // In milliseconds, as the build reads a time: what a transition or an animation takes.
  if (time) return { time: Number(time[1]) * (time[2]!.toLowerCase() === 's' ? 1000 : 1) };
  return undefined;
}

/**
 * A value with a token in it: another token, or one made of others, worked out where it is set.
 * Any other shape is a word no use site reads, as a colour function with a `var()` left in it is
 * not a colour native can draw.
 */
function withTokens(text: string): TokenValue {
  if (nestsTooDeep(text)) return { keyword: text };
  return fromVar(text) ?? derivedToken(text) ?? { keyword: text };
}

/**
 * How deep a value's brackets may nest for its tokens to be read. Each level is a call deeper in
 * the reading, and in working the value out after, so a few thousand, in text from a server,
 * would overflow the stack in the middle of a binding. A stylesheet's deepest is a handful.
 */
const MAX_NESTING = 32;

function nestsTooDeep(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(' && ++depth > MAX_NESTING) return true;
    if (char === ')') depth--;
  }
  return false;
}

const PLATFORM_COLOR = /^platform-color\(([\s\S]*)\)$/i;
/** A platform colour's name: a word, or a quoted string, as Android's `?attr/...` has to be. */
const PLATFORM_NAME = /^(?:'([^'\\]*)'|"([^"\\]*)"|([a-z_][\w-]*))$/i;

/**
 * `platform-color(link, "?attr/colorAccent")`, as the stylesheet holds one (`platformColor` in
 * compile.cjs): its names, which the platform resolves. Undefined for anything else, a call with
 * no name in it included.
 */
export function platformColourOf(text: string): PlatformColour | undefined {
  const inside = PLATFORM_COLOR.exec(text)?.[1];
  if (inside === undefined) return undefined;
  const names: string[] = [];
  for (const written of inside.split(',')) {
    const name = PLATFORM_NAME.exec(cssTrim(written));
    if (!name) return undefined;
    names.push(name[1] ?? name[2] ?? name[3]!);
  }
  return { platformColor: names };
}

export function tokenFromValue(value: unknown): TokenValue | undefined {
  if (typeof value === 'number') return fromNumber(value);
  if (typeof value !== 'string') return undefined;
  const text = cssTrim(value);
  if (!text) return undefined;
  const measure = withUnit(text);
  if (measure) return measure;
  if (NUMBER.test(text)) return fromNumber(Number(text));
  const platform = platformColourOf(text);
  if (platform) return { color: platform };
  if (DERIVED.test(text)) return withTokens(text);
  if (COLOR_FUNCTION.test(text)) return { color: text };
  // `0 0 0` is both, so it is kept as both, as the stylesheet's own token is.
  const lengths = fromLengths(text);
  const channels = fromChannels(text);
  if (lengths) return { ...channels, ...lengths };
  return channels ?? (WORD.test(text) ? fromWord(text) : fromText(text));
}
