/**
 * The one reading of `calc()`, `min()`, `max()` and `clamp()` that runs on a device, for what no
 * build step saw: a value in a `style` attribute, a binding, or a custom property set on an element.
 *
 * `readMath` is the grammar: + and - with whitespace either side, * and /, brackets and nested
 * functions, as CSS has it. What a leaf is, and what an operator does to two sides, is the
 * caller's `MathReader`: `inline-derived-token.ts` builds a tree of tokens, and `mathValue` here
 * folds written values to what they come to, by the types CSS gives them.
 */

export interface Cursor {
  readonly text: string;
  at: number;
}

/** CSS whitespace, and no other: a no-break space is part of a word, as it is in a browser. */
export const SPACE = /[ \t\n\r\f]*/y;
const ONE_SPACE = /[ \t\n\r\f]/;
/** A number and its unit, which may be any word: `1px`, `50%`, `2`, `1e2px`. */
export const LITERAL = /([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|[a-z]+)?/iy;
const FUNCTION = /(calc|min|max|clamp)\([ \t\n\r\f]*/iy;

/** Thrown where the text stops being a shape it is read as, and caught by `whole`. */
const UNREADABLE = new Error('not a shape read here');
export const fail = (): never => {
  throw UNREADABLE;
};

/** Thrown where CSS has no type for the text, which it refuses, and caught by `whole` too. */
const REFUSED = new Error('a math function CSS refuses');
const refuse = (): never => {
  throw REFUSED;
};

export function match(cursor: Cursor, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = cursor.at;
  const found = pattern.exec(cursor.text);
  if (found) cursor.at = pattern.lastIndex;
  return found;
}

/** Whether the next character, past any space, is `char`; taken, with the space after it, if so. */
export function take(cursor: Cursor, char: string): boolean {
  match(cursor, SPACE);
  if (cursor.text[cursor.at] !== char) return false;
  cursor.at++;
  match(cursor, SPACE);
  return true;
}

export function expect(cursor: Cursor, char: string): void {
  if (!take(cursor, char)) fail();
}

/** The whole text as `read` reads it, or undefined when it is not that shape. */
export function whole<T>(text: string, read: (cursor: Cursor) => T): T | undefined {
  const cursor = { text, at: 0 };
  try {
    const value = read(cursor);
    match(cursor, SPACE);
    return cursor.at === text.length ? value : undefined;
  } catch (error) {
    if (error === UNREADABLE || error === REFUSED) return undefined;
    throw error;
  }
}

export type MathOperator = '+' | '-' | '*' | '/' | 'min' | 'max';

export interface MathReader<T> {
  /** A number, a length, a token: whatever else a side can be, read from the cursor. */
  leaf(cursor: Cursor): T;
  /** Two sides under an operator. `clamp()` comes here as the `min` and `max` it is. */
  combine(op: MathOperator, left: T, right: T): T;
}

/** The next operator of `operators`, past any space, or none, with the cursor left where it was. */
function peekOperator(cursor: Cursor, operators: string): string | undefined {
  const before = cursor.at;
  match(cursor, SPACE);
  const op = cursor.text[cursor.at];
  if (op !== undefined && operators.includes(op)) return op;
  cursor.at = before;
  return undefined;
}

/** Products added and taken away, with whitespace either side of each sign. */
function sum<T>(cursor: Cursor, reader: MathReader<T>): T {
  let value = product(cursor, reader);
  for (;;) {
    const op = peekOperator(cursor, '+-') as '+' | '-' | undefined;
    if (!op) return value;
    const [left, right] = [cursor.text[cursor.at - 1]!, cursor.text[cursor.at + 1] ?? ''];
    if (!ONE_SPACE.test(left) || !ONE_SPACE.test(right)) refuse();
    cursor.at++;
    match(cursor, SPACE);
    value = reader.combine(op, value, product(cursor, reader));
  }
}

function product<T>(cursor: Cursor, reader: MathReader<T>): T {
  let value = readMath(cursor, reader);
  for (;;) {
    const op = peekOperator(cursor, '*/') as '*' | '/' | undefined;
    if (!op) return value;
    cursor.at++;
    match(cursor, SPACE);
    value = reader.combine(op, value, readMath(cursor, reader));
  }
}

/** The rest of a function once its name is read: `clamp(a, b, c)` is `max(a, min(b, c))`. */
function call<T>(cursor: Cursor, name: string, reader: MathReader<T>): T {
  const sides = [sum(cursor, reader)];
  while (name !== 'calc' && take(cursor, ',')) sides.push(sum(cursor, reader));
  expect(cursor, ')');
  if (name !== 'clamp') {
    return sides.reduce((a, b) => reader.combine(name as 'min' | 'max', a, b));
  }
  if (sides.length !== 3) fail();
  const [least, value, most] = sides as [T, T, T];
  return reader.combine('max', least, reader.combine('min', value, most));
}

/** One side: a bracket, a math function, or a leaf. */
export function readMath<T>(cursor: Cursor, reader: MathReader<T>): T {
  if (take(cursor, '(')) {
    const value = sum(cursor, reader);
    expect(cursor, ')');
    return value;
  }
  const fn = match(cursor, FUNCTION)?.[1];
  return fn ? call(cursor, fn.toLowerCase(), reader) : reader.leaf(cursor);
}

/** A viewport unit, or `em`: lengths measured where they are used. */
export type RelativeUnit = 'em' | 'vw' | 'vh' | 'vmin' | 'vmax';

/** What written values come to: of one type, as CSS has a math function, and in one unit each. */
export interface MathValue {
  readonly type: 'number' | 'length' | 'percentage' | 'angle';
  /** The number, the points or the degrees. */
  readonly value: number;
  /** The percentage of a `percentage`, or added to a `length`. */
  readonly percent: number;
  /** The one unit a length is measured in where it is used, added to its points. */
  readonly relative?: { readonly unit: RelativeUnit; readonly factor: number };
}

const NOTHING = { value: 0, percent: 0 };

/** What one of each unit is, in points or degrees. */
const ABSOLUTE: Readonly<Record<string, Pick<MathValue, 'type' | 'value'>>> = {
  px: { type: 'length', value: 1 },
  rem: { type: 'length', value: 16 },
  deg: { type: 'angle', value: 1 },
  grad: { type: 'angle', value: 0.9 },
  rad: { type: 'angle', value: 180 / Math.PI },
  turn: { type: 'angle', value: 360 },
};
const RELATIVE: ReadonlySet<string> = new Set(['em', 'vw', 'vh', 'vmin', 'vmax']);

function written(cursor: Cursor): MathValue {
  const found = match(cursor, LITERAL) ?? fail();
  const number = Number(found[1]);
  const unit = (found[2] ?? '').toLowerCase();
  if (unit === '') return { ...NOTHING, type: 'number', value: number };
  if (unit === '%') return { ...NOTHING, type: 'percentage', percent: number };
  if (RELATIVE.has(unit)) {
    return {
      ...NOTHING,
      type: 'length',
      relative: { unit: unit as RelativeUnit, factor: number },
    };
  }
  const absolute = Object.hasOwn(ABSOLUTE, unit) ? ABSOLUTE[unit]! : fail();
  return { ...NOTHING, type: absolute.type, value: number * absolute.value };
}

const scaled = (side: MathValue, by: number): MathValue => ({
  type: side.type,
  value: side.value * by,
  percent: side.percent * by,
  ...(side.relative
    ? { relative: { unit: side.relative.unit, factor: side.relative.factor * by } }
    : {}),
});

const sized = ({ type }: MathValue): boolean => type === 'length' || type === 'percentage';

/** The one relative unit of a sum: two are two things to measure, and no form holds both. */
function addedRelative(a: MathValue['relative'], b: MathValue['relative']): MathValue['relative'] {
  if (!a || !b) return a ?? b;
  return a.unit === b.unit ? { unit: a.unit, factor: a.factor + b.factor } : fail();
}

/** A sum: a percentage takes a length and the other way round, and nothing else mixes. */
function added(left: MathValue, right: MathValue): MathValue {
  if (left.type !== right.type && !(sized(left) && sized(right))) refuse();
  const relative = addedRelative(left.relative, right.relative);
  const percent = left.percent + right.percent;
  // A percentage and a relative unit are two things to measure, and no form holds both.
  if (relative && (left.type !== right.type || percent)) fail();
  return {
    type: left.type === right.type ? left.type : 'length',
    value: left.value + right.value,
    percent,
    ...(relative ? { relative } : {}),
  };
}

/** The one number a side is compared by, in a comparison that can be made here. */
function compared(side: MathValue): number {
  if (side.type === 'percentage') return side.percent;
  if (side.percent) fail();
  if (side.relative) return side.value ? fail() : side.relative.factor;
  return side.value;
}

/** The lesser or greater of two sides of one type and one unit: no other can be compared here. */
function extreme(op: 'min' | 'max', left: MathValue, right: MathValue): MathValue {
  if (left.type !== right.type && !(sized(left) && sized(right))) refuse();
  if (left.type !== right.type || left.relative?.unit !== right.relative?.unit) fail();
  const [a, b] = [compared(left), compared(right)];
  return (op === 'min') === a <= b ? left : right;
}

const FOLDED: MathReader<MathValue> = {
  leaf: written,
  combine(op, left, right) {
    if (op === 'min' || op === 'max') return extreme(op, left, right);
    if (op === '+') return added(left, right);
    if (op === '-') return added(left, scaled(right, -1));
    if (op === '/') return right.type === 'number' ? scaled(left, 1 / right.value) : refuse();
    if (left.type === 'number') return scaled(right, left.value);
    return right.type === 'number' ? scaled(left, right.value) : refuse();
  },
};

/** Whether text starts as a math function does, past any CSS whitespace. */
export const MATH_FUNCTION = /^[ \t\n\r\f]*(?:calc|min|max|clamp)\(/i;

/**
 * How deep a value's brackets may nest. Each level is a call deeper in reading it, so a few
 * thousand, in text from a server, would overflow the stack in the middle of a binding. A
 * stylesheet's deepest is a handful.
 */
const MAX_NESTING = 32;

export function nestsTooDeep(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(' && ++depth > MAX_NESTING) return true;
    if (char === ')') depth--;
  }
  return false;
}

const allFinite = ({ value, percent, relative }: MathValue): boolean =>
  Number.isFinite(value) && Number.isFinite(percent) && Number.isFinite(relative?.factor ?? 0);

/** A number as the compiler rounds one, so a value is the same from a style and a stylesheet. */
export const rounded = (value: number): number => Math.round(value * 1e5) / 1e5 + 0;

/**
 * A math function of written values as what it comes to. Undefined for any other text, for one
 * CSS refuses, and for one this cannot work out: a division by zero, or a comparison of sides
 * that take a box or a font size to tell apart.
 */
export function mathValue(text: string): MathValue | undefined {
  if (!MATH_FUNCTION.test(text) || nestsTooDeep(text)) return undefined;
  const value = whole(text, (cursor) => {
    match(cursor, SPACE);
    return readMath(cursor, FOLDED);
  });
  return value && allFinite(value) ? value : undefined;
}

/**
 * Whether CSS has no type for a math function: a length added to a number, say. Not a function this
 * reads no further, of a unit or a name it does not know, which CSS may well take.
 */
export function mathRefused(text: string): boolean {
  if (!MATH_FUNCTION.test(text) || nestsTooDeep(text)) return false;
  try {
    const cursor = { text, at: 0 };
    match(cursor, SPACE);
    readMath(cursor, FOLDED);
    return false;
  } catch (error) {
    if (error === REFUSED) return true;
    if (error === UNREADABLE) return false;
    throw error;
  }
}

/** A math function that comes to a number, no less than 0 and unrounded; undefined for any other text. */
export function mathNumber(text: string): number | undefined {
  const math = mathValue(text);
  return math?.type === 'number' ? Math.max(math.value, 0) : undefined;
}

/** `text` split on `separator` where it is outside brackets: `calc(16 / 9) / 1` in two. */
export function splitOutside(text: string, separator: string): string[] {
  const parts = [''];
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (char === separator && depth === 0) parts.push('');
    else parts[parts.length - 1] += char;
  }
  return parts;
}

/** A math function that comes to a number, no less than 0, as `flex` takes one; any other text as it is. */
export function mathNumberText(text: string): string {
  const number = mathNumber(text);
  return number === undefined ? text : String(rounded(number));
}

/**
 * The props CSS has nothing below zero for, by the style keys both forms of them land in. A math
 * function that comes out below zero on one is clamped to 0, where a negative written out is
 * refused. `packages/metro/css/properties.cjs` holds the same list for a stylesheet.
 */
export const NEVER_NEGATIVE =
  /^(?:(?:min|max)?(?:Width|Height)|width|height|padding.*|fontSize|lineHeight|border.*(?:Width|Radius)|outlineWidth|gap|rowGap|columnGap|flexBasis|flexGrow|flexShrink|aspectRatio|opacity)$/;
