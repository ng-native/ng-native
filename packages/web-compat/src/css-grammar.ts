import { tokenize, type Token } from './css-tokens.ts';
import { serializeTokens } from './css-value.ts';
import { isColour } from './css-colour-names.ts';

/**
 * What a property's value is checked against: its grammar, written as the specs write one
 * (https://drafts.csswg.org/css-values-4/#value-defs), `auto | <length-percentage>`, and read
 * here into something a value's parts are matched with.
 *
 * ponytail: the grammar's combinators and multipliers, and the basic types by their tokens. A
 * math function is taken for any number, length, percentage, angle or time, and is not looked
 * into; a function a grammar names with nothing in its brackets, `fit-content()`, takes any
 * arguments.
 */

/** One part of a value: a token, or a function or a bracket with all that is in it. */
export interface Part {
  readonly token: Token;
  /** What is inside a function or a bracket, without its closing bracket. */
  readonly inner?: readonly Token[];
}

/** A value's text as its parts: what is between spaces, a comma, or a `/`, each one part. */
export function partsOf(text: string): Part[] {
  const tokens = tokenize(text);
  const parts: Part[] = [];
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!;
    if (token.type === 'whitespace') continue;
    if (token.type !== 'function' && token.type !== '(' && token.type !== '[') {
      parts.push({ token });
      continue;
    }
    const end = closing(tokens, at);
    parts.push({ token, inner: tokens.slice(at + 1, end) });
    at = end;
  }
  return parts;
}

/** Where the bracket a token opens is closed, or the end. */
function closing(tokens: readonly Token[], from: number): number {
  let depth = 0;
  for (let at = from; at < tokens.length; at++) {
    const type = tokens[at]!.type;
    if (type === 'function' || type === '(' || type === '[') depth++;
    else if ((type === ')' || type === ']') && --depth === 0) return at;
  }
  return tokens.length;
}

const CLOSE: Partial<Record<Token['type'], Token>> = {
  function: { type: ')' },
  '(': { type: ')' },
  '[': { type: ']' },
};

/** A part's tokens, as written back. */
export const tokensOf = (part: Part): Token[] =>
  part.inner ? [part.token, ...part.inner, CLOSE[part.token.type]!] : [part.token];

/** Parts written back as one value: one space between them, and none before a comma. */
export const serializeParts = (parts: readonly Part[]): string =>
  serializeTokens(
    parts.flatMap((part, at) => [
      ...(at ? [{ type: 'whitespace' } as Token] : []),
      ...tokensOf(part),
    ]),
  );

