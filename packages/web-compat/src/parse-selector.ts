import { domError } from './dom-error.ts';
import { tokenizeWritten, type Token } from './css-tokens.ts';
import { serializeTokens } from './css-value.ts';

/**
 * A selector list read as Selectors Level 4 has it (https://drafts.csswg.org/selectors-4/), over
 * the tokens of CSS Syntax: what `querySelector`, `matches` and `closest` are given. One it cannot
 * read is a `SyntaxError`, as a browser throws, never a selector that matches nothing.
 */

export type Combinator = ' ' | '>' | '+' | '~';

/**
 * The namespace a name is asked in: `undefined` where none is written (any, for an element; none,
 * for an attribute), `'*'` for any, `null` for none (`|a`), or the namespace a prefix stands for.
 */
export type Namespace = string | null | undefined;

export type AttributeOperator = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

export interface Nth {
  readonly a: number;
  readonly b: number;
  /** `of S`: only the siblings that match `S` are counted. */
  readonly of?: readonly Complex[];
}

export type Simple =
  | { readonly kind: 'type'; readonly namespace: Namespace; readonly name: string }
  | { readonly kind: 'id' | 'class'; readonly name: string }
  | {
      readonly kind: 'attribute';
      readonly namespace: Namespace;
      readonly name: string;
      readonly operator?: AttributeOperator;
      readonly value?: string;
      readonly flag?: 'i' | 's';
    }
  | { readonly kind: 'pseudo-class'; readonly name: string; readonly argument?: Argument }
  | {
      readonly kind: 'pseudo-element';
      readonly name: string;
      /** A functional one's argument, as it is written back: `::part(foo bar)`. */
      readonly argument?: string;
    };

/** What a functional pseudo-class is given. */
export type Argument =
  | {
      readonly kind: 'selectors';
      readonly list: readonly Complex[];
      /**
       * A forgiving list's parts in order, those it could not read as their text: they match
       * nothing, and are written back as they were.
       */
      readonly parts?: readonly (Complex | string)[];
    }
  | { readonly kind: 'nth'; readonly nth: Nth }
  | {
      readonly kind: 'words';
      readonly words: readonly string[];
      /** The words as they are written back, a string still a string. */
      readonly written: string;
    }
  | { readonly kind: 'numbers'; readonly numbers: readonly number[] };

/** A run of simple selectors with no combinator between: `a.b[c]:d`. */
export type Compound = readonly Simple[];

export interface Complex {
  readonly compounds: readonly Compound[];
  /** Between compounds: `combinators[i]` joins `compounds[i]` to `compounds[i + 1]`. */
  readonly combinators: readonly Combinator[];
  /** In `:has()`, the combinator the selector starts with, relative to the element asked. */
  readonly leading?: Combinator;
}

/** What a pseudo-class takes: nothing, or one of the arguments below. */
type Takes = 'forgiving' | 'complex' | 'compound' | 'relative' | 'nth' | 'nth-of';
type TakesWords = 'ident' | 'lang' | 'levels';

/**
 * The pseudo-classes read, as Chrome reads them: one it does not (`:blank`, `:local-link`) is a
 * `SyntaxError` here too, which a library feature-tests for. A name may also be a function.
 */
const PLAIN = new Set([
  ...['root', 'empty', 'scope', 'first-child', 'last-child', 'only-child'],
  ...['first-of-type', 'last-of-type', 'only-of-type'],
  ...['hover', 'active', 'focus', 'focus-visible', 'focus-within', 'target'],
  ...['link', 'any-link', '-webkit-any-link', 'visited'],
  ...['enabled', 'disabled', 'checked', 'indeterminate', 'default', 'required', 'optional'],
  ...['read-only', 'read-write', 'placeholder-shown', 'valid', 'invalid', 'user-valid'],
  ...['user-invalid', 'in-range', 'out-of-range', 'autofill', '-webkit-autofill'],
  ...['defined', 'heading', 'open', 'modal', 'popover-open', 'fullscreen', '-webkit-full-screen'],
  ...['picture-in-picture', 'playing', 'paused', 'seeking', 'buffering', 'stalled', 'muted'],
  ...['volume-locked', 'host', 'past', 'current', 'future', 'has-slotted', 'xr-overlay'],
]);
const FUNCTIONS: Readonly<Record<string, Takes | TakesWords>> = {
  is: 'forgiving',
  where: 'forgiving',
  not: 'complex',
  has: 'relative',
  'nth-child': 'nth-of',
  'nth-last-child': 'nth-of',
  'nth-of-type': 'nth',
  'nth-last-of-type': 'nth',
  host: 'compound',
  'host-context': 'compound',
  current: 'forgiving',
  lang: 'lang',
  dir: 'ident',
  state: 'ident',
  heading: 'levels',
};

