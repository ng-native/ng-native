/**
 * A custom property that holds a whole `font` shorthand, as Taiga UI writes its typography:
 * `--tui-typography-body-m: normal calc(var(--tui-font-offset) + 1rem) / calc(24 / 16)
 * var(--tui-typography-family-text)`. Read into its longhands, `font`, as the shorthand written
 * out compiles to, for `font: var(--token)` to set on device.
 *
 * The text is parsed as a `font` by lightningcss and translated as one written out is. A part that
 * reads another token, the size or the family, is parsed as a stand-in of its kind and put back as
 * what the device works out: a sum of tokens for the size, the token's family for the family.
 *
 * ponytail: a line height read from a token is not read; the shorthand is no font form then.
 */
const { calcWithTokens } = require('./token-arithmetic.cjs');

/** The longhands a `font` sets, each of which `font: var()` writes from the token's form. */
const FONT_PROPS = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight'];

/**
 * Words that parse as a family after a size but are another property's: `10px left` is a
 * background's position, which a font token would keep where a browser's use site drops it.
 *
 * ponytail: the keywords of a position, a size and a repeat. Read the token's use sites if a
 * real family is ever named one of these.
 */
const NOT_FAMILIES = new Set([
  ...['left', 'right', 'top', 'bottom', 'center', 'auto', 'none'],
  ...['cover', 'contain', 'repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round'],
]);

const SIZE_STANDS = 9000;
const FAMILY_STAND = '__ngnfamily';

const isSpace = (part) => part?.type === 'token' && part.value?.type === 'white-space';
const isSlash = (part) =>
  part?.type === 'token' && part.value?.type === 'delim' && part.value.value === '/';
const mentionsVar = (part) =>
  part?.type === 'var' || (part?.value?.arguments ?? []).some(mentionsVar);

/** The longhands a token holding a font shorthand sets, or undefined for any other value. */
function fontForm(parts, context = 'token') {
  const { cssText } = require('./values.cjs');
  const written = parts.filter((part) => !isSpace(part));
  if (!written.some((part) => !mentionsVar(part)) && written.length < 2) return undefined;
  const stood = standIns(parts, written);
  if (!stood) return undefined;
  const { stands, replaced } = stood;
  const text = fontText(replaced, cssText);
  if (text === null) return undefined;
  const out = translated(text);
  if (!out || out.fontSize === undefined || out.fontFamily === undefined) return undefined;
  if (NOT_FAMILIES.has(String(out.fontFamily).toLowerCase())) return undefined;
  return withTokens(out, stands, context);
}

/**
 * The parts with each that reads a token put as a stand-in of its kind: a family where it is the
 * last part or beside a comma, `var(--family), serif`, and a size anywhere else. Nothing for a
 * line height from a token, which is not read. A line height in percent is of the size, so it is
 * put as the em it is, which the device measures against the size worked out, where the
 * stand-in's would be kept.
 */
function standIns(parts, written) {
  const stands = new Map();
  const replaced = [];
  for (const part of parts) {
    const index = written.indexOf(part);
    if (isSlash(written[index - 1]) && isPercent(part)) {
      replaced.push({ type: 'length', value: { unit: 'em', value: part.value.value } });
      continue;
    }
    if (!mentionsVar(part)) {
      replaced.push(part);
      continue;
    }
    if (isSlash(written[index - 1])) return undefined;
    const family =
      index === written.length - 1 || isComma(written[index + 1]) || isComma(written[index - 1]);
    const key = family ? `${FAMILY_STAND}${stands.size}` : `${SIZE_STANDS + stands.size}px`;
    stands.set(key, part);
    replaced.push(family ? identToken(key) : lengthToken(SIZE_STANDS + stands.size - 1));
  }
  return { stands, replaced };
}

const isComma = (part) => part?.type === 'token' && part.value?.type === 'comma';
const isPercent = (part) => part?.type === 'token' && part.value?.type === 'percentage';

/** The parts as text, a quoted family name quoted again: `cssText` has no strings. */
function fontText(parts, cssText) {
  let text = '';
  for (const part of parts) {
    const piece = isString(part) ? quoted(part.value.value) : cssText([part]);
    if (piece === null) return null;
    text += piece;
  }
  return text;
}

const isString = (part) => part?.type === 'token' && part.value?.type === 'string';

/** A string as CSS writes one: a quote or a backslash escaped, and a line break as its code. */
const quoted = (value) =>
  `"${value.replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

const identToken = (name) => ({ type: 'token', value: { type: 'ident', value: name } });
const lengthToken = (value) => ({ type: 'length', value: { unit: 'px', value } });

/** The text parsed as a `font` and translated as one written out: undefined if it is no font. */
function translated(text) {
  let parsed;
  try {
    require('lightningcss').transform({
      filename: 'token.css',
      code: Buffer.from(`a{font:${text}}`),
      visitor: {
        Declaration(declaration) {
          if (declaration.property === 'font') parsed = declaration.value;
        },
      },
    });
    if (!parsed) return undefined;
    const out = {};
    require('./properties.cjs').translate('font', parsed, out);
    return out;
  } catch {
    return undefined;
  }
}

/** The stand-ins put back as what the device works out of the tokens they were. */
function withTokens(out, stands, context) {
  const font = { fontStyle: 'normal', fontWeight: 'normal', ...out };
  for (const [key, part] of stands) {
    if (key.startsWith(FAMILY_STAND)) {
      // A family after the first, which native never takes.
      if (font.fontFamily !== key) continue;
      const family = familyMarker(part);
      if (!family) return undefined;
      font.fontFamily = family;
    } else {
      if (font.fontSize !== Number.parseFloat(key)) return undefined;
      const sum = { type: 'function', value: { name: 'calc', arguments: [part] } };
      const marker = calcWithTokens([sum], 'length', context);
      if (!marker) return undefined;
      font.fontSize = marker;
    }
  }
  return font;
}

/**
 * The family a token holds, as the device reads it, and the family written as its fallback where
 * the token is unset: `var(--family, Manrope)`. Undefined for a fallback of anything else.
 */
function familyMarker(part) {
  if (part.type !== 'var') return undefined;
  const reference = part.value.name.ident;
  const written = part.value.fallback;
  if (!written) return { __family: { reference } };
  if (written.some(mentionsVar)) return undefined;
  const text = fontText(written, require('./values.cjs').cssText);
  const fallback = text === null ? undefined : translated(`1px ${text}`)?.fontFamily;
  return fallback === undefined ? undefined : { __family: { reference, fallback } };
}

module.exports = { fontForm, FONT_PROPS };
