/**
 * The tokenizer of CSS Syntax Level 3 (https://drafts.csswg.org/css-syntax-3/#tokenization), as
 * a selector is read with it: escapes, comments, strings and numbers each as the spec has them,
 * so `#\31 23`, `[a="b\"c"]` and `:nth-child(+2n-1)` are read as a browser reads them.
 */

export type Token =
  | {
      readonly type: 'ident' | 'function' | 'at-keyword' | 'string' | 'url';
      readonly value: string;
    }
  | { readonly type: 'hash'; readonly value: string; readonly id: boolean }
  | { readonly type: 'delim'; readonly value: string }
  | {
      readonly type: 'number' | 'percentage' | 'dimension';
      readonly value: number;
      /** Whether it was written as a whole number, with no `.` or exponent. */
      readonly integer: boolean;
      /** Whether it was written with a `+` or a `-` before it. */
      readonly signed: boolean;
      readonly unit: string;
    }
  | {
      readonly type:
        | 'whitespace'
        | 'bad-string'
        | 'bad-url'
        | 'CDO'
        | 'CDC'
        | 'colon'
        | 'semicolon'
        | 'comma'
        | '['
        | ']'
        | '('
        | ')'
        | '{'
        | '}';
    };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isNameStart = (c: string | undefined): boolean =>
  c !== undefined && (/^[a-zA-Z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined): boolean => isNameStart(c) || isDigit(c) || c === '-';
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n';
const validEscape = (a: string | undefined, b: string | undefined): boolean =>
  a === '\\' && b !== '\n';

/** Whether three code points would start an ident sequence. */
function startsIdent(a: string | undefined, b: string | undefined, c: string | undefined): boolean {
  if (a === '-') return isNameStart(b) || b === '-' || validEscape(b, c);
  if (a === '\\') return validEscape(a, b);
  return isNameStart(a);
}

/** Whether three code points would start a number. */
function startsNumber(
  a: string | undefined,
  b: string | undefined,
  c: string | undefined,
): boolean {
  if (a === '+' || a === '-') return isDigit(b) || (b === '.' && isDigit(c));
  if (a === '.') return isDigit(b);
  return isDigit(a);
}

/** The input as the spec preprocesses it: one kind of newline, and no NUL. */
const preprocess = (text: string): string[] =>
  Array.from(text.replace(/\r\n?|\f/g, '\n').replace(/\0/g, '�'));

const SINGLE: Readonly<Record<string, Token['type']>> = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '{': '{',
  '}': '}',
  ',': 'comma',
  ':': 'colon',
  ';': 'semicolon',
};

/** Reads one stream of code points into tokens, as `tokenize` asks. */
class Reader {
  private readonly at: string[];
  private i = 0;

  constructor(text: string) {
    this.at = preprocess(text);
  }

  private peek(ahead = 0): string | undefined {
    return this.at[this.i + ahead];
  }

  all(spans?: [number, number][]): Token[] {
    const out: Token[] = [];
    for (;;) {
      this.comments();
      if (this.i >= this.at.length) return out;
      const from = this.i;
      out.push(this.next());
      spans?.push([from, this.i]);
    }
  }

  /** The text from where one token starts to where another ends. */
  text(from: number, to: number): string {
    return this.at.slice(from, to).join('');
  }

  /** `/* ... *\/`, which is no token; one left open runs to the end. */
  private comments(): void {
    while (this.peek() === '/' && this.peek(1) === '*') {
      const end = this.at.indexOf('*', this.i + 2);
      let close = end;
      while (close >= 0 && this.at[close + 1] !== '/') close = this.at.indexOf('*', close + 1);
      this.i = close < 0 ? this.at.length : close + 2;
    }
  }

  private next(): Token {
    const c = this.peek()!;
    if (isSpace(c)) {
      while (isSpace(this.peek())) this.i++;
      return { type: 'whitespace' };
    }
    if (c === '"' || c === "'") return this.string(c);
    if (SINGLE[c]) {
      this.i++;
      return { type: SINGLE[c] } as Token;
    }
    return this.other(c);
  }

  private other(c: string): Token {
    if (c === '#' && (isName(this.peek(1)) || validEscape(this.peek(1), this.peek(2)))) {
      this.i++;
      const id = startsIdent(this.peek(), this.peek(1), this.peek(2));
      return { type: 'hash', value: this.name(), id };
    }
    if (startsNumber(c, this.peek(1), this.peek(2))) return this.numeric();
    return this.marker(c) ?? this.word(c);
  }

  /** `-->` and `<!--`, which HTML put in CSS. */
  private marker(c: string): Token | undefined {
    if (c === '-' && this.peek(1) === '-' && this.peek(2) === '>') {
      this.i += 3;
      return { type: 'CDC' };
    }
    if (c === '<' && this.peek(1) === '!' && this.peek(2) === '-' && this.peek(3) === '-') {
      this.i += 4;
      return { type: 'CDO' };
    }
    return undefined;
  }

