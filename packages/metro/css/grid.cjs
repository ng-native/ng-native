/**
 * Grid declarations, written as the text the engine's grid layout parses (`grid.ts` in fabric).
 *
 * Yoga has no grid, so nothing here is a React Native style: a track list or a placement is kept
 * as CSS, with each length in points, and the engine reads it when it lays the container out.
 */
const { CssUnsupported, round } = require('./values.cjs');

/** Points per unit, for the units a track can be written in without knowing the element. */
const POINTS = { px: 1, rem: 16, pt: 4 / 3, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

function trackLength(value, context) {
  if (value?.type === 'percentage') return `${round(value.value * 100)}%`;
  if (value?.type === 'dimension' && value.value.unit in POINTS) {
    return `${round(value.value.value * POINTS[value.value.unit])}px`;
  }
  if (value?.value?.unit === '__unitless') {
    throw new CssUnsupported(`${context}: a track size needs a unit; only 0 may go without one`);
  }
  throw new CssUnsupported(
    `${context}: a track is sized in points, rem, a percentage, fr or a keyword; this length needs the element it is on`,
  );
}

function breadth(value, context) {
  if (value.type === 'length') return trackLength(value.value, context);
  if (value.type === 'flex') return `${round(value.value)}fr`;
  if (['auto', 'min-content', 'max-content'].includes(value.type)) return value.type;
  throw new CssUnsupported(`${context}: '${value.type}' is not a track size the engine lays out`);
}

function trackSize(value, context) {
  if (value.type === 'track-breadth') return breadth(value.value, context);
  if (value.type === 'min-max') {
    return `minmax(${breadth(value.min, context)}, ${breadth(value.max, context)})`;
  }
  if (value.type === 'fit-content') return `fit-content(${trackLength(value.value, context)})`;
  throw new CssUnsupported(`${context}: '${value.type}' is not a track size the engine lays out`);
}

/** Track sizes with the names of the lines around them: `[a b] 1fr [c]`. */
function named(sizes, lineNames) {
  const names = (at) => (lineNames?.[at]?.length ? [`[${lineNames[at].join(' ')}]`] : []);
  return [...sizes.flatMap((size, at) => [...names(at), size]), ...names(sizes.length)].join(' ');
}

/** A size an `auto-fill` or `auto-fit` repeat can count with: a length on one side at least. */
const fixedSize = (value) =>
  value.type === 'track-breadth'
    ? value.value.type === 'length'
    : value.type === 'min-max' && (value.min.type === 'length' || value.max.type === 'length');

/**
 * A list with an `auto-fill` or `auto-fit` repeat has one, and every track in it and beside it
 * has a length on one side at least: there is no counting how many repeats fit otherwise, and a
 * browser drops the declaration.
 */
function fixedBesideAutoRepeat(items, context) {
  const auto = items.filter(
    (item) => item.type !== 'track-size' && item.value.count.type !== 'number',
  );
  if (!auto.length) return;
  const sizes = items.flatMap((item) =>
    item.type === 'track-size' ? [item.value] : item.value.trackSizes,
  );
  if (auto.length > 1 || !sizes.every(fixedSize)) {
    throw new CssUnsupported(
      `${context}: beside repeat(${auto[0].value.count.type}) every track needs a fixed size, a length on one side at least, and there is one such repeat at the most`,
    );
  }
}

function trackItem(item, context) {
  if (item.type === 'track-size') return trackSize(item.value, context);
  const { count, lineNames, trackSizes } = item.value;
  const times = count.type === 'number' ? count.value : count.type;
  const sizes = trackSizes.map((size) => trackSize(size, context));
  return `repeat(${times}, ${named(sizes, lineNames)})`;
}

/** `grid-template-columns` or `grid-template-rows`: the track list, or nothing for `none`. */
function trackList(value, context) {
  if (value?.type === 'none') return null;
  if (value?.type !== 'track-list') {
    throw new CssUnsupported(`${context}: only a list of track sizes is supported`);
  }
  fixedBesideAutoRepeat(value.items, context);
  return named(
    value.items.map((item) => trackItem(item, context)),
    value.lineNames,
  );
}

/** `grid-template-areas`, as its rows: `"head head" "side ."`. Nothing for `none`. */
function areas(value) {
  if (value?.type !== 'areas') return null;
  const rows = [];
  for (let at = 0; at < value.areas.length; at += value.columns) {
    const row = value.areas.slice(at, at + value.columns).map((name) => name ?? '.');
    rows.push(`"${row.join(' ')}"`);
  }
  return rows.join(' ');
}

/** `grid-auto-columns` or `grid-auto-rows`. */
const autoTracks = (value, context) =>
  // No sizes is `auto`, which is how the parser hands the initial value over.
  value.length ? value.map((size) => trackSize(size, context)).join(' ') : 'auto';

/** One side of a placement: a line by its number or its name, a span, or auto. */
function line(value, context) {
  if (value.type === 'auto') return 'auto';
  if (value.type === 'area') return value.name;
  if (value.type === 'span') {
    if (value.name) {
      throw new CssUnsupported(
        `${context}: a span counted in named lines is not supported; span a number of tracks, or name the line it ends at`,
      );
    }
    return `span ${value.index}`;
  }
  return value.name ? `${value.name} ${value.index}` : String(value.index);
}

/** `justify-items` or `justify-self`, as the keyword, with `safe` kept in front of it. */
function justify(value, context) {
  if (value?.type === 'baseline-position') {
    return value.value === 'last' ? 'last baseline' : 'baseline';
  }
  const word = value?.value ?? value?.type;
  if (typeof word !== 'string') {
    throw new CssUnsupported(`${context}: expected an alignment keyword`);
  }
  return value.overflow === 'safe' ? `safe ${word}` : word;
}

module.exports = { trackList, autoTracks, areas, line, justify };
