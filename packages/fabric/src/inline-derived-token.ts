/**
 * A custom property set on an element to a value with a `var()` inside it,
 * `[style.--size]="'calc(var(--gap) * 2)'"`, read into the form the same text in a stylesheet is
 * compiled to, which the cascade then works out where it is set, as it does that one
 * (`resolveAliases` in css.ts).
 *
 * The shapes are the build-time conversion's and no more (`deferCalcToken`, `deferHslToken`,
 * `deferChannelsToken` and `deferMixToken` in `@ng-native/metro/css/compile.cjs`): `calc()`,
 * `min()` or `max()` of numbers, lengths in `px` or `rem`, angles, times and `var()`, with + - * /
 * and brackets; an `hsl()` with a `var()` for a channel; `rgb()` or `hsl()` of one channels token,
 * with an alpha written or tokened; and a `color-mix()` of any of these colours, tokens and
 * colours written out. Anything else is undefined, as a stylesheet refuses it.
 */
import { MIX_SPACES, type HueMethod, type MixSpace } from './color-mix.ts';
import type { Channel } from './relative-colour.ts';
import type { ColourExpression, HslChannel, TokenValue } from './css.ts';
import { tokenFromValue } from './inline-token.ts';

type Marker = NonNullable<TokenValue['deferredCalc']>[number];
type Expression = Marker['expression'];
type Alpha = Extract<NonNullable<TokenValue['deferredColour']>, { channels: unknown }>['alpha'];

interface Cursor {
  readonly text: string;
  at: number;
}

/** A `var()`: the token it names, and the text of its fallback, read as its slot wants it. */
interface Reference {
  readonly reference: string;
  readonly fallback?: string;
}

