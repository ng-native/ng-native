/**
 * A `calc()`, `min()` or `max()` of tokens bound as a style while the app runs, read into the
 * tree the compiler writes for the same sum in a stylesheet (`{ __calc }`), which the cascade
 * works out where the tokens are known. Taiga UI sizes a field's text by
 * `el.style.fontSize = 'calc(1.25rem + var(--tui-font-offset))'`; kept as text, native was sent a
 * string, which Android's text field refuses.
 *
 * Read: numbers, `px`, `rem` of sixteen points, `em`, viewport units and percentages, `var()` as
 * a length or a number, as what it is joined to reads it, with a fallback of either, `+ - * /`,
 * brackets and nested `calc()`, `min()` and `max()` of two or more. Anything else is no sum here,
 * and the value is left as it was.
 */

type Expression =
  | number
  | { readonly relative: { readonly unit: string; readonly factor: number } }
  | { readonly reference: string; readonly fallback?: Expression }
  | readonly ['+' | '-' | '*' | '/' | 'max' | 'min', Expression, Expression];

const ROOT_FONT = 16;
const RELATIVE = new Set(['em', 'vw', 'vh', 'vmin', 'vmax', '%']);
// CSS white space, which U+00A0 is not.
const TOKENS =
  /[ \t\n\r\f]*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)?|var\([ \t\n\r\f]*--[\w-]+|calc\(|min\(|max\(|[-+*/(),])/iy;

/** The tree a bound sum of tokens is, or nothing for a value that is not one. */
export function boundCalc(text: string): Expression | undefined {
  if (!/^[ \t\n\r\f]*(?:calc|min|max)\(/i.test(text) || !/var\(/i.test(text)) return undefined;
  const tokens: string[] = [];
  let end = 0;
  TOKENS.lastIndex = 0;
  for (let match = TOKENS.exec(text); match; match = TOKENS.exec(text)) {
    tokens.push(match[1]!);
    end = TOKENS.lastIndex;
  }
  // What no token reads is no sum: a unit or a function this does not know.
  if (!/^[ \t\n\r\f]*$/.test(text.slice(end))) return undefined;
  const cursor = { tokens, at: 0 };
  const read = term(cursor);
  // A length, as a stylesheet's compiler types the same sum: a number added to one is none.
  if (!read || read.type === 'number' || cursor.at !== tokens.length) return undefined;
  return read.tree;
}

/**
 * A part read, and what it comes to: a length, a number, or `token`, a part with a token in it
 * that is either, as what it is joined to makes it: `var(--n) * 1px` reads `--n` as a number.
 */
interface Typed {
  readonly tree: Expression;
  readonly type: 'length' | 'number' | 'token';
}

interface Cursor {
  readonly tokens: readonly string[];
  at: number;
}

const peek = (cursor: Cursor) => cursor.tokens[cursor.at];

/** Two parts joined by `op`, typed as CSS types it, or nothing for a mix CSS has no type for. */
function joined(op: '+' | '-' | '*' | '/' | 'max' | 'min', a: Typed, b: Typed): Typed | undefined {
  let type: Typed['type'] | undefined;
  if (op === '*') type = productType(a.type, b.type);
  else if (op === '/') type = b.type === 'length' ? undefined : a.type;
  else if (a.type === 'token' || b.type === 'token') type = a.type === 'token' ? b.type : a.type;
  else type = a.type === b.type ? a.type : undefined;
  return type && { tree: [op, a.tree, b.tree], type };
}

/** What a product is: a length by a length is none, and a token by a number may be either. */
function productType(a: Typed['type'], b: Typed['type']): Typed['type'] | undefined {
  if (a === 'length') return b === 'length' ? undefined : 'length';
  return b === 'length' || b === 'token' ? b : a;
}

function sum(cursor: Cursor): Typed | undefined {
  let left = product(cursor);
  while (left && (peek(cursor) === '+' || peek(cursor) === '-')) {
    const op = cursor.tokens[cursor.at++] as '+' | '-';
    const right = product(cursor);
    left = right && joined(op, left, right);
  }
  return left;
}

function product(cursor: Cursor): Typed | undefined {
  let left = term(cursor);
  while (left && (peek(cursor) === '*' || peek(cursor) === '/')) {
    const op = cursor.tokens[cursor.at++] as '*' | '/';
    const right = term(cursor);
    left = right && joined(op, left, right);
  }
  return left;
}

function term(cursor: Cursor): Typed | undefined {
  const token = cursor.tokens[cursor.at++];
  if (token === undefined) return undefined;
  const lower = token.toLowerCase();
  if (token === '(' || lower === 'calc(') return closed(cursor, sum(cursor));
  if (lower === 'min(' || lower === 'max(') return compared(cursor, lower.slice(0, 3) as 'min');
  if (lower.startsWith('var(')) return reference(cursor, token.slice(4).trim());
  return literal(token);
}

/** What was read, where a `)` closes it. */
function closed(cursor: Cursor, inside: Typed | undefined): Typed | undefined {
  return inside && cursor.tokens[cursor.at++] === ')' ? inside : undefined;
}

function compared(cursor: Cursor, op: 'min' | 'max'): Typed | undefined {
  let read = sum(cursor);
  while (read && peek(cursor) === ',') {
    cursor.at++;
    const next = sum(cursor);
    read = next && joined(op, read, next);
  }
  return closed(cursor, read);
}

/** A token, a length or a number as what it is joined to reads it, as a stylesheet's is. */
function reference(cursor: Cursor, name: string): Typed | undefined {
  if (peek(cursor) !== ',') return closed(cursor, { tree: { reference: name }, type: 'token' });
  cursor.at++;
  const fallback = sum(cursor);
  if (!fallback) return undefined;
  return closed(cursor, { tree: { reference: name, fallback: fallback.tree }, type: 'token' });
}

function literal(token: string): Typed | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]+|%)?$/i.exec(token);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === undefined) return { tree: value, type: 'number' };
  if (unit === 'px') return { tree: value, type: 'length' };
  if (unit === 'rem') return { tree: value * ROOT_FONT, type: 'length' };
  if (!RELATIVE.has(unit)) return undefined;
  return { tree: { relative: { unit, factor: value } }, type: 'length' };
}
