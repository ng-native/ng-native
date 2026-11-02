/**
 * A CSS transform string, as the list React Native's Fabric reads.
 *
 * A class's transform is compiled to this list at build time. A bound style -
 * `[style.transform]="'rotate(' + angle + 'deg)'"` - has no build step, and Fabric drops a string
 * without a word. React Native's JavaScript would have run `processTransform` over it first; there
 * is none of that JavaScript between this engine and Fabric, so this does the same job.
 *
 * Lengths in pixels become numbers, angles and percentages stay strings, as React Native keeps
 * them. A two-argument `translate`, `scale` or `skew` is split into its axes, and a 2D `matrix()`
 * is widened to the sixteen values native wants. A math function in an argument is worked out to
 * what the function takes, and CSS refuses one of another type: `rotate(calc(1 + 1))`.
 */
import {
  MATH_FUNCTION,
  SPACE,
  match,
  mathRefused,
  mathValue,
  rounded,
  type MathValue,
  type RelativeUnit,
} from './css-math.ts';

/** A length measured where it is used, as a stylesheet's transform holds one. */
type Measured = {
  readonly __defer: {
    readonly unit: RelativeUnit;
    readonly factor: number;
    readonly offset?: number;
  };
};

type Argument = number | string | Measured;

export type TransformEntry = Readonly<Record<string, number | string | readonly number[]>>;

const AXES: Readonly<Record<string, readonly [string, string]>> = {
  translate: ['translateX', 'translateY'],
  scale: ['scaleX', 'scaleY'],
  skew: ['skewX', 'skewY'],
};