/** Pseudo-elements. A `-webkit-` one is read whatever it is called, as Chrome reads one. */
const ELEMENTS = new Set([
  ...['before', 'after', 'first-line', 'first-letter', 'marker', 'placeholder', 'selection'],
  ...['backdrop', 'file-selector-button', 'grammar-error', 'spelling-error', 'target-text'],
  ...['cue', 'cue-region', 'details-content', 'checkmark', 'picker-icon', 'scroll-marker'],
  ...['scroll-marker-group', 'column', 'view-transition', 'search-text'],
]);
const ELEMENT_FUNCTIONS = new Set([
  ...['part', 'slotted', 'highlight', 'picker', 'scroll-button', 'cue', 'cue-region'],
  ...['view-transition-group', 'view-transition-image-pair', 'view-transition-old'],
  'view-transition-new',
]);
/** Whether a pseudo-element can be after another: `::part(x)::before`, `::before::marker`. */
const nests = (first: string, second: string): boolean =>
  first === 'part' || ((first === 'before' || first === 'after') && second === 'marker');

/** The pseudo-elements CSS 2 wrote with one colon, which are still read so. */
const LEGACY = new Set(['before', 'after', 'first-line', 'first-letter']);

const invalid = (text: string): Error =>
  domError(`'${text}' is not a valid selector.`, 'SyntaxError');

/** Thrown inside the parser, and turned into the `SyntaxError` a caller sees. */
class Unreadable extends Error {}
const fail = (): never => {
  throw new Unreadable();
};

const lower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The tokens between an opening one and the one that closes it, as a function's argument. */
function block(tokens: readonly Token[], from: number): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    const type = tokens[i]!.type;
    if (type === '(' || type === 'function' || type === '[') depth++;
    else if (type === ')' || type === ']') depth--;
    if (depth === 0) return i;
  }
  return tokens.length;
}

/** Where a selector is read: the namespace prefixes it may use. */
export interface ParseContext {
  /** By prefix, and `''` for the default namespace. None but `*` without one. */
  readonly namespaces?: ReadonlyMap<string, string>;
  /** The text a run of the tokens was written as, which a part read as none is written back as. */
  readonly written?: (from: number, to: number) => string;
}

/**
 * Where tokens are read: at the top, where a pseudo-element is; in a `:has()`, where another is
 * not; in `:host()`, where only a compound is; or after a pseudo-element, where only a
 * pseudo-class is.
 */
interface Nesting {
  readonly top: boolean;
  readonly has: boolean;
  readonly compound: boolean;
  readonly pseudo: boolean;
}
const TOP: Nesting = { top: true, has: false, compound: false, pseudo: false };

/** The pseudo-classes of what a user does, which are all that follow most pseudo-elements. */
const USER_ACTION = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within']);
/** The pseudo-classes of a place in a tree, which nothing after a `::part()` has. */
const STRUCTURAL = new Set([
  ...['root', 'empty', 'first-child', 'last-child', 'only-child'],
  ...['first-of-type', 'last-of-type', 'only-of-type'],
]);

/** Reads the tokens of one selector list, or of one argument of a pseudo-class. */
class Parser {
  private i: number;
  private readonly tokens: readonly Token[];
  private readonly end: number;
  private readonly context: ParseContext;
  /** Where the tokens are, and so what is read in them. */
  private readonly nesting: Nesting;

  constructor(
    tokens: readonly Token[],
    from: number,
    end: number,
    context: ParseContext,
    nesting: Nesting,
  ) {
    this.tokens = tokens;
    this.i = from;
    this.end = end;
    this.context = context;
    this.nesting = nesting;
  }

  private peek(ahead = 0): Token | undefined {
    const at = this.i + ahead;
    return at < this.end ? this.tokens[at] : undefined;
  }

  private isDelim(value: string, ahead = 0): boolean {
    const token = this.peek(ahead);
    return token?.type === 'delim' && token.value === value;
  }

  private spaces(): boolean {
    const from = this.i;
    while (this.peek()?.type === 'whitespace') this.i++;
    return this.i > from;
  }

