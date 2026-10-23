/**
 * A `filter` a script or a binding wrote as text, as the list of one-key records a native view
 * reads, the list a stylesheet's `filter` compiles to. Fabric reads no text: a string there is no
 * filter, and an assertion in a debug build.
 */

/** The filter functions of an amount, each written under its own name. */
const AMOUNTS = new Set([
  ...['brightness', 'contrast', 'grayscale', 'invert', 'opacity', 'saturate', 'sepia'],
]);

/** Degrees in each unit of an angle. */
const DEGREES: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

/** One function and its arguments: `blur(2px)`. */
const FUNCTION = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/gi;

/**
 * The list a filter's text comes to, or null for one with any function native has no form of, as
 * a browser draws no filter where one part of it is wrong. A list is one already.
 */
export function filtersOf(value: unknown): unknown {
  if (typeof value !== 'string') return Array.isArray(value) ? value : null;
  const text = value.trim();
  const functions = [...text.matchAll(FUNCTION)];
  // Only functions, with nothing but space between them.
  if (!functions.length || text.replace(FUNCTION, '').trim()) return null;
  const list = functions.map(([, name, args]) => filterOf(name!.toLowerCase(), args!.trim()));
  return list.includes(null) ? null : list;
}

function filterOf(name: string, args: string): Record<string, unknown> | null {
  if (AMOUNTS.has(name)) {
    const number = amountOf(args);
    return number === null ? null : { [name]: number };
  }
  if (name === 'blur') {
    const radius = lengthOf(args || '0');
    return radius === null ? null : { blur: radius };
  }
  if (name === 'hue-rotate') {
    const degrees = angleOf(args || '0');
    return degrees === null ? null : { hueRotate: degrees };
  }
  return name === 'drop-shadow' ? dropShadowOf(args) : null;
}

/** An amount: a number, or a percentage of one. Empty is the function's default, 1. */
function amountOf(text: string): number | null {
  if (!text) return 1;
  const percent = /^([\d.]+)%$/.exec(text);
  if (percent) return parseFloat(percent[1]!) / 100;
  return /^[\d.]+$/.test(text) ? parseFloat(text) : null;
}

/** A length in points: pixels, root ems, or a bare zero. */
function lengthOf(text: string): number | null {
  const [, number, unit] = /^(-?[\d.]+)(px|rem)?$/.exec(text) ?? [];
  if (number === undefined) return null;
  if (unit === undefined) return parseFloat(number) === 0 ? 0 : null;
  return parseFloat(number) * (unit === 'rem' ? 16 : 1);
}

/** An angle in degrees; a bare zero is one. */
function angleOf(text: string): number | null {
  const [, number, unit] = /^(-?[\d.]+)([a-z]+)?$/i.exec(text) ?? [];
  if (number === undefined) return null;
  if (unit === undefined) return parseFloat(number) === 0 ? 0 : null;
  const per = DEGREES[unit.toLowerCase()];
  return per === undefined ? null : parseFloat(number) * per;
}

/**
 * `drop-shadow(x y blur? colour?)`, in either order of lengths and colour, as `filter` compiles
 * one: the blur is the standard deviation React Native's own filter passes through.
 */
function dropShadowOf(args: string): Record<string, unknown> | null {
  const lengths: number[] = [];
  let color: string | undefined;
  for (const part of args.split(/\s+(?![^(]*\))/)) {
    const length = lengthOf(part);
    if (length !== null) lengths.push(length);
    else if (color === undefined && part) color = part;
    else return null;
  }
  if (lengths.length < 2 || lengths.length > 3) return null;
  const [offsetX, offsetY, standardDeviation] = lengths;
  return {
    dropShadow: {
      offsetX,
      offsetY,
      ...(standardDeviation === undefined ? {} : { standardDeviation }),
      ...(color === undefined ? {} : { color }),
    },
  };
}
