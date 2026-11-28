/**
 * A mask, in a sheet read as a browser reads it: the one image a box is cut to, as a UI library
 * draws an icon. Taiga UI paints a box `currentColor` and masks it with the icon's SVG,
 * `mask-image: var(--t-icon-start)`, and Iconify's CSS icons do the same with a `data:` URL.
 *
 * Kept for `@ng-native/web-compat`, which draws the SVG in the box's background colour where the
 * engine tells it of the mask: `maskImage` as the `url()` written, or a token's text; `maskWidth`
 * and `maskHeight` as the first layer's size, each a length, a percentage, `calc(P% + Qpx)`, `auto`,
 * `contain` or `cover`; `maskPosition` as a background position. No native view reads them.
 *
 * One layer is drawn. A gradient, a second layer, a composite, a luminance mask or a box other
 * than the one inside the border is reported: a gradient or a second layer drops the declaration,
 * and the rest leave the one layer as it is.
 */
const { CssUnsupported, length, refusePart, fallbacks } = require('./values.cjs');
const { backgroundPosition } = require('./filters.cjs');
const { components, reference, arithmetic, staticLength } = require('./shorthands.cjs');
const { calcWithTokens, mentionsVar } = require('./token-arithmetic.cjs');

const SIZE_PROPS = ['maskWidth', 'maskHeight'];

/** The property a declaration is for, prefixed or not, whether lightningcss parsed it or not. */
function propertyOf(declaration) {
  const { property, value } = declaration;
  return property === 'unparsed' ? value?.propertyId?.property : property;
}

/**
 * A mask declaration written to `out`, or deferred where a token is in it. Answers whether the
 * declaration was one.
 */
function readMask(declaration, out, deferred, context, linear) {
  const property = propertyOf(declaration);
  if (typeof property !== 'string' || !/^mask(-|$)/.test(property)) return false;
  // Written once the whole declaration is read: one dropped leaves what was set before it.
  const read = {};
  const later = [];
  if (declaration.property === 'unparsed')
    withTokens(property, declaration.value.value, read, later, context, linear);
  else readValue(property, declaration.value, read, later, context);
  Object.assign(out, read);
  deferred.push(...later);
  return true;
}

/** A mask declaration lightningcss parsed, written to `out`. */
function readValue(property, value, out, deferred, context) {
  if (property === 'mask') shorthand(value, out, deferred, context);
  else if (property === 'mask-image') out.maskImage = image(value, context);
  else if (property === 'mask-size') size(value, out, deferred, context);
  else if (property === 'mask-position') out.maskPosition = position(value, context);
  else checkedOnly(property, value, context);
}

/** `mask: url(a.svg) center / contain no-repeat`, one layer of it. */
function shorthand(value, out, deferred, context) {
  if (value.length !== 1) throw tooMany(context);
  const [layer] = value;
  out.maskImage = image([layer.image], context);
  size([layer.size], out, deferred, context);
  out.maskPosition = position([layer.position], context);
  checkedOnly('mask-repeat', [layer.repeat], context);
  checkedOnly('mask-composite', [layer.composite], context);
  checkedOnly('mask-mode', [layer.mode], context);
  checkedOnly('mask-origin', [layer.origin], context);
  checkedOnly('mask-clip', [layer.clip], context);
}

/** The image of a mask: the `url()` written, or null for `none`. */
function image(value, context) {
  if (value.length !== 1) throw tooMany(context);
  const [layer] = value;
  if (layer.type === 'none') return null;
  if (layer.type === 'url') return `url(${JSON.stringify(layer.value.url)})`;
  throw new CssUnsupported(
    `${context}: a mask is drawn from one SVG image, and this one is a ${layer.type}: it is drawn unmasked`,
  );
}

const tooMany = (context) =>
  new CssUnsupported(`${context}: a mask is drawn from one image, and this has several layers`);

/** The first layer's size, as `maskWidth` and `maskHeight`. */
function size(value, out, deferred, context) {
  const [layer] = value;
  if (layer.type === 'contain' || layer.type === 'cover') {
    out.maskWidth = layer.type;
    out.maskHeight = layer.type;
    return;
  }
  [layer.width, layer.height].forEach((axis, at) => {
    const prop = SIZE_PROPS[at];
    put(prop, axisSize(axis, context), out, deferred);
  });
}