  done(): boolean {
    this.spaces();
    return this.i >= this.end;
  }

  /** A comma-separated list, each part read by `read`, with nothing left over. */
  list<T>(read: () => T): T[] {
    const out = [read()];
    this.spaces();
    while (this.peek()?.type === 'comma') {
      this.i++;
      out.push(read());
      this.spaces();
    }
    if (this.i < this.end) fail();
    return out;
  }

  /** Each part of a list on its own, those that cannot be read left out: `:is()`, `:where()`. */
  forgiving(): { list: Complex[]; parts: (Complex | string)[] } {
    const out: Complex[] = [];
    const parts: (Complex | string)[] = [];
    let from = this.i;
    for (let i = this.i; i <= this.end; i++) {
      const token = this.tokens[i];
      if (i < this.end && token!.type !== 'comma') {
        if (token!.type === '(' || token!.type === 'function' || token!.type === '[') {
          // One the end of the argument leaves open is that part's to refuse.
          i = Math.min(block(this.tokens, i), this.end - 1);
        }
        continue;
      }
      const complex = this.forgivenPart(from, i);
      if (typeof complex !== 'string') out.push(complex);
      parts.push(complex);
      from = i + 1;
    }
    this.i = this.end;
    return { list: out, parts };
  }

  /** One part of a forgiving list, or the text it was written as where it cannot be read. */
  private forgivenPart(from: number, to: number): Complex | string {
    const part = new Parser(this.tokens, from, to, this.context, this.nesting);
    try {
      part.spaces();
      const complex = part.complex();
      if (part.done()) return complex;
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
    }
    return this.context.written?.(from, to).trim() ?? serializeTokens(this.tokens.slice(from, to));
  }

  complex(relative = false): Complex {
    this.spaces();
    const leading = relative ? (this.combinator() ?? ' ') : undefined;
    const compounds = [this.compound()];
    const combinators: Combinator[] = [];
    for (;;) {
      const combinator = this.combinator();
      if (!combinator) break;
      // Nothing comes after a pseudo-element, and in `:host()` there is one compound.
      if (compounds.at(-1)!.some((simple) => simple.kind === 'pseudo-element')) fail();
      if (this.nesting.compound) fail();
      combinators.push(combinator);
      compounds.push(this.compound());
    }
    return leading ? { compounds, combinators, leading } : { compounds, combinators };
  }

  /** A combinator, with any space around it, or nothing at the end of a selector. */
  private combinator(): Combinator | undefined {
    const spaced = this.spaces();
    const token = this.peek();
    if (!token || token.type === 'comma') return undefined;
    if (
      token.type === 'delim' &&
      (token.value === '>' || token.value === '+' || token.value === '~')
    ) {
      this.i++;
      this.spaces();
      return token.value;
    }
    // `||`, the column combinator, is not read.
    return spaced ? ' ' : undefined;
  }

  compound(): Compound {
    const out: Simple[] = [];
    const type = this.typeSelector();
    if (type && this.nesting.pseudo) fail();
    if (type) out.push(type);
    let element: string | undefined;
    for (;;) {
      const simple = this.simple(element);
      if (!simple) break;
      if (simple.kind === 'pseudo-element') {
        // One after another only where the first is a part, or the second a marker of one.
        if (element !== undefined && !nests(element, simple.name)) fail();
        element = simple.name;
      }
      out.push(simple);
    }
    if (!out.length) fail();
    return out;
  }

  /** `a`, `*`, `ns|a`, `*|*`, `|a`, or nothing. */
  private typeSelector(): Simple | undefined {
    const first = this.peek();
    const name = (token: Token | undefined) =>
      token?.type === 'ident'
        ? token.value
        : token?.type === 'delim' && token.value === '*'
          ? '*'
          : undefined;
    if (this.isDelim('|')) {
      this.i++;
      const local = name(this.peek()) ?? fail();
      this.i++;
      return { kind: 'type', namespace: null, name: local };
    }
    const written = name(first);
    if (written === undefined) return undefined;
    if (this.isDelim('|', 1) && name(this.peek(2)) !== undefined) {
      const local = name(this.peek(2))!;
      this.i += 3;
      return { kind: 'type', namespace: this.namespace(written), name: local };
    }
    this.i++;
    return { kind: 'type', namespace: this.defaultNamespace(), name: written };
  }

