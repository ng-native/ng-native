/**
 * A `calc()` a library binds as an inline style, worked out as far as it can be here: a sum of
 * percentages and pixels, with brackets and with numbers to multiply and divide by. A grid's
 * tile is `calc(((25% - 6px) * 3) + 16px)` wide. A stylesheet's is worked out when the app is
 * built; this is the same sum for one written as the app runs.
 *
 * The answer is a number of points, a percentage, or the one sum of the two a layout can be
 * given: `calc(75% + -2px)`. Nothing for anything else in it, a `var()` or another unit, which
 * is left as it was written.
 */
export function reduceCalc(value: string): number | string | undefined {
  const text = value.trim();
  if (!/^calc\(/i.test(text) || !text.endsWith(')')) return undefined;
  const tokens = text.slice(4).match(/-?(?:\d+\.?\d*|\.\d+)(?:px|%)?|[-+*/()]|\S+?/g) ?? [];
  const cursor = { tokens, at: 0 };
  const sum = readSum(cursor);
  if (!sum || cursor.at !== tokens.length) return undefined;
  const round = (part: number) => Math.round(part * 1e4) / 1e4;
  const [percent, points] = [round(sum[0]), round(sum[1])];
  if (!percent) return points;
  return points ? `calc(${percent}% + ${points}px)` : `${percent}%`;
}

/** A length as so much of what it is a share of, and so many points. */
type Length = [percent: number, points: number, unitless?: true];
interface Cursor {
  readonly tokens: readonly string[];
  at: number;
}

function readSum(cursor: Cursor): Length | undefined {
  let total = readProduct(cursor);
  while (total && (cursor.tokens[cursor.at] === '+' || cursor.tokens[cursor.at] === '-')) {
    const sign = cursor.tokens[cursor.at++] === '+' ? 1 : -1;
    const next = readProduct(cursor);
    // A number and a length do not add up.
    if (!next || !!next[2] !== !!total[2]) return undefined;
    total = [total[0] + sign * next[0], total[1] + sign * next[1], total[2]];
  }
  return total;
}

function readProduct(cursor: Cursor): Length | undefined {
  let total = readTerm(cursor);
  while (total && (cursor.tokens[cursor.at] === '*' || cursor.tokens[cursor.at] === '/')) {
    const divide = cursor.tokens[cursor.at++] === '/';
    const next = readTerm(cursor);
    if (!next) return undefined;
    // One side is a plain number: a length is not multiplied by a length, nor divided into one.
    const [length, by] = next[2] ? [total, next[1]] : [next, total[1]];
    if (!(next[2] || (total[2] && !divide)) || (divide && by === 0)) return undefined;
    const factor = divide ? 1 / by : by;
    total = [length[0] * factor, length[1] * factor, length[2]];
  }
  return total;
}

function readTerm(cursor: Cursor): Length | undefined {
  const token = cursor.tokens[cursor.at++];
  if (token === '(') {
    const inner = readSum(cursor);
    return cursor.tokens[cursor.at++] === ')' ? inner : undefined;
  }
  const number = /^(-?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(token ?? '');
  if (!number) return undefined;
  const amount = Number(number[1]);
  if (number[2] === '%') return [amount, 0];
  return number[2] === 'px' ? [0, amount] : [0, amount, true];
}
