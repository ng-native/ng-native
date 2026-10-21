import { matchesGrammar, partsOf, serializeParts, type Part } from './css-grammar.ts';
import { INITIAL, LONGHANDS, SHORTHANDS, type Shorthand } from './css-properties.ts';
import { serializeValue } from './css-value.ts';
import { isOneColour, specifiedColour } from './specified-colour.ts';

/**
 * A shorthand's value read into the values of its longhands, and written back from them
 * (https://drafts.csswg.org/cssom/#serialize-a-css-value): `margin: 1px 2px` is four sides,
 * and four sides alike are `margin: 1px`. And a longhand's value in the form the CSSOM writes it.
 */

/** What a declaration waiting on a `var()` keeps: the shorthand, and the text it was given. */
export interface Declared {
  readonly value: string;
  readonly important: boolean;
  readonly from?: { readonly shorthand: string; readonly text: string };
}

export const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;

export type Values = Record<string, string>;

/** A longhand's value as the CSSOM writes it, where its grammar takes it, or nothing. */
export function longhandValue(
  name: string,
  text: string,
  grammar = LONGHANDS.get(name) ?? '',
): string | undefined {
  if (!grammar) return serializeValue(name, text);
  const parts = partsOf(text);
  if (!matchesGrammar(grammar, parts)) return undefined;
  const written = serializeValue(name, serializeParts(lengthened(grammar, parts)));
  if (isOneColour(parts)) return specifiedColour(parts[0]!, written);
  return SHORTENED[name]?.(written) ?? written;
}

/** A pair of repeats as the one word that says it: `repeat no-repeat` is `repeat-x`. */
function repeatText(pair: string): string {
  const [x, y] = pair.split(' ');
  if (y === undefined || x === y) return x!;
  if (x === 'repeat' && y === 'no-repeat') return 'repeat-x';
  return x === 'no-repeat' && y === 'repeat' ? 'repeat-y' : pair;
}

/** Longhands whose values have a shorter form a browser writes them in. */
const SHORTENED: Readonly<Record<string, (written: string) => string>> = {
  'background-repeat': (written) => written.split(', ').map(repeatText).join(', '),
};

/** A grammar that takes a length, by which a bare `0` is `0px`, and one that takes a number too. */
const LENGTHY =
  /<(nn-)?length|<radius>|<line-width>|<size>|<max-size>|<margin-width>|<inset-width>|<position-[xy]>|<bg-size>/;
const NUMBERY = /number|integer|<line-height-value>|<ratio>|<page-size>|<aspect-ratio-value>/;
const takesLengthOnly = (grammar: string): boolean =>
  LENGTHY.test(grammar) && !NUMBERY.test(grammar);

/** A part that is a bare `0`, as the length it is for a property that takes no number. */
function lengthened(grammar: string, parts: readonly Part[]): readonly Part[] {
  if (!takesLengthOnly(grammar)) return parts;
  return parts.map((part) =>
    part.token.type === 'number' && part.token.value === 0
      ? { token: { type: 'dimension', value: 0, integer: true, signed: false, unit: 'px' } }
      : part,
  );
}

/** A longhand's value of some parts, or nothing where it takes none of them. */
function valueOf(longhand: string, parts: readonly Part[]): string | undefined {
  if (!parts.length) return undefined;
  return longhandValue(longhand, serializeParts(parts));
}

/** Values for each of some longhands, each read from what it is given. */
function each(
  longhands: readonly string[],
  given: readonly (readonly Part[])[],
): Values | undefined {
  const out: Values = {};
  for (const [at, longhand] of longhands.entries()) {
    const value = valueOf(longhand, given[at]!);
    if (value === undefined) return undefined;
    out[longhand] = value;
  }
  return out;
}

/** One to four values, a side each, those left out the side across from them. */
function box(_: string, parts: readonly Part[], { longhands }: Shorthand): Values | undefined {
  if (!parts.length || parts.length > 4) return undefined;
  const [top, right = top, bottom = top, left = right] = parts.map((part) => [part]);
  return each(longhands, [top!, right!, bottom!, left!]);
}