  /** An ident, a function, an at-keyword, or a code point on its own. */
  private word(c: string): Token {
    if (startsIdent(c, this.peek(1), this.peek(2))) return this.identLike();
    if (c === '@' && startsIdent(this.peek(1), this.peek(2), this.peek(3))) {
      this.i++;
      return { type: 'at-keyword', value: this.name() };
    }
    this.i++;
    return { type: 'delim', value: c };
  }

  private string(quote: string): Token {
    this.i++;
    let value = '';
    for (;;) {
      const c = this.peek();
      this.i++;
      if (c === undefined || c === quote) return { type: 'string', value };
      if (c === '\n') {
        this.i--;
        return { type: 'bad-string' };
      }
      if (c !== '\\') value += c;
      else if (this.peek() === '\n') this.i++;
      else if (this.peek() !== undefined) value += this.escape();
    }
  }

  /** The code point an escape stands for, the backslash already read. */
  private escape(): string {
    const c = this.peek();
    if (c === undefined) return '�';
    if (!isHex(c)) {
      this.i++;
      return c;
    }
    let hex = '';
    while (hex.length < 6 && isHex(this.peek())) hex += this.at[this.i++];
    if (isSpace(this.peek())) this.i++;
    const code = parseInt(hex, 16);
    const bad = code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff;
    return bad ? '�' : String.fromCodePoint(code);
  }

  private name(): string {
    let out = '';
    for (;;) {
      const c = this.peek();
      if (isName(c)) {
        out += c;
        this.i++;
      } else if (validEscape(c, this.peek(1))) {
        this.i++;
        out += this.escape();
      } else return out;
    }
  }

  private numeric(): Token {
    const { value, integer, signed } = this.number();
    if (startsIdent(this.peek(), this.peek(1), this.peek(2))) {
      return { type: 'dimension', value, integer, signed, unit: this.name() };
    }
    if (this.peek() === '%') {
      this.i++;
      return { type: 'percentage', value, integer, signed, unit: '%' };
    }
    return { type: 'number', value, integer, signed, unit: '' };
  }

  private number(): { value: number; integer: boolean; signed: boolean } {
    const from = this.i;
    const signed = this.peek() === '+' || this.peek() === '-';
    if (signed) this.i++;
    this.digits();
    let integer = true;
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      integer = false;
      this.i++;
      this.digits();
    }
    if (this.exponent()) integer = false;
    return { value: Number(this.at.slice(from, this.i).join('')), integer, signed };
  }

  private digits(): void {
    while (isDigit(this.peek())) this.i++;
  }

  /** `e3`, `E+3` or `e-3` after a number, taken where it is one. */
  private exponent(): boolean {
    const e = this.peek();
    const sign = this.peek(1) === '+' || this.peek(1) === '-';
    if ((e !== 'e' && e !== 'E') || !isDigit(this.peek(sign ? 2 : 1))) return false;
    this.i += sign ? 2 : 1;
    this.digits();
    return true;
  }

  private identLike(): Token {
    const value = this.name();
    if (this.peek() !== '(') return { type: 'ident', value };
    this.i++;
    if (value.toLowerCase() !== 'url') return { type: 'function', value };
    while (isSpace(this.peek()) && isSpace(this.peek(1))) this.i++;
    const c = this.peek(isSpace(this.peek()) ? 1 : 0);
    // `url("...")` is a function whose argument is a string; `url(...)` is a token of its own.
    if (c === '"' || c === "'") return { type: 'function', value };
    return this.url();
  }

  private url(): Token {
    this.skipSpaces();
    let value = '';
    for (;;) {
      const c = this.peek();
      this.i++;
      if (c === undefined || c === ')') return { type: 'url', value };
      if (isSpace(c)) {
        this.skipSpaces();
        if (this.peek() === ')' || this.peek() === undefined) continue;
        return this.badUrl();
      }
      if (c === '"' || c === "'" || c === '(') return this.badUrl();
      if (c !== '\\') value += c;
      else if (validEscape(c, this.peek())) value += this.escape();
      else return this.badUrl();
    }
  }

  private skipSpaces(): void {
    while (isSpace(this.peek())) this.i++;
  }

  private badUrl(): Token {
    for (;;) {
      const c = this.peek();
      this.i++;
      if (c === undefined || c === ')') return { type: 'bad-url' };
      if (validEscape(c, this.peek())) this.escape();
    }
  }
}

/** The tokens of a piece of CSS, comments dropped. */
export const tokenize = (text: string): Token[] => new Reader(text).all();

/** The tokens of a piece of CSS, and the text a run of them was written as. */
export function tokenizeWritten(text: string): {
  tokens: Token[];
  written: (from: number, to: number) => string;
} {
  const reader = new Reader(text);
  const spans: [number, number][] = [];
  const tokens = reader.all(spans);
  const written = (from: number, to: number): string =>
    to > from ? reader.text(spans[from]![0], spans[to - 1]![1]) : '';
  return { tokens, written };
}