const LENGTHS = new Set([
  ...['px', 'em', 'rem', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh'],
  ...['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh'],
  ...['svi', 'svb', 'lvi', 'lvb', 'dvi', 'dvb', 'svmin', 'svmax', 'lvmin', 'lvmax'],
  ...['dvmin', 'dvmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'],
  ...['cm', 'mm', 'q', 'in', 'pt', 'pc'],
]);
const ANGLES = new Set(['deg', 'grad', 'rad', 'turn']);
const TIMES = new Set(['s', 'ms']);
const RESOLUTIONS = new Set(['dpi', 'dpcm', 'dppx', 'x']);
const FLEXES = new Set(['fr']);
const MATH = new Set([
  ...['calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign', 'sin', 'cos'],
  ...['tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt', 'hypot', 'log', 'exp'],
  ...['calc-size', 'progress', 'random', 'sibling-index', 'sibling-count', 'anchor', 'anchor-size'],
]);

const nameOf = (part: Part): string =>
  'value' in part.token && typeof part.token.value === 'string'
    ? part.token.value.toLowerCase()
    : '';
const isMath = (part: Part): boolean => part.token.type === 'function' && MATH.has(nameOf(part));
const unit = (part: Part): string =>
  part.token.type === 'dimension' ? part.token.unit.toLowerCase() : '';
const numberOf = (part: Part): number | undefined =>
  part.token.type === 'number' ||
  part.token.type === 'dimension' ||
  part.token.type === 'percentage'
    ? part.token.value
    : undefined;
const nonNegative = (part: Part): boolean => isMath(part) || (numberOf(part) ?? 0) >= 0;

const isLength = (part: Part): boolean =>
  isMath(part) ||
  (part.token.type === 'dimension' && LENGTHS.has(unit(part))) ||
  (part.token.type === 'number' && part.token.value === 0);
const isPercentage = (part: Part): boolean => isMath(part) || part.token.type === 'percentage';
const isNumber = (part: Part): boolean => isMath(part) || part.token.type === 'number';
const isInteger = (part: Part): boolean =>
  isMath(part) || (part.token.type === 'number' && part.token.integer);
const withUnit =
  (units: ReadonlySet<string>, zero = false) =>
  (part: Part): boolean =>
    isMath(part) ||
    (part.token.type === 'dimension' && units.has(unit(part))) ||
    (zero && part.token.type === 'number' && part.token.value === 0);

const IMAGES = new Set([
  ...['url', 'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient'],
  ...['repeating-radial-gradient', 'repeating-conic-gradient', 'image-set', '-webkit-image-set'],
  ...['cross-fade', 'element', 'image', 'paint', '-webkit-gradient', '-webkit-linear-gradient'],
  ...['-webkit-radial-gradient', '-webkit-repeating-linear-gradient', 'light-dark'],
  ...['-webkit-repeating-radial-gradient', '-webkit-cross-fade'],
]);

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);

/** The basic types, each by what one part of a value it takes. */
const TYPES: Readonly<Record<string, (part: Part) => boolean>> = {
  length: isLength,
  'length-percentage': (part) => isLength(part) || isPercentage(part),
  'nn-length': (part) => isLength(part) && nonNegative(part),
  'nn-length-percentage': (part) => (isLength(part) || isPercentage(part)) && nonNegative(part),
  percentage: isPercentage,
  number: isNumber,
  'nn-number': (part) => isNumber(part) && nonNegative(part),
  'number-percentage': (part) => isNumber(part) || isPercentage(part),
  'nn-number-percentage': (part) => (isNumber(part) || isPercentage(part)) && nonNegative(part),
  integer: isInteger,
  'nn-integer': (part) => isInteger(part) && nonNegative(part),
  'positive-integer': (part) => isMath(part) || (isInteger(part) && (numberOf(part) ?? 0) >= 1),
  angle: withUnit(ANGLES, true),
  time: withUnit(TIMES),
  'nn-time': (part) => withUnit(TIMES)(part) && nonNegative(part),
  resolution: withUnit(RESOLUTIONS),
  flex: withUnit(FLEXES),
  color: (part) => isColour(part),
  image: (part) =>
    part.token.type === 'url' || (part.token.type === 'function' && IMAGES.has(nameOf(part))),
  url: (part) =>
    part.token.type === 'url' || (part.token.type === 'function' && nameOf(part) === 'url'),
  string: (part) => part.token.type === 'string',
  'custom-ident': (part) => part.token.type === 'ident' && !CSS_WIDE.has(nameOf(part)),
  'dashed-ident': (part) => part.token.type === 'ident' && nameOf(part).startsWith('--'),
  ident: (part) => part.token.type === 'ident',
  'any-function': (part) => part.token.type === 'function',
  any: () => true,
};

type Node =
  | { readonly kind: 'keyword'; readonly word: string }
  | { readonly kind: 'type'; readonly name: string }
  | { readonly kind: 'mark'; readonly mark: 'comma' | '/' }
  | { readonly kind: 'function'; readonly name: string; readonly args?: Node }
  | { readonly kind: 'seq' | 'alt' | 'any-order' | 'all'; readonly of: readonly Node[] }
  | {
      readonly kind: 'repeat';
      readonly of: Node;
      readonly min: number;
      readonly max: number;
      readonly commas: boolean;
    };

