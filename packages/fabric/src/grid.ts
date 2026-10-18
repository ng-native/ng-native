/**
 * CSS Grid, as a function from a container's style and its items to where each item goes.
 *
 * It follows CSS Grid Layout Level 1: placement (8.5), track sizing (11.3 to 11.8) and alignment
 * (10). It knows nothing about Yoga or a device. Whatever lays the items out says how big each
 * one's content is through `measure`, and gets back a rectangle for each against the container's
 * content box.
 *
 * Not here: named lines and areas, subgrid, baseline alignment (read as start), and
 * right-to-left columns.
 */

export type Style = Readonly<Record<string, string>>;

export interface GridItem {
  /** The item's style, with every shorthand spread over its sides. */
  readonly style: Style;
  /**
   * The item's border box with its content at its narrowest (`min`), at its widest (`max`), or
   * at a given width.
   */
  measure(width: 'min' | 'max' | number): { width: number; height: number };
  /**
   * How far under the item's top edge its baseline is, at a given width: the first line of its
   * text, or its bottom edge where it has none. Only how items differ is read, so it may be
   * counted from anywhere. Without it an item aligned to a baseline sits at the start.
   */
  baseline?(width: number): number;
  /**
   * The item's padding and border across and down: what no size takes its border box under, and
   * what a size is written without where its `box-sizing` is `content-box`.
   */
  readonly frame?: { readonly width: number; readonly height: number };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridLayout {
  /** The content box: what was available, or what the tracks came to where nothing was. */
  width: number;
  height: number;
  /** What the tracks and gaps come to, which is more than the box when they overflow. */
  usedWidth: number;
  usedHeight: number;
  /** A rectangle per item, against the content box. */
  items: Rect[];
  /**
   * The grid lines an out-of-flow child's placement names, as the edges of what it is placed
   * against: each a distance from the content box's left or top edge, and nothing where the
   * side is `auto`, or a line the grid has not got, which is the container's padding edge.
   */
  area(style: Style): Edges;
}

export interface Edges {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

type Breadth =
  | { kind: 'length'; px: number }
  | { kind: 'fr'; factor: number }
  | { kind: 'auto' | 'min-content' | 'max-content' }
  | { kind: 'fit-content'; limit: number };

interface Track {
  min: Breadth;
  max: Breadth;
  base: number;
  limit: number;
  /** A growth limit that was infinite until an item's min-content set it. */
  growable: boolean;
  /** An `auto-fit` track, which collapses when nothing is placed in it. */
  autoFit: boolean;
}

const AUTO: Breadth = { kind: 'auto' };
/** The most tracks a repeat makes and the furthest line an item names: a grid stays finite. */
const CAP = 1000;

const px = (value: string | undefined): number => Number.parseFloat(value ?? '') || 0;
const isAuto = (value: string | undefined) => value === undefined || value === 'auto';

/**
 * A length, or a percentage of `whole`, or nothing when it is `auto` or cannot be known yet. A
 * percentage may have points added, `50% + 20px`, as a content box's share has its frame.
 */
function length(value: string | undefined, whole: number | undefined): number | undefined {
  if (isAuto(value)) return undefined;
  const share = /^(-?[\d.]+)%(?: \+ (-?[\d.]+)px)?$/.exec(value!);
  if (share) return whole === undefined ? undefined : (px(share[1]) / 100) * whole + px(share[2]);
  return /^-?[\d.]+(px)?$/.test(value!) ? px(value) : undefined;
}

// Track lists

/** A track list's words and its `[line names]`, each kept together, as is a function's arguments. */
function tokens(list: string, separator = ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let word = '';
  for (const char of list) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      out.push(word);
      word = '';
    } else {
      word += char;
    }
  }
  out.push(word);
  return out.map((each) => each.trim()).filter(Boolean);
}

/** A track list's words, with its line names dropped. */
const words = (list: string, separator = ' '): string[] =>
  tokens(list, separator).filter((each) => !each.startsWith('['));

function breadth(word: string, whole: number | undefined): Breadth {
  if (word === 'min-content' || word === 'max-content') return { kind: word };
  if (word.endsWith('fr')) return { kind: 'fr', factor: px(word) };
  const size = length(word, whole);
  return size === undefined ? AUTO : { kind: 'length', px: size };
}

function track(word: string, whole: number | undefined, autoFit = false): Track {
  const args = /^([a-z-]+)\((.*)\)$/.exec(word);
  let min = breadth(word, whole);
  let max = min;
  if (args?.[1] === 'minmax') {
    const [low, high] = words(args[2]!, ',');
    min = breadth(low!, whole);
    max = breadth(high!, whole);
  } else if (args?.[1] === 'fit-content') {
    min = AUTO;
    max = { kind: 'fit-content', limit: length(args[2], whole) ?? Infinity };
  }
  // A flexible minimum is no minimum: the track is as small as its content allows.
  if (min.kind === 'fr') min = AUTO;
  return { min, max, base: 0, limit: 0, growable: false, autoFit };
}

/** What a track is sure to take: its fixed maximum, or failing that its fixed minimum. */
const fixedSize = (each: Track): number =>
  each.max.kind === 'length' ? each.max.px : each.min.kind === 'length' ? each.min.px : 0;

/** How many times an `auto-fill` or `auto-fit` list repeats in `whole` without overflowing. */
function repetitions(
  repeated: Track[],
  others: number,
  otherSize: number,
  whole: number | undefined,
  gap: number,
): number {
  if (whole === undefined) return 1;
  const size = repeated.reduce((sum, each) => sum + fixedSize(each), 0);
  let count = 1;
  const total = (n: number) => otherSize + n * size + (others + n * repeated.length - 1) * gap;
  while (count < CAP && total(count + 1) <= whole) count += 1;
  return count;
}

/** The lines a name is given to, each counted from the first explicit line, which is 0. */
type LineNames = Map<string, number[]>;

const nameLine = (names: LineNames, name: string, at: number) =>
  names.set(name, [...(names.get(name) ?? []), at]);

