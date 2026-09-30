/**
 * A custom property's value set on an element at run time, `[style.--tint]="tint()"` or
 * `style="--gap: 4px"`, as a token the cascade can read.
 *
 * A stylesheet's custom properties are converted when the app is built, where there is a CSS
 * parser (`@ng-native/metro/css/values.cjs`). A bound one only exists here, where there is not,
 * so this takes the shapes a binding actually holds and nothing more: a length in `px` or `%`, a
 * number, a colour as React Native writes one, a colour's three channels, a word, another token,
 * `var(--brand)`, and one made of others, `calc(var(--gap) * 2)` or a `color-mix()` (see
 * inline-derived-token.ts).
 * Anything else is kept as a word, which a use site that wants a length or a colour ignores, as
 * it ignores an undefined token.
 */
import type { TokenValue } from './css.ts';
import { derivedToken } from './inline-derived-token.ts';
import { isNamedColor } from './transition.ts';

const PX = /^(-?\d*\.?\d+)px$/;
const PERCENT = /^-?\d*\.?\d+%$/;
const NUMBER = /^-?\d*\.?\d+$/;
const ANGLE = /^(-?\d*\.?\d+)(deg|grad|rad|turn)$/i;
/** `#fff`, `rgb()`, `rgba()`, `hsl()`, `hsla()` and `hwb()`: what React Native's `processColor` reads. */
const COLOR_FUNCTION = /^(#[\da-f]{3,8}|(rgba?|hsla?|hwb)\(.*\))$/i;
const WORD = /^-?[a-z][\w-]*$/i;
/** One colour channel: a number, a percentage, or a hue with its unit. */
const CHANNEL = /^(-?(?:\d+\.?\d*|\.\d+))(%|deg|grad|rad|turn)?$/;
const HUE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
/** `var(--name)` or `var(--name, <fallback>)`, the whole value. */
const VAR = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/i;
/**
 * A value worked out where it is set: one with a `var()` in it, a `color-mix()`, or a relative
 * colour, of tokens or of colours written out.
 */
const DERIVED = /var\(|^color-mix\(|^[a-z]+\(\s*from\s/i;
const WEIGHTS: Record<string, string> = { normal: '400', bold: '700' };

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
  return value === 0 ? { number: 0, length: 0 } : { number: value, ...weight };
}

/**
 * A word is a keyword, `row`, and may be a colour, `red`, or a weight, `bold`, as well: every form
 * it can take, as the build-time conversion gives, and a use site reads the one it needs.
 */
function fromWord(text: string): TokenValue {
  const weight = WEIGHTS[text.toLowerCase()];
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
  const words = spaced ? text.split(/\s+/) : commas.map((word) => word.trim());
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
  const degrees = hue!.n * (hue!.unit === '' ? 1 : (HUE_UNITS[hue!.unit] ?? NaN));
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

/**
 * A value with a token in it: another token, or one made of others, worked out where it is set.
 * Any other shape is a word no use site reads, as a colour function with a `var()` left in it is
 * not a colour native can draw.
 */
function withTokens(text: string): TokenValue {
  return fromVar(text) ?? derivedToken(text) ?? { keyword: text };
}

export function tokenFromValue(value: unknown): TokenValue | undefined {
  if (typeof value === 'number') return fromNumber(value);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const px = PX.exec(text);
  if (px) return { length: Number(px[1]) };
  // A percentage is a fraction as well, and an angle its degrees, as the build-time conversion
  // reads them: an hsl() of tokens takes its saturation and its hue so.
  if (PERCENT.test(text)) return { length: text, number: Number(text.slice(0, -1)) / 100 };
  const angle = ANGLE.exec(text);
  if (angle) {
    const [, value, unit] = angle;
    return { angle: Number(value) * HUE_UNITS[unit!.toLowerCase()]!, number: Number(value) };
  }
  if (NUMBER.test(text)) return fromNumber(Number(text));
  if (DERIVED.test(text)) return withTokens(text);
  if (COLOR_FUNCTION.test(text)) return { color: text };
  return fromChannels(text) ?? (WORD.test(text) ? fromWord(text) : { keyword: text });
}
