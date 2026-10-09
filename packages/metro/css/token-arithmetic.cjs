/**
 * Arithmetic with tokens in it, carried to the device as a tree: a `calc()` with more than one
 * `var()`, and the transforms Tailwind writes with a token in every slot, `translate:
 * var(--tw-translate-x) var(--tw-translate-y)`.
 *
 * The device has no CSS parser, so what is left for it is a tree of numbers, operators and
 * token references, each leaf read in the form its slot wants: a length in points, an angle in
 * degrees, or a number. A single `var()` with arithmetic around it that is linear in it keeps
 * its cheaper path (`linear` in `compile.cjs`); this is for everything past that.
 */
const {
  CssUnsupported,
  PER_TURN,
  arithmeticTree,
  commaSeparated,
  fallbacks,
  length,
  meaningful,
  round,
} = require('./values.cjs');

/** Whether a term, or anything inside it, is a `var()`. */
function mentionsVar(term) {
  if (term?.type === 'var') return true;
  return (term?.value?.arguments ?? []).some(mentionsVar);
}

/**
 * One slot's value as a tree: a number, `{ reference, fallback? }`, or `[op, a, b]`. `kind` is
 * what the slot is - `length`, `angle`, `time` or `number` - which is the form a token is read in.
 */
function tree(term, kind, context) {
  if (term?.type === 'var') return leaf(term, kind, context);
  const name = term?.type === 'function' ? term.value?.name : undefined;
  if (name === 'calc') return arithmetic(meaningful(term.value.arguments), kind, context);
  // `max(var(--safe-area-inset-top, 0px), calc(var(--spacing) * 4))`, which is `pt-safe-or-4`.
  if (name === 'max' || name === 'min') {
    const sides = commaSeparated(term.value.arguments).map((side) =>
      arithmetic(meaningful(side), kind, context),
    );
    return sides.reduce((a, b) => [name, a, b]);
  }
  return literal(term, kind, context);
}

function arithmetic(terms, kind, context) {
  const parsed = arithmeticTree(
    terms,
    0,
    (term) => tree(term, kind, context),
    (why) => unreadable(context, why),
  );
  if (parsed.next !== terms.length) throw unreadable(context, 'is not arithmetic');
  return parsed.value;
}

/** Whether an angle's fallback is a zero with no unit, which is an angle of none as it is a length of none. */
const zeroAngle = (kind, nested, rest) =>
  kind === 'angle' && !rest.length && nested?.value?.type === 'number' && nested.value.value === 0;

/** The number a token falls back to, where it falls back to one. */
const fallbackOf = (term, kind, nested, rest, context) =>
  zeroAngle(kind, nested, rest) ? 0 : fallbacks(term, kind, context).fallback;

function leaf(term, kind, context) {
  // A fallback that is another `var()` or arithmetic of its own is a tree too, worked out if the
  // token is not set: `var(--a, var(--b, 3px))`, `var(--a, calc(var(--gap) * 2))`.
  const [nested, ...rest] = meaningful(term.value?.fallback);
  const name = nested?.type === 'function' ? nested.value?.name : undefined;
  if (nested && !rest.length && (nested.type === 'var' || MATH.has(name))) {
    return { reference: term.value.name.ident, fallback: tree(nested, kind, context) };
  }
  const fallback = fallbackOf(term, kind, nested, rest, context);
  if (typeof fallback !== 'number') return { reference: term.value.name.ident };
  // A percentage stays one, as a percentage written in the arithmetic does.
  const percentage = kind === 'number' && fractionOf(nested) !== undefined;
  return {
    reference: term.value.name.ident,
    fallback: percentage ? { percentage: fallback } : fallback,
  };
}

/**
 * A written number, length or angle, as the number its slot counts in; or, where the slot is a
 * number, a percentage, as `{ percentage }`, the fraction it is kept apart from a bare number.
 */
function literal(term, kind, context) {
  const fraction = kind === 'number' ? fractionOf(term) : undefined;
  if (fraction !== undefined) return { percentage: fraction };
  for (const read of READERS) {
    const value = read(term, context);
    if (value !== undefined) return value;
  }
  const what = term?.value?.unit ?? term?.value?.type ?? term?.type;
  throw unreadable(context, `cannot take '${what}' here`);
}

const numberOf = (term) =>
  term?.type === 'token' && term.value?.type === 'number' ? round(term.value.value) : undefined;

/** How a written value is read, in turn: a number, then an angle, a time and a length. */
const READERS = [
  (term) => numberOf(term),
  (term) => degreesOf(term),
  (term) => millisecondsOf(term),
  (term, context) => pointsOf(term, context),
];

/**
 * A percentage, as the fraction it is where the slot is a number: an alpha or an opacity, which is
 * how Open Props adds `3%` to a shadow's strength. A length's percentage needs layout, and stays
 * refused.
 */
const fractionOf = (term) =>
  term?.type === 'token' && term.value?.type === 'percentage' ? round(term.value.value) : undefined;

const degreesOf = (term) =>
  term?.type === 'angle' && PER_TURN[term.value?.type]
    ? round(term.value.value * PER_TURN[term.value.type])
    : undefined;

const millisecondsOf = (term) =>
  term?.type === 'time'
    ? round(term.value.value * (term.value.type === 'seconds' ? 1000 : 1))
    : undefined;