/** A track of a list, or the names written before one: `[a b]`. */
type Cell = Track | string[];
const cells = (list: string, whole: number | undefined, autoFit = false): Cell[] =>
  tokens(list).map((word) =>
    word.startsWith('[') ? words(word.slice(1, -1)) : track(word, whole, autoFit),
  );
const tracksOf = (all: Cell[]): Track[] =>
  all.filter((each): each is Track => !Array.isArray(each));

/** A `grid-template-columns` or `grid-template-rows` value as tracks, and the names of its lines. */
function template(
  list: string | undefined,
  whole: number | undefined,
  gap: number,
): { tracks: Track[]; names: LineNames } {
  const names: LineNames = new Map();
  const tracks: Track[] = [];
  if (!list || list === 'none') return { tracks, names };
  const parts = tokens(list).map((word) => {
    const repeat = /^repeat\(\s*([^,]+),(.*)\)$/.exec(word);
    if (!repeat) return { count: 1 as number | 'auto', cells: cells(word, whole) };
    const count = repeat[1]!.trim();
    const auto = count === 'auto-fill' || count === 'auto-fit';
    return {
      count: auto ? ('auto' as const) : Math.min(Number(count), CAP),
      cells: cells(repeat[2]!, whole, count === 'auto-fit'),
    };
  });
  const fixed = parts.filter((part) => part.count !== 'auto');
  const size = (part: (typeof parts)[number]) =>
    tracksOf(part.cells).reduce((sum, each) => sum + fixedSize(each), 0);
  const others = fixed.reduce(
    (sum, part) => sum + (part.count as number) * tracksOf(part.cells).length,
    0,
  );
  const otherSize = fixed.reduce((sum, part) => sum + (part.count as number) * size(part), 0);
  for (const part of parts) {
    const count =
      part.count === 'auto'
        ? repetitions(tracksOf(part.cells), others, otherSize, whole, gap)
        : part.count;
    for (let i = 0; i < count; i++) {
      for (const cell of part.cells) {
        if (Array.isArray(cell)) for (const name of cell) nameLine(names, name, tracks.length);
        else tracks.push({ ...cell });
      }
    }
  }
  return { tracks, names };
}

/**
 * `grid-template-areas`: how many tracks its rows of names make on each axis, and the lines
 * each area gives a name to, `head-start` and `head-end`, which is what an item is placed by.
 */
