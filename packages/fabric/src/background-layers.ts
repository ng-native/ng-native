import { parseColor } from './transition.ts';

/**
 * A `background` a token holds as text, where it is no single colour: the gradients a library
 * works out as the app runs and sets as a custom property, a colour slider's track or a colour
 * area's two fades over a colour. A stylesheet's gradient is compiled when the app is built; one
 * set on an element is read here, into what a view's `experimental_backgroundImage` takes.
 *
 * ponytail: `linear-gradient()` with a side or an angle and colour stops at percentages, which
 * is what such a library writes. A corner, a length or two positions on a stop, `radial-` and
 * `repeating-` are not read, and the whole background is then nothing, as an invalid one is.
 * Native has no conic gradient at all.
 */
export interface BackgroundLayers {
  readonly images: readonly object[];
  /** The colour under the images: the last layer, where it is one. */
  readonly color?: string;
  /**
   * Where each image goes, by the prop native has each part under; for a layer with no image,
   * where it says an image another rule declares goes: `center / cover`.
   */
  readonly placing?: readonly LayerPlacing[];
}

/** Where a layer goes when nothing says: each prop of `background` other than the image. */
export const BACKGROUND_PLACING: Readonly<Record<string, object>> = {
  experimental_backgroundPosition: { left: '0%', top: '0%' },
  experimental_backgroundSize: { x: 'auto', y: 'auto' },
  experimental_backgroundRepeat: { x: 'repeat', y: 'repeat' },
};

const SIDES: Readonly<Record<string, number>> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
};