/** The words of a grammar: names, brackets, combinators and multipliers. */
const WORD =
  /\|\||&&|\||\[|\]|<[^>]+>|[a-zA-Z_-][\w-]*\(|\)|\{\d+(?:,\d*)?\}|[?*+#,/]|[^\s|[\]<>(){}?*+#,/]+/g;

/** Reads the text of a grammar into what values are matched with. */
class Grammar {
  private at = 0;
  private readonly words: string[];

  constructor(text: string) {
    this.words = text.match(WORD) ?? [];
  }

  read(): Node {
    const node = this.alt();
    if (this.at < this.words.length) throw new Error(`'${this.words[this.at]}' is not read.`);
    return node;
  }

  private joined(kind: 'alt' | 'any-order' | 'all', by: string, next: () => Node): Node {
    const of = [next()];
    while (this.words[this.at] === by) {
      this.at++;
      of.push(next());
    }
    return of.length === 1 ? of[0]! : { kind, of };
  }

  private alt(): Node {
    return this.joined('alt', '|', () => this.anyOrder());
  }
  private anyOrder(): Node {
    return this.joined('any-order', '||', () => this.all());
  }
  private all(): Node {
    return this.joined('all', '&&', () => this.seq());
  }
  private seq(): Node {
    const of: Node[] = [];
    while (
      this.at < this.words.length &&
      !['|', '||', '&&', ']', ')'].includes(this.words[this.at]!)
    ) {
      of.push(this.multiplied(this.atom()));
    }
    return of.length === 1 ? of[0]! : { kind: 'seq', of };
  }

  private atom(): Node {
    const word = this.words[this.at++]!;
    if (word === '[') {
      const inner = this.alt();
      this.at++;
      return inner;
    }
    if (word.endsWith('(')) {
      const name = word.slice(0, -1).toLowerCase();
      if (this.words[this.at] === ')') {
        this.at++;
        return { kind: 'function', name };
      }
      const args = this.alt();
      this.at++;
      return { kind: 'function', name, args };
    }
    if (word.startsWith('<')) return { kind: 'type', name: word.slice(1, -1) };
    if (word === ',') return { kind: 'mark', mark: 'comma' };
    if (word === '/') return { kind: 'mark', mark: '/' };
    return { kind: 'keyword', word: word.toLowerCase() };
  }

  private multiplied(node: Node): Node {
    const word = this.words[this.at];
    const bounds = word && MULTIPLIERS[word];
    if (bounds) {
      this.at++;
      return this.multiplied({ kind: 'repeat', of: node, ...bounds, commas: word === '#' });
    }
    const [, min, comma, max] = /^\{(\d+)(,?)(\d*)\}$/.exec(word ?? '') ?? [];
    if (min === undefined) return node;
    this.at++;
    const most = comma ? (max ? Number(max) : Infinity) : Number(min);
    return { kind: 'repeat', of: node, min: Number(min), max: most, commas: false };
  }
}

const MULTIPLIERS: Readonly<Record<string, { min: number; max: number }>> = {
  '?': { min: 0, max: 1 },
  '*': { min: 0, max: Infinity },
  '+': { min: 1, max: Infinity },
  '#': { min: 1, max: Infinity },
};

/** Grammars by name, each read once: a property's, and those a `<name>` refers to. */
const named = new Map<string, Node>();
const sources = new Map<string, string>();

/** Say what grammars there are, each by the name a `<name>` in another refers to it by. */
export function defineGrammars(grammars: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(grammars)) {
    sources.set(name, text);
    named.delete(name);
  }
}

function grammarNamed(name: string): Node | undefined {
  const had = named.get(name);
  if (had) return had;
  const text = sources.get(name);
  if (text === undefined) return undefined;
  const node = new Grammar(text).read();
  named.set(name, node);
  return node;
}

type Ends = Set<number>;