/**
 * One axis of a size, as the drawing places it: `auto`, a length, a percentage, or
 * `{ size, upTo?, plus? }` for a length no larger than a share of the box, `min(1em, 100%)`, and
 * points added, `calc(100% + 10px)`.
 */
function axisSize(axis, context) {
  if (!axis || axis.type === 'auto') return 'auto';
  return staticAxis(axis.value, context);
}

const SIZE_FORM =
  "a mask's size is a length, a percentage, min() of a length and a percentage, or one of those " +
  'with a length added in calc()';

/** A parsed `length-percentage`, through the `calc()` and `min()` lightningcss wraps it in. */
function staticAxis(value, context) {
  const inner = unwrapped(value);
  if (inner?.type === 'min') {
    return capped(
      inner.value.map((term) => length(term.value, context)),
      context,
    );
  }
  if (inner?.type !== 'sum') return length(inner, context);
  const [head, extra] = inner.value.map((term) => term.value);
  const plus = length(extra, context);
  if (inner.value.length !== 2 || typeof plus !== 'number')
    throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  return added(staticAxis(head, context), plus, context);
}

/** What a `calc` or a math function holds, past the wrappers lightningcss puts around it. */
function unwrapped(value) {
  let inner = value;
  while (inner && (inner.type === 'calc' || inner.type === 'function' || inner.type === 'value')) {
    inner = inner.value;
  }
  return inner;
}

/** `min(<length>, <percentage>)`, either way round: the length, no larger than the share. */
function capped(lengths, context) {
  const share = lengths.find((each) => typeof each === 'string' && each.endsWith('%'));
  const size = lengths.find((each) => each !== share);
  if (lengths.length !== 2 || share === undefined || size === undefined) {
    throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  }
  return { size, upTo: share };
}

/** An axis with points added: a length or a marker the device settles. */
function added(axis, plus, context) {
  if (axis === 'auto') throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  return typeof axis === 'object' && axis !== null && !axis.__defer
    ? { ...axis, plus }
    : { size: axis, plus };
}

/** The first layer's position, as a background's is written. */
function position(value, context) {
  return backgroundPosition([value[0]], context)[0];
}

/** What is drawn of the rest: one layer, by its alpha, once. Anything else is reported. */
function checkedOnly(property, value, context) {
  const [first] = value ?? [];
  const why = first === undefined ? undefined : UNDRAWN[property]?.(first);
  if (why) refusePart(`${context}: ${why}`);
}

/**
 * What is said of a value of each of the rest that is not drawn, or nothing where it is.
 * `mask-type` is for a `<mask>` element, which no box is: it is read and left.
 */
const UNDRAWN = {
  'mask-repeat': (first) =>
    (first.x !== 'no-repeat' || first.y !== 'no-repeat') && 'a mask is drawn once, not repeated.',
  'mask-composite': (first) =>
    first !== 'add' && 'a mask is drawn from one layer, so nothing is composited.',
  'mask-mode': (first) =>
    first === 'luminance' && 'a mask is drawn by its alpha, not its luminance.',
  'mask-clip': (first) => undrawnBox(first),
  'mask-origin': (first) => undrawnBox(first),
};

/**
 * The box a mask is placed in or cut to: drawn over the box inside its border, which is the whole
 * box where it has none, as an icon has none. Those two are drawn as written; any other is said.
 */
function undrawnBox(first) {
  const box = typeof first === 'string' ? first : (first.value ?? first.type);
  return (
    box !== 'border-box' &&
    box !== 'padding-box' &&
    `a mask is placed in and cut to the box inside its border, not ${box}.`
  );
}

/** A mask declaration with a token in it: the image or the size; anything else is refused. */
function withTokens(property, parts, out, deferred, context, linear) {
  if (property === 'mask-image') {
    const list = components(parts);
    if (list.length !== 1 || list[0].length !== 1 || list[0][0].type !== 'var') {
      throw new CssUnsupported(`${context}: a mask's image with a token in it is the token alone`);
    }
    const [part] = list[0];
    deferred.push({
      props: ['maskImage'],
      kind: 'keyword',
      reference: part.value.name.ident,
      ...fallbacks(part, 'keyword', context),
    });
    return true;
  }
  if (property === 'mask-size') return sizeWithTokens(parts, out, deferred, context, linear);
  throw new CssUnsupported(
    `${context}: '${property}' with a token in it is not read. Write the value.`,
  );
}

