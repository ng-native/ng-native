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
 * is widened to the sixteen values native wants.
 */
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
const SPACE = /^[ \t\n\r\f]*$/;
const PADDED = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;
const FUNCTIONS = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
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

function argument(raw: string): number | string {
  return PX.test(raw) ? parseFloat(raw) : raw;
}

/** Each function and its arguments, or undefined where anything else is in the value. */
function readCalls(value: string): { name: string; raw: string[] }[] | undefined {
  const calls = [...value.matchAll(FUNCTIONS)].map(([, name, body]) => ({
    name: NAMES.get(name!.toLowerCase())!,
    raw: body!.split(/[ \t\n\r\f,]+/).filter(Boolean),
  }));
  // Functions native has, CSS whitespace between them and nothing else, and arguments CSS reads.
  const readable =
    calls.length &&
    SPACE.test(value.replace(FUNCTIONS, '')) &&
    calls.every(({ name, raw }) => name && raw.length && raw.every((arg) => ARGUMENT.test(arg)));
  // Along z a view has nowhere to go: not a transform it can have, as in a stylesheet.
  const flat = calls.every(
    ({ name, raw }) => name !== 'translate3d' || Number(argument(raw[2]!)) === 0,
  );
  return readable && flat ? calls : undefined;
}

/**
 * The list, or undefined for a value CSS cannot read, which a browser drops: the transform a rule
 * sets then applies instead.
 */
export function transformList(value: string): TransformEntry[] | undefined {
  const out: TransformEntry[] = [];
  if (value.replace(PADDED, '').toLowerCase() === 'none') return out;
  const calls = readCalls(value);
  if (!calls) return undefined;
  for (const { name, raw } of calls) {
    const args = raw.map(argument);
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