function templateAreas(text: string | undefined) {
  const columns: LineNames = new Map();
  const rows: LineNames = new Map();
  const grid = [...(text ?? '').matchAll(/(["'])(.*?)\1/g)].map((row) => words(row[2]!));
  const edges = new Map<string, { left: number; right: number; top: number; bottom: number }>();
  grid.forEach((row, y) =>
    row.forEach((name, x) => {
      if (name.startsWith('.')) return;
      const at = edges.get(name) ?? { left: x, right: x, top: y, bottom: y };
      edges.set(name, {
        left: Math.min(at.left, x),
        right: Math.max(at.right, x),
        top: Math.min(at.top, y),
        bottom: Math.max(at.bottom, y),
      });
    }),
  );
  for (const [name, at] of edges) {
    nameLine(columns, `${name}-start`, at.left);
    nameLine(columns, `${name}-end`, at.right + 1);
    nameLine(rows, `${name}-start`, at.top);
    nameLine(rows, `${name}-end`, at.bottom + 1);
  }
  return {
    columns,
    rows,
    across: Math.max(0, ...grid.map((row) => row.length)),
    down: grid.length,
  };
}

/** The names of a track list's lines and of the areas over it, as one. */
function allNames(lines: LineNames, areas: LineNames): LineNames {
  const out: LineNames = new Map(lines);
  for (const [name, at] of areas) out.set(name, [...(out.get(name) ?? []), ...at]);
  return out;
}

// Placement

interface Span {
  /** The first track, counted from the first explicit one, or nothing for auto placement. */
  start?: number;
  span: number;
}

interface Line {
  line?: number;
  span?: number;
}

/**
 * One side of a placement. A name is the line an area starts or ends at on that side, `head`
 * for `head-start`, or failing that a line of that name: the first, or the one counted to. A
 * name no line has is the first line past the `explicit` tracks, as every line out there has it.
 */
function line(
  value: string | undefined,
  names: LineNames,
  edge: 'start' | 'end',
  explicit: number,
): Line {
  const text = (value ?? 'auto').trim();
  const span = /^span\s+(\d+)$/.exec(text);
  if (span) return { span: Math.min(Number(span[1]), CAP) };
  if (/^-?\d+$/.test(text)) {
    return Number(text) === 0 ? {} : { line: Math.max(Math.min(Number(text), CAP), -CAP) };
  }
  const named = /^([A-Za-z_][\w-]*)(?:\s+(-?\d+))?$/.exec(text);
  if (!named || text === 'auto') return {};
  const at = namedLine(names, named[1]!, named[2], edge);
  if (at !== undefined) return { line: at + 1 };
  return { line: Number(named[2] ?? 1) > 0 ? explicit + 2 : -(explicit + 2) };
}

/** The line a name says: an area's edge on that side, or the line of that name counted to. */
function namedLine(names: LineNames, name: string, count: string | undefined, edge: string) {
  const lines = (count === undefined ? names.get(`${name}-${edge}`) : undefined) ?? names.get(name);
  const nth = Number(count ?? 1);
  return nth > 0 ? lines?.[nth - 1] : lines?.at(nth);
}

const isName = (value: string | undefined) => /^[A-Za-z_]/.test(value ?? '') && value !== 'auto';

/**
 * `grid-area` as its four sides, each `auto` unless written: a name alone is the area of that
 * name, so it stands for the sides left out too.
 */
function areaSides(style: Style) {
  const [rowStart, columnStart, rowEnd, columnEnd] = (style['grid-area'] ?? '')
    .split('/')
    .map((each) => each.trim() || undefined);
  const column = columnStart ?? (isName(rowStart) ? rowStart : undefined);
  return {
    row: [rowStart, rowEnd ?? (isName(rowStart) ? rowStart : undefined)],
    column: [column, columnEnd ?? (isName(column) ? column : undefined)],
  };
}

/** The two sides an item's `grid-column` or `grid-row` is written as, each with its longhand. */
function sides(style: Style, axis: 'column' | 'row'): [string | undefined, string | undefined] {
  const [first, second] = style[`grid-${axis}`]?.split('/') ?? areaSides(style)[axis];
  // One name is both sides of it, `content` for `content-start / content-end`.
  const both = isName(first?.trim()) ? first : undefined;
  return [style[`grid-${axis}-start`] ?? first, style[`grid-${axis}-end`] ?? second ?? both];
}

/** An item's `grid-column` or `grid-row`, and its `-start` and `-end`, as a span of tracks. */
function span(style: Style, axis: 'column' | 'row', explicit: number, names: LineNames): Span {
  const [first, last] = sides(style, axis);
  const start = line(first, names, 'start', explicit);
  const end = line(last, names, 'end', explicit);
  const index = (n: number) => (n > 0 ? n - 1 : explicit + 1 + n);
  if (start.line !== undefined && end.line !== undefined) {
    const [a, b] = [index(start.line), index(end.line)].sort((x, y) => x - y) as [number, number];
    return { start: a, span: Math.max(b - a, 1) };
  }
  if (start.line !== undefined) return { start: index(start.line), span: end.span ?? 1 };
  if (end.line !== undefined) {
    const size = start.span ?? 1;
    return { start: index(end.line) - size, span: size };
  }
  return { span: start.span ?? end.span ?? 1 };
}

/**
 * The tracks an out-of-flow child's placement names on one axis: the one its start line is
 * before and the one its end line is after, each nothing where it is `auto` or names no line
 * the grid has. A span is counted from the line on the other side, and is `auto` without one.
 */
function namedTracks(
  style: Style,
  axis: 'column' | 'row',
  grid: { explicit: number; before: number; count: number; names: LineNames },
): { start?: number; end?: number } {
  const [first, last] = sides(style, axis);
  const start = line(first, grid.names, 'start', grid.explicit);
  const end = line(last, grid.names, 'end', grid.explicit);
  const index = (n: number) => (n > 0 ? n - 1 : grid.explicit + 1 + n) + grid.before;
  let [from, to] = spanned(
    start.line === undefined ? undefined : index(start.line),
    end.line === undefined ? undefined : index(end.line),
    start.span,
    end.span,
  );
  // Written the wrong way round they are swapped, and the same line twice is only a start.
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  if (from === to) to = undefined;
  const known = (at: number | undefined) =>
    at !== undefined && at >= 0 && at <= grid.count ? at : undefined;
  return { start: known(from), end: known(to) };
}

/** Two lines, each counted from the other where it is a span and the other is a line. */
function spanned(
  from: number | undefined,
  to: number | undefined,
  before: number | undefined,
  after: number | undefined,
): [number | undefined, number | undefined] {
  if (from === undefined && to !== undefined && before) return [to - before, to];
  if (to === undefined && from !== undefined && after) return [from, from + after];
  return [from, to];
}

interface Placed {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

interface Placement {
  items: Placed[];
  columns: number;
  rows: number;
  /** Implicit tracks before the first explicit one. */
  before: { columns: number; rows: number };
}

/**
 * The auto-placement algorithm, along whichever axis the grid fills first. `minor` is the axis
 * with a fixed number of tracks, columns in a row flow, and `major` the one that grows.
 */
function autoPlace(
  spans: { major: Span; minor: Span }[],
  explicitMinor: number,
  dense: boolean,
): { major: number; minor: number }[] {
  let minorCount = Math.max(
    explicitMinor,
    1,
    ...spans.map(({ minor }) => (minor.start ?? 0) + minor.span),
  );
  const taken = new Set<string>();
  const free = (major: number, minor: number, each: { major: Span; minor: Span }) => {
    for (let i = major; i < major + each.major.span; i++) {
      for (let j = minor; j < minor + each.minor.span; j++)
        if (taken.has(`${i},${j}`)) return false;
    }
    return true;
  };
  const out: { major: number; minor: number }[] = [];
  const take = (index: number, major: number, minor: number) => {
    const each = spans[index]!;
    for (let i = major; i < major + each.major.span; i++) {
      for (let j = minor; j < minor + each.minor.span; j++) taken.add(`${i},${j}`);
    }
    minorCount = Math.max(minorCount, minor + each.minor.span);
    out[index] = { major, minor };
  };

  spans.forEach((each, i) => {
    if (each.major.start !== undefined && each.minor.start !== undefined) {
      take(i, each.major.start, each.minor.start);
    }
  });
  // Locked to a line of the major axis: the first room along it, after its earlier items.
  const along = new Map<number, number>();
  spans.forEach((each, i) => {
    if (each.major.start === undefined || each.minor.start !== undefined) return;
    let minor = dense ? 0 : (along.get(each.major.start) ?? 0);
    while (!free(each.major.start, minor, each)) minor += 1;
    along.set(each.major.start, minor + each.minor.span);
    take(i, each.major.start, minor);
  });
  const cursor = { major: 0, minor: 0 };
  spans.forEach((each, i) => {
    if (each.major.start !== undefined) return;
    if (dense) Object.assign(cursor, { major: 0, minor: 0 });
    if (each.minor.start !== undefined) {
      if (each.minor.start < cursor.minor) cursor.major += 1;
      cursor.minor = each.minor.start;
      while (!free(cursor.major, cursor.minor, each)) cursor.major += 1;
    } else {
      while (
        cursor.minor + each.minor.span > minorCount ||
        !free(cursor.major, cursor.minor, each)
      ) {
        cursor.minor += 1;
        if (cursor.minor + each.minor.span > minorCount) {
          cursor.major += 1;
          cursor.minor = 0;
        }
      }
    }
    take(i, cursor.major, cursor.minor);
  });
  return out;
}

function place(
  styles: Style[],
  container: Style,
  explicit: { columns: number; rows: number },
  names: { columns: LineNames; rows: LineNames },
): Placement {
  const flow = container['grid-auto-flow'] ?? 'row';
  const byColumn = flow.includes('column');
  const all = styles.map((style) => ({
    column: span(style, 'column', explicit.columns, names.columns),
    row: span(style, 'row', explicit.rows, names.rows),
  }));
  // A line before the first explicit one starts an implicit track there: count from it instead.
  const before = {
    columns: Math.max(0, ...all.map(({ column }) => -(column.start ?? 0))),
    rows: Math.max(0, ...all.map(({ row }) => -(row.start ?? 0))),
  };
  for (const each of all) {
    if (each.column.start !== undefined) each.column.start += before.columns;
    if (each.row.start !== undefined) each.row.start += before.rows;
  }
  const spans = all.map((each) =>
    byColumn ? { major: each.column, minor: each.row } : { major: each.row, minor: each.column },
  );
  const explicitMinor = byColumn ? explicit.rows + before.rows : explicit.columns + before.columns;
  const cells = autoPlace(spans, explicitMinor, flow.includes('dense'));
  const items = cells.map((cell, i) => ({
    column: byColumn ? cell.major : cell.minor,
    row: byColumn ? cell.minor : cell.major,
    columns: all[i]!.column.span,
    rows: all[i]!.row.span,
  }));
  return {
    items,
    before,
    columns: Math.max(explicit.columns + before.columns, ...items.map((i) => i.column + i.columns)),
    rows: Math.max(explicit.rows + before.rows, ...items.map((i) => i.row + i.rows)),
  };
}

/** The explicit tracks, with implicit ones from `grid-auto-*` before and after them. */
function withImplicit(
  explicit: Track[],
  auto: string | undefined,
  whole: number | undefined,
  before: number,
  count: number,
): Track[] {
  const pattern = words(auto ?? 'auto');
  const implicit = (index: number) => track(pattern.at(index % pattern.length)!, whole);
  const leading = Array.from({ length: before }, (_, i) => implicit(-(before - i)));
  const after = Math.max(count - before - explicit.length, 0);
  return [...leading, ...explicit, ...Array.from({ length: after }, (_, i) => implicit(i))];
}

// Track sizing

/** An item on one axis: the tracks it spans, and what its content asks of them. */
interface Contribution {
  start: number;
  span: number;
  /** Its size with its content at its narrowest, at its widest, and the least it will take. */
  min: number;
  max: number;
  minimum: number;
}

const intrinsic = (each: Breadth) => each.kind !== 'length' && each.kind !== 'fr';
const flexible = (each: Track) => each.max.kind === 'fr';
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function initialise(tracks: Track[]): void {
  for (const each of tracks) {
    each.base = each.min.kind === 'length' ? each.min.px : 0;
    each.limit = each.max.kind === 'length' ? Math.max(each.max.px, each.base) : Infinity;
    each.growable = false;
  }
}

/** An item in one track sets that track's size by itself. */
function sizeFromSingle(each: Track, item: Contribution): void {
  if (each.min.kind === 'min-content') each.base = Math.max(each.base, item.min);
  else if (each.min.kind === 'max-content') each.base = Math.max(each.base, item.max);
  else if (each.min.kind === 'auto') each.base = Math.max(each.base, item.minimum);
  const limit = each.limit === Infinity ? 0 : each.limit;
  if (each.max.kind === 'min-content') each.limit = Math.max(limit, item.min);
  else if (each.max.kind === 'fit-content') {
    each.limit = Math.max(limit, Math.min(item.max, Math.max(each.max.limit, item.minimum)));
  } else if (intrinsic(each.max)) each.limit = Math.max(limit, item.max);
  each.limit = Math.max(each.limit, each.base);
}

/**
 * Share `space` over `tracks`, each up to its `room`, an equal part at a time (11.5.1), and
 * answer how much each takes. What is left once all are full goes to `beyond`. Flexible tracks
 * share by their flex factors instead, when those come to something.
 */
function share(space: number, tracks: Track[], room: (each: Track) => number, beyond: Track[]) {
  const factors = tracks.every(flexible)
    ? tracks.map((each) => (each.max as { factor: number }).factor)
    : [];
  const weighted = sum(factors) > 0;
  const weight = (each: Track) => (weighted ? factors[tracks.indexOf(each)]! : 1);
  const taken = new Map<Track, number>(tracks.map((each) => [each, 0]));
  let open = tracks.filter((each) => room(each) > 0 && weight(each) > 0);
  let left = space;
  while (left > 1e-9 && open.length) {
    const whole = sum(open.map(weight));
    const parts = open.map((each) => (left * weight(each)) / whole);
    open.forEach((each, i) => {
      const take = Math.min(parts[i]!, room(each) - taken.get(each)!);
      taken.set(each, taken.get(each)! + take);
      left -= take;
    });
    open = open.filter((each) => room(each) - taken.get(each)! > 1e-9);
  }
  if (left > 1e-9 && beyond.length) {
    for (const each of beyond) taken.set(each, (taken.get(each) ?? 0) + left / beyond.length);
  }
  return taken;
}

interface Phase {
  /** Which tracks the items' space goes to. */
  affects: (each: Track) => boolean;
  /** Which size of the item has to fit. */
  size: (item: Contribution) => number;
  /** Growing base sizes, or growth limits. */
  target: 'base' | 'limit';
  /** Which tracks take what is left once every one is at its limit. */
  beyond: (each: Track) => boolean;
}

const PHASES: Phase[] = [
  {
    affects: (t) => intrinsic(t.min),
    size: (item) => item.minimum,
    target: 'base',
    beyond: (t) => intrinsic(t.max),
  },
  {
    affects: (t) => t.min.kind === 'min-content' || t.min.kind === 'max-content',
    size: (item) => item.min,
    target: 'base',
    beyond: (t) => t.max.kind === 'min-content' || t.max.kind === 'max-content',
  },
  {
    affects: (t) => t.min.kind === 'max-content',
    size: (item) => item.max,
    target: 'base',
    beyond: (t) => t.max.kind === 'max-content',
  },
  {
    affects: (t) => intrinsic(t.max),
    size: (item) => item.min,
    target: 'limit',
    beyond: () => true,
  },
  {
    affects: (t) => ['auto', 'max-content', 'fit-content'].includes(t.max.kind),
    size: (item) => item.max,
    target: 'limit',
    beyond: () => true,
  },
];

/** One phase of 11.5 for a group of items: grow the affected tracks to fit each item. */
function grow(
  tracks: Track[],
  items: Contribution[],
  gap: number,
  phase: Phase,
  only?: (t: Track) => boolean,
) {
  const planned = new Map<Track, number>();
  const current = (each: Track) =>
    phase.target === 'base' ? each.base : each.limit === Infinity ? each.base : each.limit;
  for (const item of items) {
    const spanned = tracks.slice(item.start, item.start + item.span);
    const affected = spanned.filter((each) => phase.affects(each) && (only?.(each) ?? true));
    if (!affected.length) continue;
    const space = phase.size(item) - sum(spanned.map(current)) - gap * (item.span - 1);
    if (space <= 0) continue;
    const room = (each: Track) => {
      if (phase.target === 'base') return each.limit - each.base;
      return each.limit === Infinity || each.growable ? Infinity : 0;
    };
    const beyond = affected.filter(phase.beyond);
    const taken = share(space, affected, room, beyond.length ? beyond : affected);
    for (const [each, amount] of taken) planned.set(each, Math.max(planned.get(each) ?? 0, amount));
  }
  for (const [each, amount] of planned) {
    if (phase.target === 'base') {
      each.base += amount;
    } else {
      each.growable = each.limit === Infinity;
      each.limit = (each.limit === Infinity ? each.base : each.limit) + amount;
    }
  }
}

function growAll(
  tracks: Track[],
  items: Contribution[],
  gap: number,
  only?: (t: Track) => boolean,
) {
  for (const phase of PHASES) {
    if (only && phase.target === 'limit') continue;
    grow(tracks, items, gap, phase, only);
    if (phase.target === 'base')
      for (const each of tracks) each.limit = Math.max(each.limit, each.base);
  }
}

/** 11.5: size each track to the items in it, the items in one track first. */
function resolveIntrinsic(tracks: Track[], items: Contribution[], gap: number): void {
  const crossesFlexible = (item: Contribution) =>
    tracks.slice(item.start, item.start + item.span).some(flexible);
  const rigid = items.filter((item) => !crossesFlexible(item));
  for (const item of rigid.filter((each) => each.span === 1))
    sizeFromSingle(tracks[item.start]!, item);
  const sizes = [...new Set(rigid.map((item) => item.span))]
    .filter((n) => n > 1)
    .sort((a, b) => a - b);
  for (const size of sizes) {
    growAll(
      tracks,
      rigid.filter((item) => item.span === size),
      gap,
    );
  }
  growAll(tracks, items.filter(crossesFlexible), gap, flexible);
  for (const each of tracks) {
    if (each.max.kind === 'fit-content') {
      each.limit = Math.min(each.limit, Math.max(each.max.limit, each.base));
    }
    if (each.limit === Infinity) each.limit = each.base;
  }
}

/** 11.7.1: the size of one `fr` that fills `space` over these tracks. */
function fraction(tracks: Track[], space: number): number {
  const rigid = new Set(tracks.filter((each) => !flexible(each)));
  for (;;) {
    const left = space - sum([...rigid].map((each) => each.base));
    const factors = sum(
      tracks
        .filter((each) => !rigid.has(each))
        .map((each) => (each.max as { factor: number }).factor),
    );
    const size = left / Math.max(factors, 1);
    const short = tracks.find(
      (each) => !rigid.has(each) && size * (each.max as { factor: number }).factor < each.base,
    );
    if (!short) return size;
    rigid.add(short);
  }
}

function expandFlexible(
  tracks: Track[],
  items: Contribution[],
  gap: number,
  available: number | undefined,
) {
  const flex = tracks.filter(flexible);
  if (!flex.length) return;
  const factor = (each: Track) => (each.max as { factor: number }).factor;
  const gaps = gap * (tracks.length - 1);
  let size: number;
  if (available !== undefined) {
    size = fraction(tracks, available - gaps);
  } else {
    size = Math.max(0, ...flex.map((each) => each.base / Math.max(factor(each), 1)));
    for (const item of items) {
      const spanned = tracks.slice(item.start, item.start + item.span);
      if (spanned.some(flexible)) {
        size = Math.max(size, fraction(spanned, item.max - gap * (item.span - 1)));
      }
    }
  }
  for (const each of flex) each.base = Math.max(each.base, size * factor(each));
}

/** Sizes on `tracks` for these items, in `available` room or in as much as the content wants. */
function sizeTracks(
  tracks: Track[],
  items: Contribution[],
  gap: number,
  available: number | undefined,
  stretch: boolean,
): void {
  initialise(tracks);
  resolveIntrinsic(tracks, items, gap);
  const free = () =>
    (available ?? Infinity) - sum(tracks.map((each) => each.base)) - gap * (tracks.length - 1);
  // 11.6: grow every track towards its growth limit with what is free.
  if (available === undefined) {
    for (const each of tracks) each.base = each.limit;
  } else if (free() > 0) {
    const taken = share(free(), tracks, (each) => each.limit - each.base, []);
    for (const [each, amount] of taken) each.base += amount;
  }
  expandFlexible(tracks, items, gap, available);
  // 11.8: `auto` tracks take what is still free.
  const autos = tracks.filter((each) => each.max.kind === 'auto');
  if (stretch && available !== undefined && free() > 0 && autos.length) {
    const part = free() / autos.length;
    for (const each of autos) each.base += part;
  }
}

// Alignment

/** The last word of an alignment value, with `flex-` and `self-` read as the plain keyword. */
function alignment(value: string | undefined, fallback: string): string {
  const word = (value ?? fallback)
    .trim()
    .split(/\s+/)
    .at(-1)!
    .replace(/^(flex|self)-/, '');
  return word === 'normal' || word === 'auto' ? fallback : word;
}

/** `safe` keeps what overflows at the start, where it can still be scrolled to. */
const isSafe = (value: string | undefined) => /^\s*safe\b/.test(value ?? '');

/** What is free around and between `count` tracks, for a content-distribution keyword. */
function distribute(
  align: string,
  free: number,
  count: number,
): { offset: number; between: number } {
  if (align === 'end') return { offset: free, between: 0 };
  if (align === 'center') return { offset: free / 2, between: 0 };
  if (free <= 0 || !count) return { offset: 0, between: 0 };
  if (align === 'space-between' && count > 1) return { offset: 0, between: free / (count - 1) };
  if (align === 'space-around') return { offset: free / count / 2, between: free / count };
  if (align === 'space-evenly') return { offset: free / (count + 1), between: free / (count + 1) };
  return { offset: 0, between: 0 };
}

/** Where each track starts, with what is free shared out as `justify-content` or `align-content` say. */
function positions(
  tracks: Track[],
  gap: number,
  available: number | undefined,
  value: string | undefined,
) {
  const live = tracks.filter((each) => !each.collapsed);
  const used = sum(live.map((each) => each.base)) + gap * Math.max(live.length - 1, 0);
  const free = available === undefined ? 0 : available - used;
  const align = isSafe(value) && free < 0 ? 'start' : alignment(value, 'start');
  const { offset, between } = distribute(align, free, live.length);
  const starts: number[] = [];
  let at = offset;
  for (const each of tracks) {
    starts.push(at);
    if (!each.collapsed) at += each.base + gap + between;
  }
  return { starts, used, between };
}

interface Track {
  collapsed?: boolean;
}

/** An `auto-fit` track nothing is placed in takes no room, and neither does its gap. */
function collapseEmpty(tracks: Track[], items: { start: number; span: number }[]): void {
  tracks.forEach((each, i) => {
    each.collapsed =
      each.autoFit && !items.some((item) => item.start <= i && i < item.start + item.span);
    if (each.collapsed)
      Object.assign(each, { min: { kind: 'length', px: 0 }, max: { kind: 'length', px: 0 } });
  });
}

/** How far into its room an item starts: pushed by an `auto` margin, or by its alignment. */
function leading(
  free: number,
  self: { align: string; safe: boolean },
  autoStart: boolean,
  autoEnd: boolean,
) {
  if (autoStart) return Math.max(free, 0) / (autoEnd ? 2 : 1);
  if (autoEnd || (self.safe && free < 0)) return 0;
  if (self.align === 'end') return free;
  return self.align === 'center' ? free / 2 : 0;
}

/** One axis of an item in its area: its size, and where its border box starts. */
function inArea(
  style: Style,
  axis: { size: string; start: string; end: string },
  area: { start: number; size: number; inline: number },
  self: { align: string; safe: boolean },
  natural: (room: number) => number,
): { start: number; size: number } {
  const marginStart = style[`margin-${axis.start}`];
  const marginEnd = style[`margin-${axis.end}`];
  // A percentage margin is of the area's width, on either axis.
  const before = length(marginStart, area.inline) ?? 0;
  const margins = before + (length(marginEnd, area.inline) ?? 0);
  const autoMargin = marginStart === 'auto' || marginEnd === 'auto';
  const room = area.size - margins;
  let size = length(style[axis.size], area.size);
  if (size === undefined) size = self.align === 'stretch' && !autoMargin ? room : natural(room);
  size = Math.min(size, length(style[`max-${axis.size}`], area.size) ?? Infinity);
  size = Math.max(size, length(style[`min-${axis.size}`], area.size) ?? 0, 0);
  const lead = leading(room - size, self, marginStart === 'auto', marginEnd === 'auto');
  return { start: area.start + before + lead, size };
}

// The whole grid

const X = { size: 'width', start: 'left', end: 'right' };
const Y = { size: 'height', start: 'top', end: 'bottom' };

/**
 * What an item's content asks of the tracks on one axis, margins included. A percentage margin
 * is of the width of the item's area, which `inline` is once the columns are sized: down the
 * rows. Across the columns it is not known yet, and is none.
 */
function contribution(
  style: Style,
  axis: typeof X,
  at: { start: number; span: number },
  content: { min: () => number; max: () => number },
  inline?: number,
): Contribution {
  const fixed = length(style[axis.size], undefined);
  const low = length(style[`min-${axis.size}`], undefined);
  const high = length(style[`max-${axis.size}`], undefined) ?? Infinity;
  // The content is measured only when a track asks for it, and never for a size already set.
  const clamp = (value: () => number) => Math.max(Math.min(fixed ?? value(), high), low ?? 0);
  const margins =
    (length(style[`margin-${axis.start}`], inline) ?? 0) +
    (length(style[`margin-${axis.end}`], inline) ?? 0);
  // The least it can be: its own size where it has one, and otherwise its minimum, which is 0
  // and not `auto` for a view (as `@ng-native/web`'s reset makes it in a browser), so an item
  // with no size of its own is never held to its content's.
  const minimum = fixed === undefined ? Math.min(low ?? 0, high) : clamp(() => fixed);
  return {
    ...at,
    get min() {
      return clamp(content.min) + margins;
    },
    get max() {
      return clamp(content.max) + margins;
    },
    minimum: minimum + margins,
  };
}

/**
 * How far down each item aligned to a baseline is moved so that the baselines of those that
 * start in one row line up: under the one whose baseline is furthest down. The move is added to
 * the item's top margin, so its row is as tall as the moved items need.
 *
 * ponytail: `last baseline` sits at the start, and so does an item with a percentage or `auto`
 * top margin. An item spanning rows is aligned in the row it starts in.
 */
function baselineShifts(
  container: Style,
  items: readonly GridItem[],
  rows: readonly { start: number }[],
  widthOf: (index: number) => number,
): number[] {
  const groups = new Map<number, number[]>();
  items.forEach((item, i) => {
    const own = item.style['align-self'];
    const value = isAuto(own) || own === 'normal' ? container['align-items'] : own;
    const margin = item.style['margin-top'];
    if (!item.baseline || !/^(first\s+)?baseline$/.test(value?.trim() ?? '')) return;
    if (margin !== undefined && length(margin, undefined) === undefined) return;
    groups.set(rows[i]!.start, [...(groups.get(rows[i]!.start) ?? []), i]);
  });
  const shifts = items.map(() => 0);
  for (const group of groups.values()) {
    const above = group.map(
      (i) => px(items[i]!.style['margin-top']) + items[i]!.baseline!(widthOf(i)),
    );
    const lowest = Math.max(...above);
    group.forEach((i, at) => (shifts[i] = lowest - above[at]!));
  }
  return shifts;
}

/** `aspect-ratio` as width over height: `2`, or `16 / 9`. Nothing for `auto` or none. */
function ratioOf(value: string | undefined): number | undefined {
  const [width, height = '1'] = (value ?? '').split('/').map((each) => Number.parseFloat(each));
  const ratio = Number(width) / Number(height);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

/** The width an item's ratio and its own height make, where it has that height and no width. */
function ratioWidth(style: Style): number | undefined {
  const ratio = ratioOf(style['aspect-ratio']);
  const height = length(style['height'], undefined);
  return ratio && height !== undefined && isAuto(style['width']) ? height * ratio : undefined;
}

/**
 * An item with every size in its style that of its border box, as the layout reads them: one
 * written of its content has its padding and border added, and the least it may be is no less
 * than those, as a box with `min-width: 0` is in a browser.
 * A percentage of the content box is the share of the area with the frame added: see `length`.
 */
function asBorderBox(item: GridItem): GridItem {
  const frame = item.frame;
  if (!frame || (!frame.width && !frame.height)) return item;
  const style: Record<string, string> = { ...item.style };
  const content = style['box-sizing'] === 'content-box';
  framed(style, 'width', frame.width, content);
  framed(style, 'height', frame.height, content);
  return { ...item, style };
}

/** One axis of `asBorderBox`: `add` is the item's padding and border along it. */
function framed(style: Record<string, string>, axis: string, add: number, content: boolean): void {
  const least = style[`min-${axis}`];
  // A share of the area is known once the area is: a floor is left to the frame added to it.
  if (least === undefined || !least.endsWith('%')) {
    const own = length(least, undefined) ?? 0;
    style[`min-${axis}`] = `${Math.max(content ? own + add : own, add)}px`;
  }
  for (const key of [axis, `max-${axis}`, ...(least?.endsWith('%') ? [`min-${axis}`] : [])]) {
    const value = style[key];
    if (!content || value === undefined) continue;
    if (value.endsWith('%')) style[key] = `${value} + ${add}px`;
    else {
      const points = length(value, undefined);
      if (points !== undefined) style[key] = `${points + add}px`;
    }
  }
}

function gapOf(style: Style, axis: 'row' | 'column', whole: number | undefined): number {
  const [row, column = row] = (style['gap'] ?? '').split(/\s+/);
  return length(style[`${axis}-gap`] ?? (axis === 'row' ? row : column), whole) ?? 0;
}

const usesPercent = (style: Style, axis: 'row' | 'column') =>
  [`grid-template-${axis}s`, `grid-auto-${axis}s`, `${axis}-gap`, 'gap'].some((property) =>
    style[property]?.includes('%'),
  );

function solve(
  style: Style,
  given: readonly GridItem[],
  width?: number,
  height?: number,
): GridLayout {
  // An item with a ratio and a height of its own is as wide as the two make it.
  const items = given.map(asBorderBox).map((item) => {
    const wide = ratioWidth(item.style);
    return wide === undefined ? item : { ...item, style: { ...item.style, width: `${wide}px` } };
  });
  const columnGap = gapOf(style, 'column', width);
  const rowGap = gapOf(style, 'row', height);
  const listedColumns = template(style['grid-template-columns'], width, columnGap);
  const listedRows = template(style['grid-template-rows'], height, rowGap);
  const explicitColumns = listedColumns.tracks;
  const explicitRows = listedRows.tracks;
  // Areas make tracks of their own where the lists have fewer, sized as implicit ones are.
  const areas = templateAreas(style['grid-template-areas']);
  const explicit = {
    columns: Math.max(explicitColumns.length, areas.across),
    rows: Math.max(explicitRows.length, areas.down),
  };
  const names = {
    columns: allNames(listedColumns.names, areas.columns),
    rows: allNames(listedRows.names, areas.rows),
  };
  const placement = place(
    items.map((item) => item.style),
    style,
    explicit,
    names,
  );
  const { before } = placement;
  const columns = withImplicit(
    explicitColumns,
    style['grid-auto-columns'],
    width,
    before.columns,
    placement.columns,
  );
  const rows = withImplicit(
    explicitRows,
    style['grid-auto-rows'],
    height,
    before.rows,
    placement.rows,
  );
  const across = placement.items.map((each) => ({ start: each.column, span: each.columns }));
  const down = placement.items.map((each) => ({ start: each.row, span: each.rows }));
  collapseEmpty(columns, across);
  collapseEmpty(rows, down);

  const justifyContent = alignment(style['justify-content'], 'stretch');
  sizeTracks(
    columns,
    items.map((item, i) =>
      contribution(item.style, X, across[i]!, {
        min: () => item.measure('min').width,
        max: () => item.measure('max').width,
      }),
    ),
    columnGap,
    width,
    justifyContent === 'stretch',
  );
  const x = positions(columns, columnGap, width, style['justify-content']);
  const area = (
    starts: number[],
    tracks: Track[],
    at: { start: number; span: number },
    gap: number,
  ) => {
    const live = tracks.slice(at.start, at.start + at.span).filter((each) => !each.collapsed);
    return {
      start: starts[at.start]!,
      size: sum(live.map((each) => each.base)) + gap * Math.max(live.length - 1, 0),
    };
  };
  const selfAlign = (item: GridItem, axis: 'justify' | 'align') => {
    const value = item.style[`${axis}-self`];
    const own = isAuto(value) || value === 'normal' ? style[`${axis}-items`] : value;
    return { align: alignment(own, 'stretch'), safe: isSafe(own) };
  };
  const columnAreas = items.map((_, i) =>
    area(x.starts, columns, across[i]!, columnGap + x.between),
  );
  const horizontal = items.map((item, i) =>
    inArea(
      item.style,
      X,
      { ...columnAreas[i]!, inline: columnAreas[i]!.size },
      selfAlign(item, 'justify'),
      (room) => Math.min(item.measure('max').width, Math.max(item.measure('min').width, room)),
    ),
  );

  // An item with a ratio and no height of its own is as tall as its width makes it, and is not
  // stretched: held to a minimum or a maximum height, its width follows where it had none.
  const tall = items.map((item, i) => {
    const ratio = ratioOf(item.style['aspect-ratio']);
    if (!ratio || !isAuto(item.style['height'])) return undefined;
    const wanted = horizontal[i]!.size / ratio;
    const height = Math.max(
      Math.min(wanted, length(item.style['max-height'], undefined) ?? Infinity),
      length(item.style['min-height'], undefined) ?? 0,
    );
    if (height !== wanted && isAuto(item.style['width'])) horizontal[i]!.size = height * ratio;
    return height;
  });
  const lifted = baselineShifts(style, items, down, (i) => horizontal[i]!.size);
  const upright = items.map((item, i) => ({
    ...item.style,
    ...(tall[i] === undefined ? {} : { height: `${tall[i]}px` }),
    ...(lifted[i] ? { 'margin-top': `${px(item.style['margin-top']) + lifted[i]!}px` } : {}),
  }));
  const heights = items.map((item, i) => () => tall[i] ?? item.measure(horizontal[i]!.size).height);
  sizeTracks(
    rows,
    items.map((_, i) =>
      contribution(
        upright[i]!,
        Y,
        down[i]!,
        { min: heights[i]!, max: heights[i]! },
        columnAreas[i]!.size,
      ),
    ),
    rowGap,
    height,
    alignment(style['align-content'], 'stretch') === 'stretch',
  );
  const y = positions(rows, rowGap, height, style['align-content']);
  const vertical = items.map((item, i) =>
    inArea(
      upright[i]!,
      Y,
      { ...area(y.starts, rows, down[i]!, rowGap + y.between), inline: columnAreas[i]!.size },
      selfAlign(item, 'align'),
      heights[i]!,
    ),
  );
  /** Where a line is: the start of the track after it, or the end of the one before it. */
  const edge = (
    starts: number[],
    tracks: Track[],
    at: number | undefined,
    side: 'start' | 'end',
  ) => {
    if (at === undefined) return undefined;
    if (side === 'start' && at < tracks.length) return starts[at]!;
    const last = tracks[at - 1];
    // A grid with no tracks still has its first line, at the content box's edge.
    return last ? starts[at - 1]! + (last.collapsed ? 0 : last.base) : 0;
  };
  return {
    width: width ?? x.used,
    height: height ?? y.used,
    usedWidth: x.used,
    usedHeight: y.used,
    items: items.map((_, i) => ({
      left: horizontal[i]!.start,
      top: vertical[i]!.start,
      width: horizontal[i]!.size,
      height: vertical[i]!.size,
    })),
    area(child) {
      const across = namedTracks(child, 'column', {
        explicit: explicit.columns,
        before: before.columns,
        count: columns.length,
        names: names.columns,
      });
      const down = namedTracks(child, 'row', {
        explicit: explicit.rows,
        before: before.rows,
        count: rows.length,
        names: names.rows,
      });
      return {
        left: edge(x.starts, columns, across.start, 'start'),
        right: edge(x.starts, columns, across.end, 'end'),
        top: edge(y.starts, rows, down.start, 'start'),
        bottom: edge(y.starts, rows, down.end, 'end'),
      };
    },
  };
}

/**
 * Lay a grid out in a content box of `width` by `height`. A side left out is as big as the tracks
 * come to, and a percentage along it is of that size, resolved by a second pass.
 */
export function layOutGrid(
  style: Style,
  items: readonly GridItem[],
  available: { width?: number; height?: number } = {},
): GridLayout {
  if (style['direction'] !== 'rtl') return leftToRight(style, items, available);
  // Right to left is left to right in a mirror: swap each item's sides, and flip what comes out.
  const flip = (value: string | undefined) =>
    value?.replace(/\b(left|right)\b/, (side) => (side === 'left' ? 'right' : 'left'));
  const mirrored = items.map((item) => ({
    ...item,
    style: Object.fromEntries(
      Object.entries(item.style).map(([property, value]) => [flip(property)!, value]),
    ),
  }));
  const layout = leftToRight(style, mirrored, available);
  for (const rect of layout.items) rect.left = layout.width - rect.left - rect.width;
  const mirror = (at: number | undefined) => (at === undefined ? undefined : layout.width - at);
  return {
    ...layout,
    area(child) {
      const { left, right, top, bottom } = layout.area(child);
      return { left: mirror(right), right: mirror(left), top, bottom };
    },
  };
}

function leftToRight(
  style: Style,
  items: readonly GridItem[],
  available: { width?: number; height?: number },
): GridLayout {
  const first = solve(style, items, available.width, available.height);
  const again = {
    width: available.width ?? (usesPercent(style, 'column') ? first.width : undefined),
    height: available.height ?? (usesPercent(style, 'row') ? first.height : undefined),
  };
  if (again.width === available.width && again.height === available.height) return first;
  return solve(style, items, again.width, again.height);
}