/** One or two values, the second the first where it is left out. */
function pair(_: string, parts: readonly Part[], { longhands }: Shorthand): Values | undefined {
  const [first, second] = longhands as [string, string];
  const both = each(longhands, [parts, parts]);
  if (both) return both;
  for (let at = 1; at < parts.length; at++) {
    const read = each([first, second], [parts.slice(0, at), parts.slice(at)]);
    if (read) return read;
  }
  return undefined;
}

/** What reads a value of some parts for one slot of a shorthand, or nothing where it is none. */
type Slot = (parts: readonly Part[]) => string | undefined;

/**
 * Each part given to the slot it is a value of, in any order, each slot once at most: what
 * each is given, or nothing where some part is a value of none.
 */
function assignSlots(
  slots: Readonly<Record<string, Slot>>,
  parts: readonly Part[],
): Values | undefined {
  const found: Values = {};
  const names = Object.keys(slots);
  const walk = (from: number): boolean => {
    if (from === parts.length) return true;
    for (const name of names) {
      if (name in found) continue;
      for (let to = parts.length; to > from; to--) {
        const value = slots[name]!(parts.slice(from, to));
        if (value === undefined) continue;
        found[name] = value;
        if (walk(to)) return true;
        delete found[name];
      }
    }
    return false;
  };
  return parts.length && walk(0) ? found : undefined;
}

/** Each part given to the longhand it is a value of, in any order. */
const assign = (longhands: readonly string[], parts: readonly Part[]): Values | undefined =>
  assignSlots(
    Object.fromEntries(
      longhands.map((name) => [name, (some: readonly Part[]) => valueOf(name, some)]),
    ),
    parts,
  );

/** The longhands given a value, and the rest their initial values. */
function withInitial(longhands: readonly string[], given: Values): Values {
  return Object.fromEntries(
    longhands.map((name) => [name, given[name] ?? INITIAL[name] ?? 'initial']),
  );
}

function anyOrder(_: string, parts: readonly Part[], { longhands }: Shorthand): Values | undefined {
  const given = assign(longhands, parts);
  return given && withInitial(longhands, given);
}

export const EXPANDERS: Partial<
  Record<
    Shorthand['kind'],
    (name: string, parts: readonly Part[], shorthand: Shorthand) => Values | undefined
  >
> = { box, pair, 'any-order': anyOrder };

