import type { MediaCondition } from '@ng-native/fabric';

/**
 * A media query list as the engine evaluates one: the window's width and height, which way up it
 * is, and the colour scheme and motion the user asked for, joined by `and`, `or` and commas.
 * `matchMedia` and a stylesheet read while the app runs both read a query here.
 *
 * ponytail: `not`, a feature the engine has no answer for (`hover`, `pointer`, `aspect-ratio`)
 * and a condition in brackets of its own are not read. Give the engine a negation and the
 * features if a library is seen to lay itself out by one.
 */

/** A query as it is read: the engine's condition, `not` one, or nothing it can read. */
export type Query = MediaCondition | { readonly not: MediaCondition };

/** What every window is, and what none is. */
const ALWAYS: MediaCondition = { all: [] };
const NEVER: MediaCondition = { any: [] };

/** Points in each unit a query can compare the window with: an em is the initial font size. */
const UNITS: Readonly<Record<string, number>> = { px: 1, em: 16, rem: 16 };

/** A length a query compares the window with, in points: nothing for one that is not one. */
function length(text: string): number | undefined {
  const found = /^(-?(?:\d+\.?\d*|\.\d+))([a-z]*)$/.exec(text.trim());
  if (!found) return undefined;
  const value = Number(found[1]);
  const unit = found[2]!;
  if (!unit) return value === 0 ? 0 : undefined;
  const scale = UNITS[unit];
  return scale === undefined ? undefined : value * scale;
}

type Op = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
const OPS: Readonly<Record<string, Op>> = {
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
  '=': 'eq',
};
/** An operator read from the other side: `300px < width` is `width > 300px`. */
const FLIPPED: Readonly<Record<Op, Op>> = { lt: 'gt', lte: 'gte', gt: 'lt', gte: 'lte', eq: 'eq' };

const SIZES = new Set(['width', 'height']);

/** The keyword features, and the values each can have. */
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  orientation: ['portrait', 'landscape'],
  'prefers-color-scheme': ['light', 'dark'],
  'prefers-reduced-motion': ['reduce', 'no-preference'],
};

/** `feature op value` as the engine has it, read from the other side where `flip` says. */
function compared(feature: string, op: string, value: string, flip: boolean) {
  const points = length(value);
  const read = OPS[op];
  if (!SIZES.has(feature) || points === undefined || !read) return undefined;
  return { feature, op: flip ? FLIPPED[read] : read, value: points } as MediaCondition;
}

/** `width >= 600px`, `600px <= width` or `400px < width <= 700px`: nothing for anything else. */
function range(text: string): MediaCondition | undefined {
  const parts = text.split(/\s*(<=|>=|<|>|=)\s*/);
  if (parts.length === 3) {
    const [left, op, right] = parts as [string, string, string];
    return SIZES.has(left) ? compared(left, op, right, false) : compared(right, op, left, true);
  }
  if (parts.length !== 5) return undefined;
  const [start, first, feature, second, end] = parts as [string, string, string, string, string];
  const low = compared(feature, first, start, true);
  const high = compared(feature, second, end, false);
  return low && high ? { all: [low, high] } : undefined;
}

/** One feature in brackets, without them: nothing for one the engine has no answer for. */
function feature(text: string): MediaCondition | undefined {
  const colon = text.indexOf(':');
  if (colon === -1) {
    // With no value, a feature holds for any value but its "none": for motion, that is `reduce`.
    if (text === 'prefers-reduced-motion') return { feature: text, value: 'reduce' };
    return range(text);
  }
  const name = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  const sized = /^(min-|max-)?(width|height)$/.exec(name);
  if (sized) {
    const points = length(value);
    if (points === undefined) return undefined;
    const op = sized[1] === 'min-' ? 'gte' : sized[1] === 'max-' ? 'lte' : 'eq';
    return { feature: sized[2] as 'width', op, value: points };
  }
  if (!KEYWORDS[name]?.includes(value)) return undefined;
  return { feature: name as 'orientation', value };
}

/** A part of a query between its `and`s or `or`s: a media type, or a feature in brackets. */
function part(text: string): MediaCondition | undefined {
  if (text.startsWith('(') && text.endsWith(')')) {
    const inside = text.slice(1, -1).trim();
    return inside.includes('(') ? undefined : feature(inside);
  }
  if (!/^[a-z-]+$/.test(text)) return undefined;
  // A type a device is not, `print` or `speech`, matches nothing, as it does in a browser.
  return text === 'all' || text === 'screen' ? ALWAYS : NEVER;
}

/** The parts of a query, each read, without those every window is. */
function joined(parts: readonly MediaCondition[], every: boolean): MediaCondition {
  // What every window is says nothing among the rest of an `and`, as what none is says nothing
  // among the rest of an `or`.
  const kept = parts.filter((each) => each !== (every ? ALWAYS : NEVER));
  if (!kept.length) return every ? ALWAYS : NEVER;
  if (kept.length === 1) return kept[0]!;
  return every ? { all: kept } : { any: kept };
}

/** One query of a list: nothing for one that cannot be read. */
function query(text: string): Query | undefined {
  let words = text.trim().replace(/\s+/g, ' ');
  const negated = /^not /.test(words);
  if (negated) words = words.slice(4);
  else words = words.replace(/^only /, '');
  if (!words) return undefined;
  // `and` and `or` side by side, with no brackets between, is no query: split at the `or`s, each
  // part with an `and` in it is read as none.
  const every = !words.includes(' or ');
  const parts = words.split(every ? ' and ' : ' or ').map((each) => part(each.trim()));
  if (parts.some((each) => each === undefined)) return undefined;
  const condition = joined(parts as MediaCondition[], every);
  return negated ? { not: condition } : condition;
}

/**
 * A media query list as each of its queries: an empty list is every window. `undefined` for a
 * query that cannot be read, which matches no window.
 */
export function readMedia(text: string): (Query | undefined)[] {
  const media = text.trim().toLowerCase();
  if (!media) return [ALWAYS];
  return media.split(',').map(query);
}

/**
 * A list as the condition a rule of a stylesheet is held to: `undefined` for a list that holds
 * everywhere, and `null` for one with a query in it that cannot be read, or one with `not`.
 */
export function mediaCondition(text: string): MediaCondition | null | undefined {
  const queries = readMedia(text);
  const read: MediaCondition[] = [];
  for (const each of queries) {
    if (each === undefined || 'not' in each) return null;
    read.push(each);
  }
  const condition = joined(read, false);
  return condition === ALWAYS ? undefined : condition;
}
