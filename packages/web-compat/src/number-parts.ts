/**
 * `Intl.NumberFormat.prototype.formatToParts`, which Hermes has no copy of: a library's number
 * mask reads where a locale groups digits from it, as Taiga UI's and Maskito's do, and failed
 * with `undefined is not a function`. The parts are read off what `format` writes: each run of
 * digits an `integer` until the locale's decimal sign and a `fraction` after it, the signs the
 * locale groups and divides with as `group` and `decimal`, a minus and a plus as `minusSign` and
 * `plusSign`, the locale's words for a number that is none and an endless one as `nan` and
 * `infinity`, and anything else a `literal`.
 *
 * ponytail: numbers alone, with no currency, unit, percent or exponent part named as such: each
 * of those is a `literal`. Name them where a library is seen reading one.
 */

interface Part {
  type: string;
  value: string;
}

type Formatter = {
  format(value: unknown): string;
  resolvedOptions(): { locale: string; numberingSystem?: string };
};

/** Give `Intl.NumberFormat` its `formatToParts` where the runtime has none. Answers its undoing. */
export function installNumberParts(): () => void {
  const proto = (globalThis as { Intl?: { NumberFormat?: { prototype: object } } }).Intl
    ?.NumberFormat?.prototype as (Formatter & { formatToParts?: unknown }) | undefined;
  if (!proto) return () => {};
  if (typeof proto.formatToParts === 'function') return takingBigInts(proto);
  Object.defineProperty(proto, 'formatToParts', {
    configurable: true,
    writable: true,
    value: function formatToParts(this: Formatter, value: unknown): Part[] {
      return partsOf(this.format(numeric(value)), numeric(value), signsOf(this));
    },
  });
  return () => void delete (proto as { formatToParts?: unknown }).formatToParts;
}

/**
 * Hermes's own `formatToParts` on Android, which takes no `BigInt` either: given one as the
 * number it is, where the runtime refuses it. Answers its undoing.
 */
function takingBigInts(proto: object & { formatToParts?: unknown }): () => void {
  const own = Object.getOwnPropertyDescriptor(proto, 'formatToParts');
  const original = proto.formatToParts as (this: unknown, value: unknown) => Part[];
  try {
    original.call(new Intl.NumberFormat('en-US'), BigInt(1));
    return () => {};
  } catch {
    // Refused: wrapped below.
  }
  Object.defineProperty(proto, 'formatToParts', {
    configurable: true,
    writable: true,
    value: function formatToParts(this: unknown, value: unknown): Part[] {
      return original.call(this, numeric(value));
    },
  });
  return () => {
    if (own) Object.defineProperty(proto, 'formatToParts', own);
    else delete (proto as { formatToParts?: unknown }).formatToParts;
  };
}

/**
 * A `BigInt` as the number Hermes formats, which takes none: Taiga UI writes `10n ** digits` to
 * learn a locale's digit groups.
 *
 * ponytail: one past 2^53 loses its last digits, which a mask reading only how many digits each
 * group has does not see. Write the digits out by hand if a library formats one so large.
 */
const numeric = (value: unknown): unknown => (typeof value === 'bigint' ? Number(value) : value);

/**
 * What a formatter writes a number with: its digits, the signs it groups and divides with, and
 * the words for a number that is none and for an endless one.
 */
interface Signs {
  digits: Set<string>;
  group: string;
  decimal: string;
  nan: string;
  infinity: string;
}

/** Each formatter's signs, read once: a formatter's options never change. */
const signsByFormatter = new WeakMap<object, Signs>();

/** The signs a formatter writes with, from numbers written in its locale and numbering system. */
function signsOf(formatter: Formatter): Signs {
  let signs = signsByFormatter.get(formatter);
  if (signs) return signs;
  const { locale, numberingSystem } = formatter.resolvedOptions();
  const Format = Intl.NumberFormat as unknown as new (locale: string, options: object) => Formatter;
  const written = (value: number, options: object = {}) =>
    new Format(locale, numberingSystem ? { numberingSystem, ...options } : options).format(value);
  // Each digit on its own, as the formatter's numbering system writes it: a Bengali locale writes
  // Bengali digits. Spelled out, as Hermes reads no `\p{Nd}`.
  const digits = new Set(Array.from('0123456789'));
  for (let digit = 0; digit < 10; digit++) digits.add(Array.from(written(digit)).at(-1)!);
  // Split at the digits, and not at white space: a locale groups with a space of its own.
  const between = runsOf(written(11111.1, { minimumFractionDigits: 1, useGrouping: true }), digits)
    .filter((run) => !digits.has(run[0]!))
    .map((run) => run.join(''));
  signs = {
    digits,
    group: between.length > 1 ? between[0]! : '',
    decimal: between.at(-1) ?? '.',
    nan: written(NaN),
    infinity: written(Infinity),
  };
  signsByFormatter.set(formatter, signs);
  return signs;
}

/** A string cut into runs of digits and runs of what is between them. */
function runsOf(written: string, digits: Set<string>): string[][] {
  const runs: string[][] = [];
  for (const char of Array.from(written)) {
    const last = runs.at(-1);
    if (last && digits.has(last[0]!) === digits.has(char)) last.push(char);
    else runs.push([char]);
  }
  return runs;
}

function partsOf(written: string, value: unknown, signs: Signs): Part[] {
  // A number that is none, or endless, is named whole, between any sign and literal around it.
  const endless = typeof value === 'number' && !Number.isFinite(value);
  const word = !endless ? '' : Number.isNaN(value) ? signs.nan : signs.infinity;
  const at = word ? written.indexOf(word) : -1;
  if (at < 0) return finiteParts(written, signs);
  return [
    ...finiteParts(written.slice(0, at), signs),
    { type: Number.isNaN(value) ? 'nan' : 'infinity', value: word },
    ...finiteParts(written.slice(at + word.length), signs),
  ];
}

function finiteParts(written: string, signs: Signs): Part[] {
  const parts: Part[] = [];
  let fraction = false;
  for (const run of runsOf(written, signs.digits)) {
    const tokens = signs.digits.has(run[0]!) ? [run.join('')] : run;
    for (const token of tokens) {
      const type = signs.digits.has(token[0]!)
        ? fraction
          ? 'fraction'
          : 'integer'
        : signTypeOf(token, signs);
      if (type === 'decimal') fraction = true;
      const last = parts.at(-1);
      if (last && last.type === 'literal' && type === 'literal') last.value += token;
      else parts.push({ type, value: token });
    }
  }
  return parts;
}

function signTypeOf(token: string, { decimal, group }: Signs): string {
  if (token === decimal) return 'decimal';
  if (token === group) return 'group';
  if (token === '-' || token === '\u2212') return 'minusSign';
  return token === '+' ? 'plusSign' : 'literal';
}