const SPACE = /\s*/y;
const FUNCTION = /([a-z][a-z-]*)\(\s*/iy;
const VAR = /var\(\s*(--[\w-]+)\s*/iy;
const LITERAL = /([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|[a-z]+)?/iy;
const WORD = /[^\s,/()]+/y;
/** A fallback that is a `var()` or arithmetic, rather than a value written out. */
const NESTED = /^\s*(var|calc|min|max)\(/i;
/** What one of each unit counts as: points, degrees, milliseconds, or itself. */
const PER_UNIT: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  rem: 16,
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
  ms: 1,
  s: 1000,
};
const PERCENTAGE = /([+-]?(?:\d+\.?\d*|\.\d+))%/y;
const HUE_UNITS: ReadonlySet<string> = new Set(['', 'deg', 'grad', 'rad', 'turn']);
const HUE_METHODS: ReadonlySet<string> = new Set(['shorter', 'longer', 'increasing', 'decreasing']);
const MATH: ReadonlySet<string> = new Set(['calc', 'min', 'max']);
const SPACES: Readonly<Record<string, 'rgb' | 'hsl'>> = {
  rgb: 'rgb',
  rgba: 'rgb',
  hsl: 'hsl',
  hsla: 'hsl',
};

/** Thrown where the text stops being one of the shapes, and caught by `whole`. */
const UNREADABLE = new Error('not a token made of others');
const fail = (): never => {
  throw UNREADABLE;
};

function match(cursor: Cursor, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = cursor.at;
  const found = pattern.exec(cursor.text);
  if (found) cursor.at = pattern.lastIndex;
  return found;
}

/** Whether the next character, past any space, is `char`; taken, with the space after it, if so. */
function take(cursor: Cursor, char: string): boolean {
  match(cursor, SPACE);
  if (cursor.text[cursor.at] !== char) return false;
  cursor.at++;
  match(cursor, SPACE);
  return true;
}

function expect(cursor: Cursor, char: string): void {
  if (!take(cursor, char)) fail();
}

/** The whole text as `read` reads it, or undefined when it is not that shape. */
function whole<T>(text: string, read: (cursor: Cursor) => T): T | undefined {
  const cursor = { text, at: 0 };
  try {
    const value = read(cursor);
    match(cursor, SPACE);
    return cursor.at === text.length ? value : undefined;
  } catch (error) {
    if (error === UNREADABLE) return undefined;
    throw error;
  }
}

/** A `var()` from its name on, to the bracket that closes it. */
function reference(cursor: Cursor, name: string): Reference {
  if (take(cursor, ')')) return { reference: name };
  expect(cursor, ',');
  const start = cursor.at;
  for (let depth = 0; cursor.at < cursor.text.length; cursor.at++) {
    const char = cursor.text[cursor.at];
    if (char === '(') depth++;
    else if (char === ')' && depth-- === 0) break;
  }
  const fallback = cursor.text.slice(start, cursor.at);
  expect(cursor, ')');
  return { reference: name, fallback };
}

/** A fallback's token. One that is another `var()` is refused, as the compiler refuses it. */
function fallbackToken(text: string | undefined): TokenValue | undefined {
  const token = text === undefined ? undefined : tokenFromValue(text);
  return token?.alias ? fail() : token;
}

/** A number, length, angle or time, as the number its slot counts in. */
function literal(cursor: Cursor, units: (unit: string) => number | undefined): number {
  const found = match(cursor, LITERAL) ?? fail();
  return Number(found[1]) * (units((found[2] ?? '').toLowerCase()) ?? fail());
}

/** A number slot takes a percentage as a fraction, which a length slot cannot work out. */
const unitsOf =
  (kind: Marker['kind']) =>
  (unit: string): number | undefined =>
    unit === '%' ? (kind === 'number' ? 0.01 : undefined) : PER_UNIT[unit];

function sum(cursor: Cursor, kind: Marker['kind']): Expression {
  let value = product(cursor, kind);
  for (let op; (op = (['+', '-'] as const).find((char) => take(cursor, char)));) {
    value = [op, value, product(cursor, kind)];
  }
  return value;
}

function product(cursor: Cursor, kind: Marker['kind']): Expression {
  let value = factor(cursor, kind);
  for (let op; (op = (['*', '/'] as const).find((char) => take(cursor, char)));) {
    value = [op, value, factor(cursor, kind)];
  }
  return value;
}

function factor(cursor: Cursor, kind: Marker['kind']): Expression {
  if (take(cursor, '(')) {
    const value = sum(cursor, kind);
    expect(cursor, ')');
    return value;
  }
  const name = match(cursor, VAR)?.[1];
  if (name) {
    const value = leafFallback(reference(cursor, name).fallback, kind);
    return value === undefined ? { reference: name } : { reference: name, fallback: value };
  }
  const fn = match(cursor, FUNCTION)?.[1];
  if (fn) return math(cursor, fn, kind);
  const value = literal(cursor, unitsOf(kind));
  // A percentage, kept apart from a bare number, as `literal` in the compiler keeps it.
  return cursor.text[cursor.at - 1] === '%' ? { percentage: value } : value;
}

/**
 * A `var()` fallback in arithmetic, as its slot reads it: another `var()` or arithmetic of its
 * own, read as a tree, `var(--a, calc(var(--gap) * 2))`, as `leaf` in the compiler reads it; a
 * length in points, `rem` included as the compiler counts it; or a bare number.
 */
function leafFallback(text: string | undefined, kind: Marker['kind']): Expression | undefined {
  if (text !== undefined && NESTED.test(text)) {
    return whole(text.trim(), (cursor) => factor(cursor, kind)) ?? fail();
  }
  const token = fallbackToken(text);
  if (kind !== 'length') return numberFallback(token, kind);
  if (typeof token?.length === 'number') return token.length;
  const rem = text === undefined ? undefined : /^\s*(-?\d*\.?\d+)rem\s*$/i.exec(text);
  return rem ? Number(rem[1]) * PER_UNIT['rem']! : undefined;
}

/** A fallback where a number is wanted: a percentage kept apart from a bare number. */
function numberFallback(
  token: TokenValue | undefined,
  kind: Marker['kind'],
): Expression | undefined {
  const percentage =
    kind === 'number' && typeof token?.length === 'string' && token.number !== undefined;
  return percentage ? { percentage: token.number! } : token?.number;
}

/** The rest of a `calc()`, or of a `min()` or `max()` of sums, once its name is read. */
function math(cursor: Cursor, fn: string, kind: Marker['kind']): Expression {
  const name = fn.toLowerCase();
  if (!MATH.has(name)) fail();
  const sides = [sum(cursor, kind)];
  while (name !== 'calc' && take(cursor, ',')) sides.push(sum(cursor, kind));
  expect(cursor, ')');
  return sides.reduce((a, b) => [name as 'min' | 'max', a, b]);
}

/** Arithmetic of tokens, read as a length and as a number, whichever each reading makes of it. */
function calcToken(text: string): TokenValue | undefined {
  const markers = (['length', 'number'] as const).flatMap((kind): Marker[] => {
    const expression = whole(text, (cursor) =>
      math(cursor, (match(cursor, FUNCTION) ?? fail())[1]!, kind),
    );
    return expression === undefined ? [] : [{ expression, kind }];
  });
  return markers.length ? { deferredCalc: markers } : undefined;
}

/** An argument of a colour function: a `var()`, or a word read as its slot wants it. */
type Argument = Reference | { readonly word: string };

/**
 * A colour function's arguments, with the commas and the slash between them gone, and whether
 * commas were what separated them.
 */
function colourArguments(cursor: Cursor): {
  space: 'rgb' | 'hsl';
  args: Argument[];
  legacy: boolean;
} {
  const space = SPACES[(match(cursor, FUNCTION) ?? fail())[1]!.toLowerCase()] ?? fail();
  const args: Argument[] = [];
  let legacy = false;
  while (!take(cursor, ')')) {
    if (take(cursor, ',')) legacy = true;
    else if (!take(cursor, '/')) {
      const name = match(cursor, VAR)?.[1];
      args.push(name ? reference(cursor, name) : { word: (match(cursor, WORD) ?? fail())[0] });
    }
  }
  return { space, args, legacy };
}

/** What each argument of an `hsl()` is: a hue, a saturation and a lightness, then an alpha. */
const HSL_SLOTS = ['hue', 'percentage', 'percentage', 'alpha'] as const;

/**
 * A written `hsl()` channel as its slot reads it, as `hslLiteral` in the compiler does: a hue in
 * degrees; a saturation or a lightness as a fraction, from a percentage or, in the space syntax
 * only, a bare number of percent; an alpha as a number or a fraction.
 */
function hslLiteral(
  text: string,
  slot: (typeof HSL_SLOTS)[number],
  legacy: boolean,
): number | undefined {
  const perUnit = (unit: string): number | undefined => {
    if (slot === 'hue') return HUE_UNITS.has(unit) ? PER_UNIT[unit] : undefined;
    if (unit === '%') return 0.01;
    if (unit !== '') return undefined;
    return slot === 'alpha' ? 1 : legacy ? undefined : 0.01;
  };
  return whole(text, (cursor) => literal(cursor, perUnit));
}

function hslChannel(arg: Argument, index: number, legacy: boolean): HslChannel {
  const slot = HSL_SLOTS[index]!;
  if ('word' in arg) return hslLiteral(arg.word, slot, legacy) ?? fail();
  const fallback = arg.fallback === undefined ? undefined : hslLiteral(arg.fallback, slot, legacy);
  return fallback === undefined
    ? { reference: arg.reference }
    : { reference: arg.reference, fallback };
}

/** A channels colour's alpha: none, written as a number or a percentage, or a token of its own. */
function alphaOf(arg: Argument | undefined): Alpha {
  if (arg === undefined) return undefined;
  if ('word' in arg) {
    return whole(arg.word, (cursor) => literal(cursor, unitsOf('number'))) ?? fail();
  }
  const fallback = fallbackToken(arg.fallback)?.number;
  return fallback === undefined
    ? { reference: arg.reference }
    : { reference: arg.reference, fallback };
}

/** `rgba(var(--channels), <alpha>)`, as `deferChannelsToken` reads it. */
function channelsToken(
  channels: Reference,
  alpha: Argument | undefined,
  space: 'rgb' | 'hsl',
): TokenValue {
  const token = fallbackToken(channels.fallback);
  const fallback = space === 'hsl' ? token?.hslChannels : token?.channels;
  const opacity = alphaOf(alpha);
  return {
    deferredColour: {
      channels: { reference: channels.reference, ...(fallback ? { fallback } : {}), space },
      ...(opacity === undefined ? {} : { alpha: opacity }),
    },
  };
}

/** `hsl(var(--h) 100% 50%)` and the like, as `deferHslToken` reads it. */
function hslToken(args: readonly Argument[], legacy: boolean): TokenValue {
  if (args.length !== 3 && args.length !== 4) fail();
  const [h, s, l, alpha] = args.map((arg, index) => hslChannel(arg, index, legacy));
  const legacyFlag = legacy ? { legacy: true as const } : {};
  return { hsl: { h: h!, s: s!, l: l!, ...(alpha === undefined ? {} : { alpha }), ...legacyFlag } };
}

function colourToken(text: string): TokenValue | undefined {
  return whole(text, (cursor) => {
    const { space, args, legacy } = colourArguments(cursor);
    const [channels, alpha, ...rest] = args;
    if (channels && 'reference' in channels && !rest.length) {
      return channelsToken(channels, alpha, space);
    }
    return space === 'hsl' ? hslToken(args, legacy) : fail();
  });
}

/** The index just past the bracket that closes the function the cursor is inside. */
function closing(cursor: Cursor): number {
  for (let at = cursor.at, depth = 0; at < cursor.text.length; at++) {
    const char = cursor.text[at];
    if (char === '(') depth++;
    else if (char === ')' && depth-- === 0) return at + 1;
  }
  return fail();
}

/**
 * A `var()` in a colour, as `reference` in the compiler's colour-expression.cjs reads it: the
 * tokens its `var()` fallbacks name, tried in turn, then a colour, or one made of other tokens.
 */
function referenceColour({ reference: name, fallback }: Reference): ColourExpression {
  const alternatives: string[] = [];
  let rest = fallback?.trim();
  for (let next; rest && (next = whole(rest, nextReference)); rest = next.fallback?.trim()) {
    alternatives.push(next.reference);
  }
  return {
    reference: name,
    ...(alternatives.length ? { alternatives } : {}),
    ...(rest ? colourFallback(rest) : {}),
  };
}

/** The colour a `var()` falls back to, or one made of other tokens; refused when it is neither. */
function colourFallback(text: string): { fallback: string } | { fallbackToken: TokenValue } {
  const token = tokenFromValue(text);
  if (token?.hsl || token?.deferredColour) return { fallbackToken: token };
  return { fallback: token?.color ?? fail() };
}

const nextReference = (cursor: Cursor): Reference =>
  reference(cursor, (match(cursor, VAR) ?? fail())[1]!);

/**
 * One colour in a `color-mix()`: a `var()`, another mix, an `rgb()` or `hsl()` of tokens, or a
 * colour written out, which is kept as written for the mix to read.
 */
function mixColour(cursor: Cursor): ColourExpression {
  const name = match(cursor, VAR)?.[1];
  if (name) return referenceColour(reference(cursor, name));
  const start = cursor.at;
  const fn = match(cursor, FUNCTION)?.[1]?.toLowerCase();
  if (fn === 'color-mix') return mixExpression(cursor);
  if (!fn) return { color: (match(cursor, WORD) ?? fail())[0] };
  if (RELATIVE[fn] && takeWord(cursor, 'from')) return relativeExpression(cursor, RELATIVE[fn]);
  cursor.at = closing(cursor);
  return functionColour(cursor.text.slice(start, cursor.at));
}

/** A colour function in a mix: of tokens, as a token of it is read, or written out, as it is. */
function functionColour(text: string): ColourExpression {
  if (!text.includes('var(')) return { color: text };
  const token = colourToken(text);
  return token?.hsl ? { hsl: token.hsl } : (token?.deferredColour ?? fail());
}

/** One side of a mix: its colour, and the percentage written before or after it, if one is. */
function mixSide(cursor: Cursor): { colour: ColourExpression; percentage?: number } {
  const percentage = () => {
    const found = match(cursor, PERCENTAGE);
    match(cursor, SPACE);
    return found ? Number(found[1]) : undefined;
  };
  const before = percentage();
  const colour = mixColour(cursor);
  match(cursor, SPACE);
  const after = before === undefined ? percentage() : undefined;
  const written = before ?? after;
  return written === undefined ? { colour } : { colour, percentage: written };
}

/**
 * The rest of a `color-mix(in <space> [<method> hue], <colour> [p%], <colour> [q%])` once its name
 * is read, as `mixExpression` in the compiler reads it.
 */
function mixExpression(cursor: Cursor): ColourExpression {
  const words: string[] = [];
  while (!take(cursor, ',')) {
    words.push((match(cursor, WORD) ?? fail())[0].toLowerCase());
    match(cursor, SPACE);
  }
  const [keyword, space, method, hue, ...rest] = words;
  if (keyword !== 'in' || !MIX_SPACES.has(space!) || rest.length) fail();
  if (method !== undefined && (hue !== 'hue' || !HUE_METHODS.has(method))) fail();
  const a = mixSide(cursor);
  expect(cursor, ',');
  const b = mixSide(cursor);
  expect(cursor, ')');
  return {
    mix: {
      space: space as MixSpace,
      ...(method ? { hue: method as HueMethod } : {}),
      a: a.colour,
      ...(a.percentage === undefined ? {} : { aPercentage: a.percentage }),
      b: b.colour,
      ...(b.percentage === undefined ? {} : { bPercentage: b.percentage }),
    },
  };
}

/** A whole `color-mix()`, worked out where it is set, as `deferMixToken` in the compiler reads it. */
function mixToken(text: string): TokenValue | undefined {
  const deferredColour = whole(text, (cursor) => {
    const colour = mixColour(cursor);
    return 'mix' in colour || 'relative' in colour ? colour : fail();
  });
  return deferredColour && { deferredColour };
}

interface RelativeSpace {
  readonly space: MixSpace;
  readonly keywords: readonly string[];
  /** What 100% of each channel is; null for a hue, which takes an angle instead. */
  readonly full: readonly (number | null)[];
}

/** Each relative colour function, as `RELATIVE` in the compiler's colour-expression.cjs. */
const RELATIVE: Readonly<Record<string, RelativeSpace>> = {
  rgb: { space: 'srgb', keywords: ['r', 'g', 'b'], full: [255, 255, 255] },
  rgba: { space: 'srgb', keywords: ['r', 'g', 'b'], full: [255, 255, 255] },
  hsl: { space: 'hsl', keywords: ['h', 's', 'l'], full: [null, 100, 100] },
  hsla: { space: 'hsl', keywords: ['h', 's', 'l'], full: [null, 100, 100] },
  hwb: { space: 'hwb', keywords: ['h', 'w', 'b'], full: [null, 100, 100] },
  lab: { space: 'lab', keywords: ['l', 'a', 'b'], full: [100, 125, 125] },
  lch: { space: 'lch', keywords: ['l', 'c', 'h'], full: [100, 150, null] },
  oklab: { space: 'oklab', keywords: ['l', 'a', 'b'], full: [1, 0.4, 0.4] },
  oklch: { space: 'oklch', keywords: ['l', 'c', 'h'], full: [1, 0.4, null] },
};

/** Whether the next word is `word`, in any case; taken, with the space after it, if so. */
function takeWord(cursor: Cursor, word: string): boolean {
  const start = cursor.at;
  if (match(cursor, WORD)?.[0].toLowerCase() === word) {
    match(cursor, SPACE);
    return true;
  }
  cursor.at = start;
  return false;
}

/**
 * The rest of `<space>(from <colour> <channel> <channel> <channel> [/ <alpha>])` once `from` is
 * read, as `relativeExpression` in the compiler reads it.
 */
function relativeExpression(cursor: Cursor, { space, keywords, full }: RelativeSpace) {
  const from = mixColour(cursor);
  const names = [...keywords, 'alpha'];
  const channels = [0, 1, 2].map((index) => {
    match(cursor, SPACE);
    return relativeChannel(cursor, names, full[index]!);
  }) as [Channel, Channel, Channel];
  const alpha = take(cursor, '/') ? relativeChannel(cursor, names, 1) : undefined;
  expect(cursor, ')');
  return { relative: { space, from, channels, ...(alpha === undefined ? {} : { alpha }) } };
}

/**
 * One channel: a `calc()` of numbers and keywords, a keyword, a number, a percentage of the
 * channel's range, or an angle for a hue.
 */
function relativeChannel(cursor: Cursor, keywords: readonly string[], full: number | null) {
  const fn = match(cursor, FUNCTION)?.[1]?.toLowerCase();
  if (fn) {
    const value = fn === 'calc' ? channelSum(cursor, keywords) : fail();
    expect(cursor, ')');
    return value;
  }
  const found = match(cursor, LITERAL);
  if (!found) return channelOperand(cursor, keywords);
  const value = Number(found[1]) * channelScale((found[2] ?? '').toLowerCase(), full);
  return Number.isFinite(value) ? value : fail();
}

/** What one of a written channel's unit is: a share of its range, degrees of a hue, or itself. */
function channelScale(unit: string, full: number | null): number {
  if (unit === '%') return full === null ? NaN : full / 100;
  if (full !== null) return unit ? NaN : 1;
  return HUE_UNITS.has(unit) ? PER_UNIT[unit]! : NaN;
}

/** `a + b - c`, each side a product of numbers, keywords and bracketed sums. */
function channelSum(cursor: Cursor, keywords: readonly string[]): Channel {
  let value = channelProduct(cursor, keywords);
  for (let op; (op = (['+', '-'] as const).find((char) => take(cursor, char)));) {
    value = [op, value, channelProduct(cursor, keywords)];
  }
  return value;
}

function channelProduct(cursor: Cursor, keywords: readonly string[]): Channel {
  let value = channelFactor(cursor, keywords);
  for (let op; (op = (['*', '/'] as const).find((char) => take(cursor, char)));) {
    value = [op, value, channelFactor(cursor, keywords)];
  }
  return value;
}

function channelFactor(cursor: Cursor, keywords: readonly string[]): Channel {
  if (take(cursor, '(')) {
    const value = channelSum(cursor, keywords);
    expect(cursor, ')');
    return value;
  }
  const found = match(cursor, LITERAL);
  // A percentage or an angle stands alone: inside arithmetic the keywords are numbers.
  if (found) return found[2] ? fail() : Number(found[1]);
  return channelOperand(cursor, keywords);
}

function channelOperand(cursor: Cursor, keywords: readonly string[]): string {
  const word = (match(cursor, WORD) ?? fail())[0];
  return keywords.includes(word) ? word : fail();
}

/**
 * A value with a `var()` inside it, or a `color-mix()`, as a token made of others; undefined if it
 * is no such shape.
 */
export function derivedToken(text: string): TokenValue | undefined {
  return calcToken(text) ?? colourToken(text) ?? mixToken(text);
}