const PX = /^-?\d*\.?\d+(px)?$/;
/** A transform function's argument: a number, a length, an angle or a percentage. */
const ARGUMENT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|[a-z]+)?$/i;
/** CSS whitespace: a space, a tab, a newline, a carriage return or a form feed, and no other. */
const SEPARATOR = /[ \t\n\r\f,]/;
const PADDED = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;
const CALL = /([a-zA-Z0-9]+)\(/y;
/** Whether a value could hold a length measured where it is used, without reading it. */
const MEASURED = /\d(?:em|vw|vh|vmin|vmax)/i;
/** A length in a unit measured where it is used. */
const RELATIVE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(em|vw|vh|vmin|vmax)$/i;
/** The two axes a function is along, and whether it was given a value for each. */
function axesOf(name: string, given: number) {
  return { axes: AXES[THREE_D[name] ?? name], both: given === 2 || name in THREE_D };
}

/** The spellings with a third axis, by the flat one each is on a view. */
const THREE_D: Readonly<Record<string, string>> = { scale3d: 'scale', translate3d: 'translate' };
/** The transform functions native has, by their name in any case, as CSS reads one. */
const NAMES = new Map(
  [
    ...['matrix', 'matrix3d', 'perspective', 'rotate', 'rotateX', 'rotateY', 'rotateZ'],
    ...['scale', 'scaleX', 'scaleY', 'skew', 'skewX', 'skewY'],
    ...['translate', 'translateX', 'translateY'],
    // A flat transform spelt with a third axis, which a view has nothing along.
    ...['scale3d', 'translate3d'],
  ].map((name) => [name.toLowerCase(), name]),
);

/** The type of value a transform function's arguments are. */
function slotOf(name: string): MathValue['type'] {
  if (/^(?:rotate|skew)/i.test(name)) return 'angle';
  return /^(?:scale|matrix)/i.test(name) ? 'number' : 'length';
}

const measured = (unit: RelativeUnit, factor: number, offset = 0): Measured => ({
  __defer: { unit, factor: rounded(factor), ...(offset ? { offset: rounded(offset) } : {}) },
});

/** A math function as the slot takes it, or undefined for one of another type. */
function mathArgument(slot: MathValue['type'], math: MathValue): Argument | undefined {
  if (slot === 'number' && math.type === 'number') return rounded(math.value);
  if (slot === 'angle' && math.type === 'angle') return `${rounded(math.value)}deg`;
  if (slot !== 'length') return undefined;
  if (math.type === 'percentage') return `${rounded(math.percent)}%`;
  if (math.type !== 'length' || math.percent) return undefined;
  const { relative, value } = math;
  return relative ? measured(relative.unit, relative.factor, value) : rounded(value);
}

/** An argument as native takes it, or undefined for one CSS does not read in this function. */
function argument(name: string, raw: string): Argument | undefined {
  if (MATH_FUNCTION.test(raw)) {
    const math = mathValue(raw);
    return math && mathArgument(slotOf(name), math);
  }
  if (!ARGUMENT.test(raw)) return undefined;
  const relative = RELATIVE.exec(raw);
  if (relative && slotOf(name) !== 'length') return undefined;
  if (relative) return measured(relative[2]!.toLowerCase() as RelativeUnit, Number(relative[1]));
  return PX.test(raw) ? parseFloat(raw) : raw;
}

/**
 * Whether a spelling with a third axis is one a view can have: all three values, as CSS takes no
 * fewer, and nothing along z for a move, in any unit, since a view has nowhere to go there.
 */
function onAView(name: string, args: readonly Argument[]): boolean {
  if (args.length !== 3) return false;
  if (name !== 'translate3d') return true;
  const z = args[2]!;
  return typeof z === 'object' ? z.__defer.factor === 0 : Number.parseFloat(String(z)) === 0;
}

/** The arguments in a function's body, split on whitespace and commas outside its brackets. */
function argumentsIn(body: string): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (const char of body) {
    if (depth === 0 && SEPARATOR.test(char)) {
      if (part) parts.push(part);
      part = '';
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') depth--;
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

/** Where the bracket closes that is open at `from`, or -1. */
function closing(text: string, from: number): number {
  let depth = 1;
  for (let at = from; at < text.length; at++) {
    if (text[at] === '(') depth++;
    else if (text[at] === ')' && --depth === 0) return at;
  }
  return -1;
}

/** Each function and its arguments, or undefined where anything else is in the value. */
function readCalls(
  value: string,
  read: (name: string, raw: string) => Argument | undefined = argument,
): { name: string; args: Argument[] }[] | undefined {
  const calls: { name: string; args: Argument[] }[] = [];
  const cursor = { text: value, at: 0 };
  for (;;) {
    match(cursor, SPACE);
    if (cursor.at === value.length) break;
    const found = match(cursor, CALL);
    const name = found && NAMES.get(found[1]!.toLowerCase());
    if (!name) return undefined;
    const end = closing(value, cursor.at);
    if (end === -1) return undefined;
    const raw = argumentsIn(value.slice(cursor.at, end));
    const args = raw.map((part) => read(name, part));
    if (!raw.length || args.includes(undefined)) return undefined;
    calls.push({ name, args: args as Argument[] });
    cursor.at = end + 1;
  }
  const flat = calls.every(({ name, args }) => !(name in THREE_D) || onAView(name, args));
  return calls.length && flat ? calls : undefined;
}

/** Whether an argument is a math function CSS refuses here: of no type, or not the function's. */
function refusedArgument(name: string, raw: string): boolean {
  if (mathRefused(raw)) return true;
  const math = MATH_FUNCTION.test(raw) ? mathValue(raw) : undefined;
  const slot = slotOf(name);
  return !!math && math.type !== slot && !(slot === 'length' && math.type === 'percentage');
}

/** Whether a math function in a transform's arguments is one CSS refuses. */
export function transformMathRefused(value: string): boolean {
  let refused = false;
  readCalls(value, (name, raw) => {
    refused ||= refusedArgument(name, raw);
    return argument(name, raw);
  });
  return refused;
}

/**
 * The list, or undefined for a value CSS cannot read, which a browser drops: the transform a rule
 * sets then applies instead.
 */
export function transformList(value: string): TransformEntry[] | undefined {
  const list = listOf(value);
  return list && !hasMeasured(list) ? (list as TransformEntry[]) : undefined;
}

const hasMeasured = (list: readonly object[]): boolean =>
  list.some((entry) =>
    Object.values(entry).some((value) => typeof value === 'object' && '__defer' in value),
  );

/** The list of a transform with a length to measure where it is used; undefined for any other. */
export function measuredTransform(value: string): readonly object[] | undefined {
  if (!MEASURED.test(value)) return undefined;
  const list = listOf(value);
  return list && hasMeasured(list) ? list : undefined;
}

function listOf(value: string): object[] | undefined {
  const out: object[] = [];
  if (value.replace(PADDED, '').toLowerCase() === 'none') return out;
  const calls = readCalls(value);
  if (!calls) return undefined;
  for (const { name, args } of calls) {
    const { axes, both } = axesOf(name, args.length);
    if (axes && both) {
      out.push({ [axes[0]]: args[0]! }, { [axes[1]]: args[1]! });
    } else if (axes && name !== 'scale') {
      // `translate(4px)` and `skew(10deg)` move along the first axis only; `scale(2)` is both,
      // which React Native spells as a key of its own and falls through to below.
      out.push({ [axes[0]]: args[0]! });
    } else if (name === 'matrix' && args.length === 6) {
      const [a, b, c, d, e, f] = args as number[];
      out.push({ matrix: [a!, b!, 0, 0, c!, d!, 0, 0, 0, 0, 1, 0, e!, f!, 0, 1] });
    } else if (name === 'matrix3d') {
      out.push({ matrix: args as number[] });
    } else {
      out.push({ [name!]: args[0]! });
    }
  }
  return out;
}