  private namespace(prefix: string): Namespace {
    if (prefix === '*') return '*';
    return this.context.namespaces?.get(prefix) ?? fail();
  }

  private defaultNamespace(): Namespace {
    return this.context.namespaces?.get('');
  }

  private simple(afterElement: string | undefined): Simple | undefined {
    const token = this.peek();
    if (!token) return undefined;
    if (token.type === 'colon') return this.pseudo(afterElement);
    const simple =
      token.type === 'hash'
        ? this.id(token.id, token.value)
        : token.type === '['
          ? this.attribute()
          : this.isDelim('.')
            ? this.className()
            : undefined;
    // After a pseudo-element, only a pseudo-class or another pseudo-element.
    if (simple && (afterElement !== undefined || this.nesting.pseudo)) fail();
    return simple;
  }

  private id(valid: boolean, name: string): Simple {
    if (!valid) fail();
    this.i++;
    return { kind: 'id', name };
  }

  private className(): Simple {
    const name = this.peek(1);
    if (name?.type !== 'ident') fail();
    this.i += 2;
    return { kind: 'class', name: (name as { value: string }).value };
  }

  /**
   * Where the block opened at `this.i` closes. One the end of the input closes is closed, as CSS
   * Syntax has it, and one open at the end of an argument is not.
   */
  private closing(): number {
    const close = block(this.tokens, this.i);
    if (close >= this.end && close !== this.tokens.length) fail();
    return close;
  }

  private attribute(): Simple {
    const close = this.closing();
    const inside = new Parser(this.tokens, this.i + 1, close, this.context, this.nesting);
    this.i = close + 1;
    return inside.attributeBody();
  }

  attributeBody(): Simple {
    this.spaces();
    const { namespace, name } = this.attributeName();
    this.spaces();
    if (this.i >= this.end) return { kind: 'attribute', namespace, name };
    const operator = this.operator();
    this.spaces();
    const token = this.peek();
    if (token?.type !== 'ident' && token?.type !== 'string') fail();
    this.i++;
    const value = (token as { value: string }).value;
    this.spaces();
    const flagToken = this.peek();
    let flag: 'i' | 's' | undefined;
    if (flagToken) {
      flag = flagToken.type === 'ident' ? (lower(flagToken.value) as 'i' | 's') : fail();
      if (flag !== 'i' && flag !== 's') fail();
      this.i++;
    }
    if (!this.done()) fail();
    return { kind: 'attribute', namespace, name, operator, value, ...(flag ? { flag } : {}) };
  }

  private attributeName(): { namespace: Namespace; name: string } {
    const first = this.peek();
    if (this.isDelim('|') && this.peek(1)?.type === 'ident') {
      this.i += 2;
      return { namespace: null, name: (this.peek(-1) as { value: string }).value };
    }
    const prefix = first?.type === 'ident' ? first.value : this.isDelim('*') ? '*' : fail();
    if (this.isDelim('|', 1) && this.peek(2)?.type === 'ident') {
      this.i += 3;
      return {
        namespace: this.namespace(prefix),
        name: (this.peek(-1) as { value: string }).value,
      };
    }
    if (prefix === '*') fail();
    this.i++;
    return { namespace: undefined, name: prefix };
  }

  private operator(): AttributeOperator {
    const token = this.peek();
    if (token?.type !== 'delim') fail();
    const first = (token as { value: string }).value;
    if (first === '=') {
      this.i++;
      return '=';
    }
    if (!'~|^$*'.includes(first) || !this.isDelim('=', 1)) fail();
    this.i += 2;
    return `${first}=` as AttributeOperator;
  }

  private pseudo(afterElement: string | undefined): Simple {
    this.i++;
    const element = this.peek()?.type === 'colon';
    if (element) this.i++;
    const token = this.peek();
    if (token?.type !== 'ident' && token?.type !== 'function') fail();
    const name = lower((token as { value: string }).value);
    const functional = token!.type === 'function';
    if (element || LEGACY.has(name)) return this.pseudoElement(name, functional);
    // Nothing follows `::slotted()`, and few follow another pseudo-element.
    if (afterElement === 'slotted') fail();
    return functional ? this.functional(name, afterElement) : this.plain(name, afterElement);
  }