/** `mask-size: calc(100% + 10 * var(--stroke)) 100%`, the first layer, each axis on its own. */
function sizeWithTokens(parts, out, deferred, context, linear) {
  const comma = parts.findIndex((part) => part?.type === 'token' && part.value?.type === 'comma');
  const list = components(comma === -1 ? parts : parts.slice(0, comma));
  if (list.length < 1 || list.length > 2) {
    throw new CssUnsupported(`${context}: could not read 'mask-size'`);
  }
  SIZE_PROPS.forEach((prop, at) => {
    const [part, ...rest] = list[at] ?? [];
    if (part === undefined) return void (out[prop] = 'auto');
    if (rest.length) throw new CssUnsupported(`${context}: could not read 'mask-size'`);
    if (part.type === 'var') return void deferred.push(reference(part, [prop], 'length', context));
    if (part.type !== 'function') return void put(prop, termLength([part], context), out, deferred);
    const axis = mentionsVar(part) ? null : tokenAxis(part, context);
    if (axis !== null) return void put(prop, axis, out, deferred);
    // `calc(100% + 10 * var(--stroke))`: a box's own share and a token, as a width has them.
    const ofABox = (one, where) => linear(one, where, true);
    const share = linear(part, context, true);
    if (share) return void deferred.push(arithmetic(part, prop, context, ofABox));
    put(prop, tokenAxis(part, context), out, deferred);
  });
  return true;
}

/** An axis written to `out`, or deferred where something in it is only known on device. */
function put(prop, axis, out, deferred) {
  if (holdsMarker(axis)) deferred.push({ props: [prop], within: axis });
  else out[prop] = axis;
}

const holdsMarker = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.keys(value).some((key) => key.startsWith('__')) ||
    Object.values(value).some(holdsMarker));

/**
 * An axis written as raw tokens: `min(1em, 100%)`, or `calc(min(1em, 100%) + 10 * var(--stroke))`
 * as Taiga UI sizes an icon's mask, the stroke past the box being how its icons are drawn.
 */
function tokenAxis(part, context) {
  const name = part.value?.name;
  const args = part.value?.arguments ?? [];
  if (name === 'min')
    return capped(
      byComma(args).map((one) => termLength(one, context)),
      context,
    );
  if (name !== 'calc') throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  const written = args.filter(
    (arg) => !(arg?.type === 'token' && arg.value?.type === 'white-space'),
  );
  const sign = written.findIndex(
    (arg, at) =>
      at > 0 &&
      arg?.type === 'token' &&
      arg.value?.type === 'delim' &&
      /^[+-]$/.test(arg.value.value),
  );
  if (sign !== 1) throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  const head =
    written[0].type === 'function'
      ? tokenAxis(written[0], context)
      : termLength([written[0]], context);
  const rest = args.slice(args.indexOf(written[sign]) + 1);
  const negative = written[sign].value.value === '-';
  const extra = calcWithTokens(
    [{ type: 'function', value: { name: 'calc', arguments: negative ? negated(rest) : rest } }],
    'length',
    context,
  );
  return added(head, extra ?? termLength(rest, context), context);
}

/** `0 - (rest)`, for what a minus takes away. */
const negated = (rest) => [
  { type: 'token', value: { type: 'number', value: 0 } },
  { type: 'token', value: { type: 'delim', value: '-' } },
  { type: 'function', value: { name: 'calc', arguments: rest } },
];

/** A math function's arguments, split at their commas. */
function byComma(args) {
  /** @type {any[][]} */
  const out = [[]];
  for (const arg of args) {
    if (arg?.type === 'token' && arg.value?.type === 'comma') out.push([]);
    else if (!(arg?.type === 'token' && arg.value?.type === 'white-space'))
      out[out.length - 1].push(arg);
  }
  return out;
}

/** One term of raw tokens as a length: points, a percentage, or an em the device settles. */
function termLength(terms, context) {
  const written = terms.filter(
    (arg) => !(arg?.type === 'token' && arg.value?.type === 'white-space'),
  );
  if (written.length !== 1) throw new CssUnsupported(`${context}: ${SIZE_FORM}`);
  const [term] = written;
  if (term.type === 'length') return length({ type: 'dimension', value: term.value }, context);
  return staticLength(term, context);
}

module.exports = { readMask };