/** Split at the commas that are not inside brackets. */
export function splitLayers(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

/**
 * Whether a term is a layer's colour: one native reads, or `currentColor`, the colour where the
 * token is used, which the node fills in.
 */
const isLayerColour = (term: string): boolean =>
  parseColor(term) !== null || /^currentcolor$/i.test(term);

const rgba = (text: string): string | undefined => {
  const parsed = parseColor(text);
  return parsed ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${parsed[3]})` : undefined;
};

/** A direction in degrees, or nothing for a first argument that is a colour stop. */
function direction(first: string): number | undefined {
  const side = SIDES[first.toLowerCase()];
  if (side !== undefined) return side;
  const angle = /^(-?[\d.]+)deg$/i.exec(first);
  return angle ? Number(angle[1]) : undefined;
}

/** `rgba(…) 40%` as a stop, or nothing for one this does not read. */
function stop(text: string): { color: string; position: string | null } | undefined {
  const placed = /^(.*\S)\s+(-?[\d.]+%)$/.exec(text);
  const color = rgba(placed ? placed[1]! : text);
  return color === undefined ? undefined : { color, position: placed ? placed[2]! : null };
}

function linear(layer: string): object | undefined {
  const inside = /^linear-gradient\((.*)\)$/is.exec(layer)?.[1];
  if (inside === undefined) return undefined;
  const parts = splitLayers(inside);
  const angle = direction(parts[0]!);
  const stops = (angle === undefined ? parts : parts.slice(1)).map(stop);
  if (stops.length < 2 || stops.some((each) => each === undefined)) return undefined;
  return {
    type: 'linear-gradient',
    direction: { type: 'angle', value: angle ?? 180 },
    colorStops: stops,
  };
}

/** The layers a background's text holds, or nothing where any of it is not read. */
export function backgroundLayers(text: string): BackgroundLayers | undefined {
  const layers = splitLayers(text.trim());
  const last = layers.at(-1)!;
  const color = isLayerColour(last) ? last : undefined;
  const images = (color === undefined ? layers : layers.slice(0, -1)).map(linear);
  if (!images.length || images.some((each) => each === undefined)) return undefined;
  return { images: images as object[], color };
}

const POSITION_WORD = /^(?:left|right|top|bottom|center)$/i;
/** A length or a percentage, as a position or a size takes one. A bare number only as 0. */
const LENGTH_PERCENTAGE =
  /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:%|px|r?em|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q)|[+-]?0|calc\(.*\))$/i;
const REPEAT_ONE = /^repeat-[xy]$/i;
const REPEAT_EACH = /^(?:repeat|space|round|no-repeat)$/i;
const ATTACHMENT = /^(?:scroll|fixed|local)$/i;
/** A box, the clip's and the origin's: `text` is a clip only, which the shorthand takes too. */
const BOX = /^(?:border-box|padding-box|content-box|text)$/i;
const SIZE_WORD = /^(?:cover|contain)$/i;

/** A layer's terms: split at the spaces outside brackets, with `/` a term of its own. */
function layerTerms(text: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let term = '';
  const end = () => {
    if (term) terms.push(term);
    term = '';
  };
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (depth === 0 && /[ \t\n\r\f]/.test(char)) end();
    else if (depth === 0 && char === '/') {
      end();
      terms.push('/');
    } else term += char;
  }
  end();
  return terms;
}

const axis = (word: string): string => {
  const lower = word.toLowerCase();
  if (lower === 'left' || lower === 'right') return 'x';
  return lower === 'center' ? 'center' : 'y';
};

const isWord = (term: string): boolean => POSITION_WORD.test(term);

/**
 * Two values: across then down, each a word of its axis or a length, or two words the other way
 * round, `top left`.
 */
function isPair(first: string, second: string): boolean {
  const across = !isWord(first) || axis(first) !== 'y';
  const down = !isWord(second) || axis(second) !== 'x';
  if (across && down) return true;
  return isWord(first) && isWord(second) && axis(first) !== 'x' && axis(second) !== 'y';
}

/** Three or four values: two words, each but `center` with a length after it or not, one an axis. */
function isGrouped(terms: readonly string[]): boolean {
  const groups: string[] = [];
  for (let at = 0; at < terms.length; at++) {
    const term = terms[at]!;
    if (!isWord(term)) return false;
    groups.push(axis(term));
    if (axis(term) !== 'center' && !isWord(terms[at + 1] ?? 'left')) at++;
  }
  return groups.length === 2 && (groups[0] !== groups[1] || groups[0] === 'center');
}

/** Whether terms are one `<bg-position>`. */
function isPosition(terms: readonly string[]): boolean {
  if (terms.length === 1) return true;
  return terms.length === 2 ? isPair(terms[0]!, terms[1]!) : isGrouped(terms);
}

/** Where the position starting at `from` ends, the longest run that is one; `from` for none. */
function positionEnd(terms: readonly string[], from: number): number {
  let run = from;
  const isTerm = (term: string) => POSITION_WORD.test(term) || LENGTH_PERCENTAGE.test(term);
  while (run < terms.length && run - from < 4 && isTerm(terms[run]!)) run++;
  for (; run > from; run--) if (isPosition(terms.slice(from, run))) return run;
  return from;
}

/** Where the size starting at `from` ends: `cover`, `contain`, or one or two lengths or `auto`. */
function sizeEnd(terms: readonly string[], from: number): number {
  if (SIZE_WORD.test(terms[from] ?? '')) return from + 1;
  let at = from;
  const isTerm = (term: string) => /^auto$/i.test(term) || LENGTH_PERCENTAGE.test(term);
  while (at < terms.length && at - from < 2 && isTerm(terms[at]!)) at++;
  return at;
}

/** Where a position and the size after it end, `at` for no position, or nothing for no size. */
function positionPart(terms: readonly string[], at: number): number | undefined {
  const placed = positionEnd(terms, at);
  if (placed === at || terms[placed] !== '/') return placed;
  const sized = sizeEnd(terms, placed + 1);
  return sized > placed + 1 ? sized : undefined;
}

/** The part of a layer the term at `at` starts, and where it ends; nothing for none. */
function layerPart(terms: readonly string[], at: number): readonly [string, number] | undefined {
  const term = terms[at]!;
  if (/^none$/i.test(term)) return ['image', at + 1];
  const placed = positionPart(terms, at);
  if (placed !== at) return placed === undefined ? undefined : ['position', placed];
  if (REPEAT_ONE.test(term)) return ['repeat', at + 1];
  if (REPEAT_EACH.test(term))
    return ['repeat', REPEAT_EACH.test(terms[at + 1] ?? '') ? at + 2 : at + 1];
  if (ATTACHMENT.test(term)) return ['attachment', at + 1];
  if (BOX.test(term)) return ['box', at + 1];
  return isLayerColour(term) ? ['color', at + 1] : undefined;
}

/**
 * A last layer with no image native draws, as a token holds it set on an element: `10% 20%`,
 * `center / cover`, `none no-repeat` or `left 10px top 20px red`, each part at most once, a box
 * twice, and the colour, if any, the colour under the layers. Nothing for text that is no such
 * layer, `none none` or `fixed scroll` say, which makes the whole background invalid.
 */
export function imagelessLayer(text: string): BackgroundLayers | undefined {
  const terms = layerTerms(text);
  const seen = new Map<string, number>();
  let color: string | undefined;
  for (let at = 0; at < terms.length;) {
    const found = layerPart(terms, at);
    if (!found) return undefined;
    const [part, next] = found;
    const times = (seen.get(part) ?? 0) + 1;
    if (times > (part === 'box' ? 2 : 1)) return undefined;
    seen.set(part, times);
    if (part === 'color') color = terms[at];
    at = next;
  }
  if (!terms.length) return undefined;
  return {
    images: [],
    ...(color === undefined ? {} : { color }),
    ...imagelessPlacing(terms, seen),
  };
}

/**
 * Where a layer with no image places an image another rule declares, where it says: read as
 * `placedLayer` reads a layer written out. Nothing where it says nothing, or is not read there.
 */
function imagelessPlacing(
  terms: readonly string[],
  seen: ReadonlyMap<string, number>,
): Pick<BackgroundLayers, 'placing'> {
  if (!seen.has('position') && !seen.has('repeat')) return {};
  const placing = placedLayer(terms, true)?.placing;
  return placing ? { placing: [placing] } : {};
}

/** One layer's position, size and repeat, by the prop native has each under. */
export type LayerPlacing = Readonly<Record<string, unknown>>;

/** The layers of a `background` written out, each image with its placing. */
export interface PlacedLayers extends BackgroundLayers {
  readonly placing: readonly LayerPlacing[];
}

const POSITION = 'experimental_backgroundPosition';
const SIZE = 'experimental_backgroundSize';
const REPEAT = 'experimental_backgroundRepeat';

/**
 * A length or a percentage as a stylesheet commits one: points as a number, a `rem` at 16, a
 * percentage as its text. Nothing for a unit read only once the box is known, `em` or `vw`.
 */
function placedLength(term: string): number | string | undefined {
  const found = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|%)?$/i.exec(term);
  if (!found) return undefined;
  const value = Number(found[1]) + 0;
  const unit = found[2]?.toLowerCase();
  if (unit === '%') return `${value}%`;
  if (unit === undefined) return value === 0 ? 0 : undefined;
  return unit === 'rem' ? value * 16 : value;
}

type Edge = readonly [word: string | undefined, offset: string | undefined];

/** One axis of a position: a side, `center`, or a length from the start side. */
function positionEdge(
  [word, offset]: Edge,
  start: string,
  end: string,
): Record<string, unknown> | undefined {
  const side = word?.toLowerCase();
  if (side === 'center') return { [start]: '50%' };
  const at = offset === undefined ? 0 : placedLength(offset);
  if (at === undefined) return undefined;
  return { [side === end ? end : start]: at };
}

/** The two axes of a position of one or two terms, across then down. */
function pairEdges(terms: readonly string[]): readonly [Edge, Edge] {
  const edge = (term: string): Edge => (isWord(term) ? [term, undefined] : [undefined, term]);
  const centre: Edge = ['center', undefined];
  const [first, second] = terms as readonly [string, string | undefined];
  if (second === undefined) {
    return isWord(first) && axis(first) === 'y' ? [centre, edge(first)] : [edge(first), centre];
  }
  const swapped = isWord(first) && isWord(second) && (axis(first) === 'y' || axis(second) === 'x');
  return swapped ? [edge(second), edge(first)] : [edge(first), edge(second)];
}

/** The two axes of a position of three or four terms: two sides, each with a length or not. */
function groupedEdges(terms: readonly string[]): readonly [Edge, Edge] {
  const groups: Edge[] = [];
  for (let at = 0; at < terms.length; at++) {
    const word = terms[at]!;
    const offset = isWord(terms[at + 1] ?? 'left') ? undefined : terms[++at];
    groups.push([word, offset]);
  }
  const across = groups.find(([word]) => axis(word!) === 'x');
  const down = groups.find(([word]) => axis(word!) === 'y');
  const centre = groups.find(([word]) => axis(word!) === 'center')!;
  return [across ?? centre, down ?? centre];
}

/** A `<bg-position>` as native's pair of edges, or nothing for one it does not read. */
function positionOf(terms: readonly string[]): LayerPlacing | undefined {
  if (!terms.length || !isPosition(terms)) return undefined;
  const [across, down] = terms.length <= 2 ? pairEdges(terms) : groupedEdges(terms);
  const x = positionEdge(across, 'left', 'right');
  const y = positionEdge(down, 'top', 'bottom');
  return x && y ? { ...x, ...y } : undefined;
}

/** A `<bg-size>`: `cover`, `contain`, or one or two sizes of zero or more, either `auto`. */
function sizeOf(terms: readonly string[]): unknown {
  if (terms.length === 1 && SIZE_WORD.test(terms[0]!)) return terms[0]!.toLowerCase();
  if (!terms.length || terms.length > 2) return undefined;
  const sizes = terms.map((term) => (/^auto$/i.test(term) ? 'auto' : placedLength(term)));
  const read = sizes.every(
    (size) => size === 'auto' || (size !== undefined && !String(size).startsWith('-')),
  );
  return read ? { x: sizes[0], y: sizes[1] ?? 'auto' } : undefined;
}

/** A `<repeat-style>`: `repeat-x`, `repeat-y`, or one word for both axes or one for each. */
function repeatOf(terms: readonly string[]): LayerPlacing | undefined {
  const words = terms.map((term) => term.toLowerCase());
  if (words.length === 1 && REPEAT_ONE.test(words[0]!)) {
    return words[0] === 'repeat-x'
      ? { x: 'repeat', y: 'no-repeat' }
      : { x: 'no-repeat', y: 'repeat' };
  }
  if (!words.length || words.length > 2 || !words.every((word) => REPEAT_EACH.test(word))) {
    return undefined;
  }
  return { x: words[0], y: words[1] ?? words[0] };
}

const PLACING_READERS: Readonly<Record<string, (terms: readonly string[]) => unknown>> = {
  [POSITION]: positionOf,
  [SIZE]: sizeOf,
  [REPEAT]: repeatOf,
};

/**
 * `background-position`, `background-size` or `background-repeat` set on an element, by the prop
 * native has it under, as the list of one a layer a stylesheet compiles it to. Nothing for a
 * value any layer of which is not read.
 */
export function placingList(prop: string, text: string): readonly unknown[] | undefined {
  const read = PLACING_READERS[prop]!;
  const list = splitLayers(text.trim()).map((layer) => read(layerTerms(layer)));
  return list.some((each) => each === undefined) ? undefined : list;
}

interface PlacedLayer {
  readonly image?: object;
  readonly placing: LayerPlacing;
  readonly color?: string;
}

/** The part of a layer the term at `at` starts, an image among them, and where it ends. */
function placedPart(terms: readonly string[], at: number): readonly [string, number] | undefined {
  const term = terms[at]!;
  const image = /^[a-z-]+\(/i.test(term) && !isLayerColour(term);
  return image ? ['image', at + 1] : layerPart(terms, at);
}

/** A layer as it is read, part by part. */
interface LayerRead {
  readonly placing: Record<string, unknown>;
  image?: object;
  color?: string;
}

/**
 * The part of a layer from `at` to `next` read into `layer`: its image, its colour, which only the
 * last layer has, or where it places the image. False for a part that is not read.
 */
function readPart(
  layer: LayerRead,
  part: string,
  terms: readonly string[],
  at: number,
  next: number,
  last: boolean,
): boolean {
  const term = terms[at]!;
  if (part === 'image') {
    if (/^none$/i.test(term)) return true;
    layer.image = linear(term);
    return layer.image !== undefined;
  }
  if (part === 'color') {
    layer.color = term;
    return last;
  }
  if (part === 'repeat') layer.placing[REPEAT] = repeatOf(terms.slice(at, next));
  if (part === 'position') {
    const slash = terms.indexOf('/', at);
    const end = slash < 0 || slash >= next ? next : slash;
    layer.placing[POSITION] = positionOf(terms.slice(at, end));
    if (end < next) layer.placing[SIZE] = sizeOf(terms.slice(end + 1, next));
  }
  return !Object.values(layer.placing).includes(undefined);
}

/**
 * One layer of a `background` written out, or nothing where a part of it is not read or comes
 * more often than once, a box twice.
 */
function placedLayer(terms: readonly string[], last: boolean): PlacedLayer | undefined {
  const layer: LayerRead = { placing: { ...BACKGROUND_PLACING } };
  const seen = new Map<string, number>();
  for (let at = 0; at < terms.length;) {
    const found = placedPart(terms, at);
    if (!found) return undefined;
    const [part, next] = found;
    const times = (seen.get(part) ?? 0) + 1;
    seen.set(part, times);
    if (times > (part === 'box' ? 2 : 1) || !readPart(layer, part, terms, at, next, last)) {
      return undefined;
    }
    at = next;
  }
  return terms.length ? layer : undefined;
}

/**
 * A `background` written out on an element: gradients, each with a position, a size and a repeat
 * or none, and the last layer's colour, as a stylesheet compiles the same text. A layer with no
 * image draws nothing, so its placing goes with it. An attachment and a box are read and left, as
 * a stylesheet leaves them. Nothing for text any part of which is not read.
 */
export function placedBackground(text: string): PlacedLayers | undefined {
  const layers = splitLayers(text.trim());
  const read = layers.map((layer, at) => placedLayer(layerTerms(layer), at === layers.length - 1));
  if (read.some((layer) => layer === undefined)) return undefined;
  const drawn = (read as PlacedLayer[]).filter((layer) => layer.image !== undefined);
  return {
    images: drawn.map((layer) => layer.image!),
    placing: drawn.map((layer) => layer.placing),
    color: read.at(-1)!.color,
  };
}