  private plain(name: string, afterElement: string | undefined): Simple {
    this.i++;
    if (!PLAIN.has(name)) fail();
    const part = afterElement === 'part' || this.nesting.pseudo;
    if (part && STRUCTURAL.has(name)) fail();
    if (afterElement !== undefined && afterElement !== 'part' && !USER_ACTION.has(name)) fail();
    return { kind: 'pseudo-class', name };
  }

  private functional(name: string, afterElement: string | undefined): Simple {
    const takes = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name]! : fail();
    const allowed = afterElement === 'part' ? ['forgiving', 'lang', 'ident'] : ['forgiving'];
    if (afterElement !== undefined && !allowed.includes(takes)) fail();
    if (name === 'has' && this.nesting.has) fail();
    return { kind: 'pseudo-class', name, argument: this.argument(takes, afterElement) };
  }

  private pseudoElement(name: string, functional: boolean): Simple {
    if (!this.nesting.top) fail();
    const known = functional ? ELEMENT_FUNCTIONS.has(name) : ELEMENTS.has(name);
    if (!known && !name.startsWith('-webkit-')) fail();
    if (!functional) {
      this.i++;
      return { kind: 'pseudo-element', name };
    }
    const close = this.closing();
    const argument = serializeTokens(this.tokens.slice(this.i + 1, close));
    // What `::slotted()` is of is one compound.
    if (name === 'slotted') {
      const nesting = { top: false, has: false, compound: true, pseudo: false };
      new Parser(this.tokens, this.i + 1, close, this.context, nesting).read('compound');
    }
    this.i = close + 1;
    return { kind: 'pseudo-element', name, argument };
  }

  /** The argument of a functional pseudo-class, the function token at `this.i`. */
  private argument(takes: Takes | TakesWords, afterElement?: string): Argument {
    const close = this.closing();
    const inside = new Parser(this.tokens, this.i + 1, close, this.context, {
      top: false,
      has: takes === 'relative' || this.nesting.has,
      compound: takes === 'compound' || (this.nesting.compound && takes !== 'relative'),
      pseudo: afterElement !== undefined || this.nesting.pseudo,
    });
    this.i = close + 1;
    return inside.read(takes);
  }

  read(takes: Takes | TakesWords): Argument {
    this.spaces();
    switch (takes) {
      case 'forgiving':
        return { kind: 'selectors', ...this.forgiving() };
      case 'complex':
        return { kind: 'selectors', list: this.list(() => this.complex()) };
      case 'relative':
        return { kind: 'selectors', list: this.list(() => this.complex(true)) };
      case 'compound':
        return { kind: 'selectors', list: [this.oneCompound()] };
      case 'nth':
      case 'nth-of':
        return { kind: 'nth', nth: this.nth(takes === 'nth-of') };
      default:
        return this.words(takes);
    }
  }

  private oneCompound(): Complex {
    const compound = this.compound();
    if (!this.done()) fail();
    return { compounds: [compound], combinators: [] };
  }

  private words(takes: TakesWords): Argument {
    if (takes === 'levels') {
      const numbers = this.list(() => {
        this.spaces();
        const token = this.peek();
        if (token?.type !== 'number' || !token.integer || token.signed) fail();
        this.i++;
        return (token as { value: number }).value;
      });
      return { kind: 'numbers', numbers };
    }
    const one = () => {
      this.spaces();
      const token = this.peek();
      const ok = token?.type === 'ident' || (takes === 'lang' && token?.type === 'string');
      if (!ok) fail();
      this.i++;
      return (token as { value: string }).value;
    };
    const from = this.i;
    const words = takes === 'ident' ? [one()] : this.list(one);
    if (!this.done()) fail();
    return { kind: 'words', words, written: serializeTokens(this.tokens.slice(from, this.end)) };
  }

  /** `an+b`, read from its tokens as CSS Syntax says (https://drafts.csswg.org/css-syntax-3/#anb-microsyntax). */
  private nth(of: boolean): Nth {
    const read = readAnB(this);
    // Each a whole number of 32 bits at most, as a browser keeps them.
    const [a, b] = [read.a, read.b].map((each) =>
      Math.max(-(2 ** 31), Math.min(2 ** 31 - 1, each)),
    );
    const spaced = this.spaces();
    if (this.i >= this.end) return { a, b };
    const token = this.peek();
    if (!of || !spaced || token?.type !== 'ident' || lower(token.value) !== 'of') fail();
    this.i++;
    if (!this.spaces()) fail();
    return { a, b, of: this.list(() => this.complex()) };
  }

  /** For `readAnB`: the next token, taken. */
  take(): Token | undefined {
    const token = this.peek();
    if (token) this.i++;
    return token;
  }

  /** For `readAnB`: the next token, not taken. */
  next(ahead = 0): Token | undefined {
    return this.peek(ahead);
  }

  /** For `readAnB`: where it is, to go back to. */
  place(): number {
    return this.i;
  }

  back(to: number): void {
    this.i = to;
  }

  /** For `readAnB`: skip whitespace, saying whether there was any. */
  skip(): boolean {
    return this.spaces();
  }
}