/** A side's width, style and colour, given to each side a shorthand is for. */
function sides(prefixes: readonly string[], parts: readonly Part[]): Values | undefined {
  const parts3 = ['width', 'style', 'color'];
  const given = assign(
    parts3.map((part) => `border-top-${part}`),
    parts,
  );
  if (!given) return undefined;
  const out: Values = {};
  for (const prefix of prefixes) {
    for (const part of parts3) {
      out[`${prefix}-${part}`] = given[`border-top-${part}`] ?? INITIAL[`border-top-${part}`]!;
    }
  }
  return out;
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/** `border-radius: 1px 2px / 3px`: each corner's two radii, a box of each. */
function radii(parts: readonly Part[]): Values | undefined {
  const slash = parts.findIndex((part) => part.token.type === 'delim' && part.token.value === '/');
  const across = slash < 0 ? parts : parts.slice(0, slash);
  const down = slash < 0 ? across : parts.slice(slash + 1);
  const corners = (some: readonly Part[]): (readonly Part[])[] | undefined => {
    if (!some.length || some.length > 4) return undefined;
    const [a, b = a, c = a, d = b] = some;
    return [a!, b!, c!, d!].map((part) => [part]);
  };
  const x = corners(across);
  const y = corners(down);
  if (!x || !y) return undefined;
  const out: Values = {};
  for (const [at, corner] of CORNERS.entries()) {
    const name = `border-${corner}-radius`;
    const value = valueOf(name, [
      ...x[at]!,
      ...(serializeParts(x[at]!) === serializeParts(y[at]!) ? [] : y[at]!),
    ]);
    if (value === undefined) return undefined;
    out[name] = value;
  }
  return out;
}

/** The keywords `flex` takes alone, each as the longhands' values it is. */
const FLEX_WORDS: Readonly<Record<string, Values>> = {
  none: { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' },
  auto: { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' },
};

/** One or two numbers, the factors of `flex`, as their values with a space between. */
function factors(parts: readonly Part[]): string | undefined {
  if (parts.length > 2 || parts.some((part) => part.token.type !== 'number')) return undefined;
  const read = parts.map((part) => valueOf('flex-grow', [part]));
  return read.includes(undefined) ? undefined : read.join(' ');
}

/** `flex: none`, `auto`, a number or two, and a basis, in either order. */
function flex(parts: readonly Part[]): Values | undefined {
  const [only] = parts;
  const word =
    parts.length === 1 && only?.token.type === 'ident' ? only.token.value.toLowerCase() : '';
  if (Object.hasOwn(FLEX_WORDS, word)) return { ...FLEX_WORDS[word] };
  const given = assignSlots({ factors, basis: (some) => valueOf('flex-basis', some) }, parts);
  if (!given) return undefined;
  const [grow = '1', shrink = '1'] = given['factors']?.split(' ') ?? [];
  // A basis left out is 0.
  return { 'flex-grow': grow, 'flex-shrink': shrink, 'flex-basis': given['basis'] ?? '0px' };
}

/** `list-style`, where a `none` is the image or the type, whichever is not given otherwise. */
function listStyle(parts: readonly Part[]): Values | undefined {
  const longhands = ['list-style-position', 'list-style-image', 'list-style-type'];
  const nones = parts.filter(
    (part) => part.token.type === 'ident' && part.token.value.toLowerCase() === 'none',
  );
  const rest = parts.filter((part) => !nones.includes(part));
  const given = rest.length ? assign(longhands, rest) : {};
  if (!given || nones.length > 2) return undefined;
  for (const _ of nones) {
    const slot = ['list-style-image', 'list-style-type'].find((name) => !(name in given));
    if (!slot) return undefined;
    given[slot] = 'none';
  }
  return withInitial(longhands, given);
}

/** A position's two values, across and down, as `background-position-x` and `-y` take them. */
export function positionOf(parts: readonly Part[]): [string, string] | undefined {
  const text = (some: readonly Part[]) => serializeParts(some);
  const word = (part: Part | undefined) =>
    part?.token.type === 'ident' ? part.token.value.toLowerCase() : undefined;
  const isX = (part: Part) => ['left', 'right'].includes(word(part) ?? '');
  const isY = (part: Part) => ['top', 'bottom'].includes(word(part) ?? '');
  if (!matchesGrammar('<bg-position>', parts)) return undefined;
  if (parts.length === 1) {
    const [only] = parts as [Part];
    return isY(only) ? ['center', text(parts)] : [text(parts), 'center'];
  }
  if (parts.length === 2) {
    const [a, b] = parts as [Part, Part];
    return isY(a) || isX(b) ? [text([b]), text([a])] : [text([a]), text([b])];
  }
  // Three or four: a keyword, and the offset after it where one is.
  const groups: Part[][] = [];
  for (const part of parts) {
    if (word(part) !== undefined) groups.push([part]);
    else groups.at(-1)?.push(part);
  }
  const [a, b] = groups as [Part[], Part[]];
  return isY(a[0]!) || isX(b[0]!) ? [text(b), text(a)] : [text(a), text(b)];
}

function backgroundPosition(parts: readonly Part[]): Values | undefined {
  const layers: Part[][] = [[]];
  for (const part of parts) {
    if (part.token.type === 'comma') layers.push([]);
    else layers.at(-1)!.push(part);
  }
  const read = layers.map(positionOf);
  if (read.includes(undefined)) return undefined;
  const all = read as [string, string][];
  return {
    'background-position-x': all.map(([x]) => x).join(', '),
    'background-position-y': all.map(([, y]) => y).join(', '),
  };
}

export const SYSTEM_FONTS =
  /^(caption|icon|menu|message-box|small-caption|status-bar|-webkit-[a-z-]+)$/i;

/** The longhands `font` sets as themselves, and those it only resets. */
const FONT_SET = ['font-style', 'font-variant-caps', 'font-weight', 'font-stretch'];

/** `font: italic bold 12px / 30px Georgia, serif`. */
function font(parts: readonly Part[]): Values | undefined {
  const slash = (part: Part | undefined) =>
    part?.token.type === 'delim' && part.token.value === '/';
  const given: Values = {};
  let at = 0;
  for (; at < parts.length && at < 4; at++) {
    const part = parts[at]!;
    if (part.token.type === 'ident' && part.token.value.toLowerCase() === 'normal') continue;
    const slot = FONT_SET.find((name) => !(name in given) && fontPrefix(name, part) !== undefined);
    if (!slot) break;
    given[slot] = fontPrefix(slot, part)!;
  }
  const size = valueOf('font-size', parts.slice(at, at + 1));
  if (size === undefined) return undefined;
  given['font-size'] = size;
  at++;
  if (slash(parts[at])) {
    const height = valueOf('line-height', parts.slice(at + 1, at + 2));
    if (height === undefined) return undefined;
    given['line-height'] = height;
    at += 2;
  }
  const family = valueOf('font-family', parts.slice(at));
  if (family === undefined) return undefined;
  given['font-family'] = family;
  return withInitial(SHORTHANDS.get('font')!.longhands, given);
}

/** A value of what comes before the size in `font`, which takes fewer of each than its longhand. */
function fontPrefix(name: string, part: Part): string | undefined {
  if (
    name === 'font-variant-caps' &&
    !(part.token.type === 'ident' && /^small-caps$/i.test(part.token.value))
  ) {
    return undefined;
  }
  if (name === 'font-stretch' && part.token.type !== 'ident') return undefined;
  return valueOf(name, [part]);
}

/** Each layer's longhand values of `background`, and what each is where a layer leaves it out. */
const LAYER: Readonly<Record<string, string>> = {
  'background-image': 'none',
  'background-position-x': '0%',
  'background-position-y': '0%',
  'background-size': 'auto',
  'background-repeat': 'repeat',
  'background-attachment': 'scroll',
  'background-origin': 'padding-box',
  'background-clip': 'border-box',
};

const isSlash = (part: Part | undefined): boolean =>
  part?.token.type === 'delim' && part.token.value === '/';

/** A layer's position, and its size after a `/`, as one value of three lines. */
function positionAndSize(parts: readonly Part[]): string | undefined {
  const slash = parts.findIndex(isSlash);
  const position = positionOf(slash < 0 ? parts : parts.slice(0, slash));
  if (!position) return undefined;
  const size = slash < 0 ? 'auto' : valueOf('background-size', parts.slice(slash + 1));
  return size === undefined ? undefined : [...position, size].join('\n');
}

const one =
  (grammar: string): Slot =>
  (parts) =>
    parts.length === 1 && matchesGrammar(grammar, parts) ? serializeParts(parts) : undefined;

/** What each part of a layer of `background` is read as: the last layer has the colour. */
const layerSlots = (last: boolean): Record<string, Slot> => ({
  image: one('none | <image>'),
  position: positionAndSize,
  repeat: (some) => valueOf('background-repeat', some),
  attachment: one('scroll | fixed | local'),
  origin: one('<box>'),
  clip: one('<bg-clip>'),
  ...(last ? { color: (some: readonly Part[]) => valueOf('background-color', some) } : {}),
});

/** One layer of `background`, each of its longhands' values. */
function layerOf(parts: readonly Part[], last: boolean): Values | undefined {
  const given = parts.length ? assignSlots(layerSlots(last), parts) : undefined;
  return given && layerValues(given, last);
}

/** A layer's origin and clip: one box is both, where it can be the origin. */
function boxesOf(given: Values): [string, string] {
  const clip = given['clip'];
  const origin = given['origin'] ?? (clip === undefined ? undefined : one('<box>')(partsOf(clip)));
  return [origin ?? 'padding-box', clip ?? origin ?? 'border-box'];
}

/** A layer's longhands' values, from what it was given, and the rest their initial values. */
function layerValues(given: Values, last: boolean): Values {
  const [x = '0%', y = '0%', size = 'auto'] = given['position']?.split('\n') ?? [];
  const [origin, clip] = boxesOf(given);
  const out: Values = {
    ...LAYER,
    'background-position-x': x,
    'background-position-y': y,
    'background-size': size,
    'background-origin': origin,
    'background-clip': clip,
  };
  const slots = {
    image: 'background-image',
    repeat: 'background-repeat',
    attachment: 'background-attachment',
  };
  for (const [slot, name] of Object.entries(slots)) if (given[slot]) out[name] = given[slot];
  if (last) out['background-color'] = given['color'] ?? 'transparent';
  return out;
}

/** A value's parts, split at each comma between them. */
function layersIn(parts: readonly Part[]): Part[][] {
  const layers: Part[][] = [[]];
  for (const part of parts) {
    if (part.token.type === 'comma') layers.push([]);
    else layers.at(-1)!.push(part);
  }
  return layers;
}

function background(parts: readonly Part[]): Values | undefined {
  const layers = layersIn(parts);
  const read = layers.map((layer, at) =>
    layer.length ? layerOf(layer, at === layers.length - 1) : undefined,
  );
  if (read.includes(undefined)) return undefined;
  const all = read as Values[];
  const out: Values = {};
  for (const name of Object.keys(LAYER)) out[name] = all.map((layer) => layer[name]).join(', ');
  out['background-color'] = all.at(-1)!['background-color']!;
  return out;
}

/** A list value's items, split at the commas between them, outside any brackets. */
const itemsOf = (value: string): string[] => layersIn(partsOf(value)).map(serializeParts);

/** `background` from its longhands: each layer, what it leaves at the initial value left out. */
function backgroundText(values: readonly string[], longhands: readonly string[]): string {
  const lists = Object.fromEntries(longhands.map((name, at) => [name, itemsOf(values[at]!)]));
  const count = lists['background-image']!.length;
  if (Object.keys(LAYER).some((name) => lists[name]!.length !== count)) return '';
  const colour = values[longhands.indexOf('background-color')]!;
  const layers = Array.from({ length: count }, (_, at) => {
    const said = layerText((name) => lists[name]![at]!);
    if (at === count - 1 && colour !== 'transparent') said.push(colour);
    return said.length ? said.join(' ') : 'none';
  });
  return layers.join(', ');
}

/** What a layer says that is not its longhands' initial values. */
function layerText(value: (name: string) => string): string[] {
  const said: string[] = [];
  if (value('background-image') !== 'none') said.push(value('background-image'));
  const [x, y, size] = ['background-position-x', 'background-position-y', 'background-size'].map(
    value,
  );
  if (x !== '0%' || y !== '0%' || size !== 'auto')
    said.push(`${x} ${y}${size === 'auto' ? '' : ` / ${size}`}`);
  for (const name of ['background-repeat', 'background-attachment']) {
    if (value(name) !== LAYER[name]) said.push(value(name));
  }
  const [origin, clip] = [value('background-origin'), value('background-clip')];
  if (origin !== 'padding-box' || clip !== 'border-box')
    said.push(origin === clip ? origin : `${origin} ${clip}`);
  return said;
}

/** A legacy shorthand's values, each by what its longhand says for it: `always` is `page`. */
const LEGACY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'page-break-after': {
    auto: 'auto',
    always: 'page',
    avoid: 'avoid',
    left: 'left',
    right: 'right',
  },
  'page-break-before': {
    auto: 'auto',
    always: 'page',
    avoid: 'avoid',
    left: 'left',
    right: 'right',
  },
  'page-break-inside': { auto: 'auto', avoid: 'avoid' },
  '-webkit-column-break-after': { auto: 'auto', always: 'column', avoid: 'avoid-column' },
  '-webkit-column-break-before': { auto: 'auto', always: 'column', avoid: 'avoid-column' },
  '-webkit-column-break-inside': { auto: 'auto', avoid: 'avoid-column' },
};

const legacyRead =
  (name: string) =>
  (parts: readonly Part[]): Values | undefined => {
    const [only] = parts;
    const word =
      parts.length === 1 && only?.token.type === 'ident' ? only.token.value.toLowerCase() : '';
    const value = Object.hasOwn(LEGACY[name]!, word) ? LEGACY[name]![word] : undefined;
    return value === undefined ? undefined : { [SHORTHANDS.get(name)!.longhands[0]!]: value };
  };

const legacyWrite =
  (name: string) =>
  ([value]: readonly string[]): string =>
    Object.entries(LEGACY[name]!).find(([, each]) => each === value)?.[0] ?? '';

/** `border-image`'s slice, and its width and outset after a `/` each, as one value of three lines. */
function sliceAndAfter(parts: readonly Part[]): string | undefined {
  const groups = layersIn(
    parts.map((part) => (isSlash(part) ? { token: { type: 'comma' } as const } : part)),
  );
  if (groups.length > 3) return undefined;
  const [slice = [], width, outset] = groups;
  const read = [
    valueOf('border-image-slice', slice),
    // `30 / / 1px` leaves the width out, and the outset is after it.
    width === undefined || (!width.length && outset) ? '1' : valueOf('border-image-width', width),
    outset === undefined ? '0' : valueOf('border-image-outset', outset),
  ];
  return read.includes(undefined) ? undefined : read.join('\n');
}

function borderImage(parts: readonly Part[]): Values | undefined {
  const given = assignSlots(
    {
      source: (some) => valueOf('border-image-source', some),
      slice: sliceAndAfter,
      repeat: (some) => valueOf('border-image-repeat', some),
    },
    parts,
  );
  if (!given) return undefined;
  const [slice = '100%', width = '1', outset = '0'] = given['slice']?.split('\n') ?? [];
  return {
    'border-image-source': given['source'] ?? 'none',
    'border-image-slice': slice,
    'border-image-width': width,
    'border-image-outset': outset,
    'border-image-repeat': given['repeat'] ?? 'stretch',
  };
}

function borderImageText([source, slice, width, outset, repeat]: readonly string[]): string {
  const said: string[] = [];
  if (source !== 'none') said.push(source!);
  const after = outset !== '0' ? ` / ${width} / ${outset}` : width !== '1' ? ` / ${width}` : '';
  if (slice !== '100%' || after) said.push(`${slice}${after}`);
  if (repeat !== 'stretch') said.push(repeat!);
  return said.length ? said.join(' ') : 'none';
}

export const CUSTOM: Readonly<Record<string, (parts: readonly Part[]) => Values | undefined>> = {
  border: (parts) => {
    const read = sides(
      SIDES.map((side) => `border-${side}`),
      parts,
    );
    return read && { ...read, ...withInitial(SHORTHANDS.get('border-image')!.longhands, {}) };
  },
  'border-block': (parts) => sides(['border-block-start', 'border-block-end'], parts),
  'border-inline': (parts) => sides(['border-inline-start', 'border-inline-end'], parts),
  'border-radius': radii,
  flex,
  'list-style': listStyle,
  'background-position': backgroundPosition,
  background,
  'border-image': borderImage,
  font,
  ...Object.fromEntries(Object.keys(LEGACY).map((name) => [name, legacyRead(name)])),
};

/** Whether a set of longhands is pending on what one shorthand was given, and that text. */
function pendingText(name: string, declared: readonly Declared[]): string | undefined {
  const [first] = declared;
  const text = first?.from?.shorthand === name ? first.from.text : undefined;
  return text !== undefined &&
    declared.every((each) => each.from?.text === text && each.from.shorthand === name)
    ? text
    : undefined;
}

/**
 * A shorthand's value, from its longhands' declarations, all of which are there and declared
 * alike: or `''` where they say nothing it can say.
 */
export function shorthandValue(name: string, declared: readonly Declared[]): string {
  const pending = pendingText(name, declared);
  if (pending !== undefined) return pending;
  if (declared.some((each) => each.from)) return '';
  const values = declared.map((each) => each.value);
  const wide = values.filter((value) => CSS_WIDE.test(value));
  if (wide.length)
    return wide.length === values.length && values.every((value) => value === values[0])
      ? values[0]!
      : '';
  const shorthand = SHORTHANDS.get(name)!;
  const write = WRITERS[name] ?? WRITERS[shorthand.kind];
  return write?.(values, shorthand.longhands) ?? '';
}

/** One to four sides as few values as say them. */
function sidesText(values: readonly string[]): string {
  const [top, right, bottom, left] = values;
  if (left !== right) return values.join(' ');
  if (bottom !== top) return `${top} ${right} ${bottom}`;
  return right !== top ? `${top} ${right}` : top!;
}

/** The values of longhands in any order, those at their initial value left out. */
function anyOrderText(values: readonly string[], longhands: readonly string[]): string {
  const said = values.filter((value, at) => value !== INITIAL[longhands[at]!]);
  if (said.length) return said.join(' ');
  const style = longhands.findIndex((name) => /style|line$/.test(name));
  return values[style < 0 ? 0 : style]!;
}

const WRITERS: Readonly<
  Record<string, (values: readonly string[], longhands: readonly string[]) => string>
> = {
  box: sidesText,
  pair: ([a, b]) => (a === b ? a! : `${a} ${b}`),
  'any-order': anyOrderText,
  border: (values, longhands) => {
    const [widths, styles, colours] = [0, 4, 8].map((at) => values.slice(at, at + 4));
    const same = (some: readonly string[]) => some.every((value) => value === some[0]);
    const image = values.slice(12).every((value, at) => value === INITIAL[longhands[12 + at]!]);
    if (!same(widths!) || !same(styles!) || !same(colours!) || !image) return '';
    return anyOrderText(
      [widths![0]!, styles![0]!, colours![0]!],
      longhands.slice(0, 12).filter((_, at) => at % 4 === 0),
    );
  },
  'border-block': (values, longhands) => endsText(values, longhands),
  'border-inline': (values, longhands) => endsText(values, longhands),
  'border-radius': (values) => {
    const split = values.map((value) => value.split(' '));
    const across = sidesText(split.map(([x]) => x!));
    const down = sidesText(split.map(([x, y = x]) => y!));
    return across === down ? across : `${across} / ${down}`;
  },
  flex: ([grow, shrink, basis]) =>
    grow === '0' && shrink === '0' && basis === 'auto' ? 'none' : `${grow} ${shrink} ${basis}`,
  'list-style': anyOrderText,
  'background-position': ([x, y]) => {
    const xs = x!.split(', ');
    const ys = y!.split(', ');
    return xs.length === ys.length ? xs.map((each, at) => `${each} ${ys[at]}`).join(', ') : '';
  },
  font: fontText,
  background: backgroundText,
  'border-image': borderImageText,
  ...Object.fromEntries(Object.keys(LEGACY).map((name) => [name, legacyWrite(name)])),
};

/** `border-block`'s two ends, where they are alike. */
function endsText(values: readonly string[], longhands: readonly string[]): string {
  const [w1, w2, s1, s2, c1, c2] = values;
  if (w1 !== w2 || s1 !== s2 || c1 !== c2) return '';
  return anyOrderText([w1!, s1!, c1!], [longhands[0]!, longhands[2]!, longhands[4]!]);
}

function fontText(values: readonly string[], longhands: readonly string[]): string {
  const value = (name: string) => values[longhands.indexOf(name)]!;
  const reset = longhands.filter(
    (name) => ![...FONT_SET, 'font-size', 'line-height', 'font-family'].includes(name),
  );
  if (reset.some((name) => value(name) !== INITIAL[name])) return '';
  if (!['normal', 'small-caps'].includes(value('font-variant-caps'))) return '';
  const before = FONT_SET.map(value).filter((each) => each !== 'normal');
  const height = value('line-height') === 'normal' ? '' : ` / ${value('line-height')}`;
  return [...before, `${value('font-size')}${height}`, value('font-family')].join(' ');
}