/** Where a node can end matching from a place in a value's parts: none where it does not. */
function match(node: Node, parts: readonly Part[], from: number): Ends {
  switch (node.kind) {
    case 'keyword':
      return one(parts[from]?.token.type === 'ident' && nameOf(parts[from]!) === node.word, from);
    case 'mark':
      return one(isMark(parts[from], node.mark), from);
    case 'type':
      return matchType(node.name, parts, from);
    case 'function':
      return one(matchFunction(node, parts[from]), from);
    case 'seq':
      return node.of.reduce<Ends>(
        (ends, each) => after(ends, (at) => match(each, parts, at)),
        new Set([from]),
      );
    case 'alt':
      return new Set(node.of.flatMap((each) => [...match(each, parts, from)]));
    case 'any-order':
      return matchAnyOrder(node.of, parts, from, false);
    case 'all':
      return matchAnyOrder(node.of, parts, from, true);
    case 'repeat':
      return matchRepeat(node, parts, from);
  }
}

const one = (matches: boolean, from: number): Ends => new Set(matches ? [from + 1] : []);

const isMark = (part: Part | undefined, mark: 'comma' | '/'): boolean =>
  mark === 'comma'
    ? part?.token.type === 'comma'
    : part?.token.type === 'delim' && part.token.value === '/';

function matchType(name: string, parts: readonly Part[], from: number): Ends {
  const basic = TYPES[name];
  if (basic) return one(!!parts[from] && basic(parts[from]!), from);
  const grammar = grammarNamed(name);
  return grammar ? match(grammar, parts, from) : new Set();
}

function matchFunction(node: Node & { kind: 'function' }, part: Part | undefined): boolean {
  if (part?.token.type !== 'function' || nameOf(part) !== node.name) return false;
  if (!node.args) return true;
  const inner = partsOf(serializeTokens(part.inner ?? []));
  return match(node.args, inner, 0).has(inner.length);
}

function after(ends: Ends, next: (at: number) => Ends): Ends {
  const out: Ends = new Set();
  for (const end of ends) for (const each of next(end)) out.add(each);
  return out;
}

/** `a || b`: each at most once, in any order, and one at least; `a && b`: each once. */
function matchAnyOrder(
  of: readonly Node[],
  parts: readonly Part[],
  from: number,
  every: boolean,
): Ends {
  const out: Ends = new Set();
  const walk = (at: number, used: number): void => {
    const all = used === (1 << of.length) - 1;
    if (used && (!every || all)) out.add(at);
    if (all) return;
    of.forEach((each, index) => {
      if (used & (1 << index)) return;
      // One that matches nothing, `fill?`, is used up all the same, so the walk ends.
      for (const end of match(each, parts, at)) walk(end, used | (1 << index));
    });
  };
  walk(from, 0);
  return out;
}

function matchRepeat(node: Node & { kind: 'repeat' }, parts: readonly Part[], from: number): Ends {
  const out: Ends = new Set();
  let now: Ends = new Set([from]);
  if (node.min === 0) out.add(from);
  for (let count = 1; count <= node.max && now.size; count++) {
    const next = after(now, (at) => {
      const start = count > 1 && node.commas ? (isMark(parts[at], 'comma') ? at + 1 : -1) : at;
      return start < 0 ? new Set() : match(node.of, parts, start);
    });
    // A part that matched nothing more is not counted again, or `<x>*` would never end.
    now = new Set([...next].filter((end) => ![...now].includes(end)));
    if (count >= node.min) for (const end of now) out.add(end);
  }
  return out;
}

/** Whether a value's parts are, as a whole, what a grammar says. */
export function matchesGrammar(grammar: string, parts: readonly Part[]): boolean {
  const node = grammarNamed(grammar) ?? new Grammar(grammar).read();
  return match(node, parts, 0).has(parts.length);
}

/** Whether a value's text is, as a whole, what a grammar says. */
export const valueMatches = (grammar: string, text: string): boolean =>
  matchesGrammar(grammar, partsOf(text));

/** Whether a grammar by that name is known. */
export const hasGrammar = (name: string): boolean => sources.has(name);