/** A whole number written with a sign before it, `+1` or `-2`, as `an+b` takes one. */
const signedInteger = (token: Token | undefined): number | undefined =>
  token?.type === 'number' && token.integer && token.signed ? token.value : undefined;
const signlessInteger = (token: Token | undefined): number | undefined =>
  token?.type === 'number' && token.integer && !token.signed ? token.value : undefined;

/** What follows the `n` of `an+b`: nothing, `+b`, `- b`, `+ b`. */
function readB(at: Parser): number {
  const from = at.place();
  at.skip();
  const token = at.next();
  const signed = signedInteger(token);
  if (signed !== undefined) {
    at.take();
    return signed;
  }
  if (token?.type === 'delim' && (token.value === '+' || token.value === '-')) {
    at.take();
    at.skip();
    const value = signlessInteger(at.take()) ?? fail();
    return token.value === '-' ? -value : value;
  }
  // Nothing that is a `b`: the space before it is the caller's to read.
  at.back(from);
  return 0;
}

/**
 * The `n`, `n-`, `n-3` part of `an+b` as an ident or a dimension's unit, its letters in any case.
 * Answers the `b` it ends with where it has one, and whether a signless `b` must follow.
 */
function unitB(unit: string): { b?: number; dash?: true } | undefined {
  const text = lower(unit);
  if (text === 'n') return {};
  if (text === 'n-') return { dash: true };
  const digits = /^n-(\d+)$/.exec(text);
  return digits ? { b: -Number(digits[1]) } : undefined;
}

/** The `b` of `an+b` where the `a` was given as an ident or a dimension with `unit`. */
function afterN(at: Parser, unit: string): number {
  const read = unitB(unit) ?? fail();
  if (read.b !== undefined) return read.b;
  if (read.dash) {
    at.skip();
    return -(signlessInteger(at.take()) ?? fail());
  }
  return readB(at);
}

/** `odd` and `even`, the two `an+b` has words for. */
const WORDS: Readonly<Record<string, { a: number; b: number }>> = {
  odd: { a: 2, b: 1 },
  even: { a: 2, b: 0 },
};

/** `an+b`, from the tokens at the parser's place. */
function readAnB(at: Parser): { a: number; b: number } {
  const token = at.next();
  const key = token?.type === 'ident' ? lower(token.value) : undefined;
  const word = key !== undefined && Object.hasOwn(WORDS, key) ? WORDS[key] : undefined;
  if (word) {
    at.take();
    return word;
  }
  if (token?.type === 'number' || token?.type === 'dimension') {
    at.take();
    if (!token.integer) fail();
    return token.type === 'number'
      ? { a: 0, b: token.value }
      : { a: token.value, b: afterN(at, token.unit) };
  }
  return readN(at, token);
}

/** `n`, `+n`, `-n` and what follows, where the `a` is written with no number. */
function readN(at: Parser, token: Token | undefined): { a: number; b: number } {
  // `+n`: the `+` and the `n` with nothing between.
  if (token?.type === 'delim' && token.value === '+') {
    at.take();
    if (at.next()?.type !== 'ident') fail();
  }
  const ident = at.take();
  if (ident?.type !== 'ident') fail();
  const unit = (ident as { value: string }).value;
  const negative = token?.type === 'ident' && unit.startsWith('-');
  return negative ? { a: -1, b: afterN(at, unit.slice(1)) } : { a: 1, b: afterN(at, unit) };
}

/** A selector list read, or a `SyntaxError` where it is not one. */
export function parseSelectorList(text: string, context: ParseContext = {}): Complex[] {
  const { tokens, written } = tokenizeWritten(text);
  try {
    const parser = new Parser(tokens, 0, tokens.length, { ...context, written }, TOP);
    return parser.list(() => parser.complex());
  } catch (error) {
    if (error instanceof Unreadable) throw invalid(text);
    throw error;
  }
}