function pointsOf(term, context) {
  if (term?.type !== 'length') return undefined;
  const points = length(term.value, context);
  return typeof points === 'number' ? points : undefined;
}

const unreadable = (context, why) =>
  new CssUnsupported(
    `${context}: arithmetic with tokens in it ${why}. What the device works out is numbers, ` +
      `points, degrees and var(), with + - * / and brackets; a percentage, an em or a viewport ` +
      `unit beside a token needs layout the device does not do here.`,
  );

/** A slot's value for the device: settled if it has no token in it, a `__calc` marker if it has. */
function slot(term, kind, context) {
  const written = tree(term, kind, context);
  const value = written?.percentage ?? written;
  if (typeof value !== 'number') return { __calc: { expression: value, kind } };
  return kind === 'angle' ? `${value}deg` : value;
}

/**
 * `calc()` with more than one token in it, in a property that is one length or one number.
 * Null for anything else, which the caller refuses as before.
 */
function calcWithTokens(parts, kind, context) {
  const written = meaningful(parts);
  if (written.length !== 1 || !MATH.has(written[0].type === 'function' && written[0].value?.name)) {
    return null;
  }
  if (kind !== 'length' && kind !== 'number') return null;
  return slot(written[0], kind, context);
}

const MATH = new Set(['calc', 'max', 'min']);

/**
 * What `translate3d()` writes: across and down, where it moves nothing along the depth a view
 * has none of. A depth that is not nothing, or is a token and may not be, is refused, as it is
 * for one written with no token.
 */
function flatMove(a, context) {
  if (a('length', 2) !== 0) {
    throw new CssUnsupported(
      `${context}: translate3d() with a token in it moves along the depth, and a view has none. ` +
        `Write a depth of 0, or translate().`,
    );
  }
  return [{ translateX: a('length', 0) }, { translateY: a('length', 1) }];
}

/** What `scale3d()` writes: across and down. Its depth is read, and scales nothing drawn. */
function flatScale(a) {
  a('number', 2);
  return [{ scaleX: a('number', 0) }, { scaleY: a('number', 1) }];
}

/** What each transform function writes, from its arguments' slots. */
const FUNCTIONS = {
  translatex: (a) => [{ translateX: a('length', 0) }],
  translatey: (a) => [{ translateY: a('length', 0) }],
  translate: (a, n) => [{ translateX: a('length', 0) }, { translateY: n > 1 ? a('length', 1) : 0 }],
  // Across and down: a view has no depth to move in, or to scale.
  translate3d: (a, _, context) => flatMove(a, context),
  scale3d: (a) => flatScale(a),
  scale: (a, n) => [{ scaleX: a('number', 0) }, { scaleY: a('number', n > 1 ? 1 : 0) }],
  scalex: (a) => [{ scaleX: a('number', 0) }],
  scaley: (a) => [{ scaleY: a('number', 0) }],
  rotate: (a) => [{ rotate: a('angle', 0) }],
  rotatez: (a) => [{ rotate: a('angle', 0) }],
  rotatex: (a) => [{ rotateX: a('angle', 0) }],
  rotatey: (a) => [{ rotateY: a('angle', 0) }],
  skewx: (a) => [{ skewX: a('angle', 0) }],
  skewy: (a) => [{ skewY: a('angle', 0) }],
};

/** `transform: translateY(var(--y)) rotate(var(--r))`: each function with its slots. */
function transformList(parts, context) {
  return meaningful(parts).flatMap((part) => {
    const name = part.type === 'function' ? part.value.name.toLowerCase() : undefined;
    const write = FUNCTIONS[name];
    if (!write) {
      throw new CssUnsupported(
        `${context}: a transform with a token in it takes ${Object.keys(FUNCTIONS).join(', ')}; ` +
          `'${name ?? part.type}' is not one of them`,
      );
    }
    const args = commaSeparated(part.value.arguments ?? []).map(meaningful);
    const arg = (kind, index) => {
      if (args[index]?.length !== 1) throw unreadable(context, `leaves ${name}() short`);
      return slot(args[index][0], kind, context);
    };
    return write(arg, args.length, context);
  });
}

/**
 * `translate`, `rotate`, `scale` or `transform` with a token in it, as the structured value the
 * engine composes, with a marker wherever a token is. Null for any other property.
 */
function motionWithTokens(property, parts, context) {
  const values = meaningful(parts);
  const one = (kind, index) => slot(values[index], kind, context);
  switch (property) {
    case 'transform':
      return { props: ['transform'], within: transformList(parts, context) };
    case 'translate':
      if (values.length > 2) throw unreadable(context, 'moves in three dimensions');
      return {
        props: ['__translate'],
        within: [
          { translateX: one('length', 0) },
          { translateY: values[1] ? one('length', 1) : 0 },
        ],
      };
    case 'rotate':
      if (values.length !== 1) throw unreadable(context, 'turns about an axis');
      return { props: ['__rotate'], within: [{ rotate: one('angle', 0) }] };
    case 'scale':
      if (values.length > 2) throw unreadable(context, 'scales in three dimensions');
      return {
        props: ['__scale'],
        within: [{ scaleX: one('number', 0) }, { scaleY: one('number', values.length - 1) }],
      };
    default:
      return null;
  }
}

module.exports = { calcWithTokens, mentionsVar, motionWithTokens, slot };
