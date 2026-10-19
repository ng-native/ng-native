import { tokenize, type Token } from './css-tokens.ts';

/**
 * A declared value as the CSSOM writes it back (https://drafts.csswg.org/cssom/#serializing-css-values):
 * `.5em` is `0.5em`, `-0px` is `0px`, a string is in double quotes, `url(a)` is `url("a")`, and
 * what is between the parts is one space, or a comma and one.
 *
 * ponytail: the value is not checked against what the property takes, and no keyword is put in a
 * form of its own (`RED` stays `RED`): the tokens are written again as a browser writes them, and
 * the few defaults a browser leaves out are left out by name.
 */

/** A code point as CSS escapes it by its number: `\31 ` for a `1`. */
const byNumber = (code: number): string => `\\${code.toString(16)} `;

/** Whether the code point at a place in an identifier is written as its number. */
function asNumber(code: number, at: number, first: number): boolean {
  if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) return true;
  const digit = code >= 0x30 && code <= 0x39;
  return digit && (at === 0 || (at === 1 && first === 0x2d));
}

/** One code unit of an identifier as `CSS.escape` writes it. */
function escaped(text: string, at: number): string {
  const code = text.charCodeAt(at);
  const letter = text[at]!;
  if (code === 0) return '�';
  if (asNumber(code, at, text.charCodeAt(0))) return byNumber(code);
  if (at === 0 && code === 0x2d && text.length === 1) return '\\-';
  if (code >= 0x80 || /[\w-]/.test(letter)) return letter;
  return '\\' + letter;
}

/** An identifier as the CSSOM serialises one. */
export function serializeIdentifier(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at++) out += escaped(text, at);
  return out;
}

/** A string as the CSSOM serialises one: in double quotes, with what would end it escaped. */
export function serializeString(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0) out += '\uFFFD';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) out += byNumber(code);
    else out += char === '"' || char === '\\' ? `\\${char}` : char;
  }
  return `"${out}"`;
}

/** A number as the CSSOM writes it: six significant digits at most, and no negative zero. */
function serializeNumber(value: number): string {
  const rounded = Number(value.toPrecision(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

type Typed<T extends Token['type']> = Token & { readonly type: T };

/** How each kind of token with something of its own in it is written. */
const WRITTEN: { [T in Token['type']]?: (token: Typed<T>) => string } = {
  ident: (token) => serializeIdentifier(token.value),
  function: (token) => `${serializeIdentifier(token.value)}(`,
  'at-keyword': (token) => `@${serializeIdentifier(token.value)}`,
  hash: (token) => `#${token.value}`,
  string: (token) => serializeString(token.value),
  url: (token) => `url(${serializeString(token.value)})`,
  number: (token) => serializeNumber(token.value),
  percentage: (token) => `${serializeNumber(token.value)}%`,
  dimension: (token) => `${serializeNumber(token.value)}${token.unit.toLowerCase()}`,
  delim: (token) => token.value,
};

/** The tokens that are one character, by the character. */
const MARKS: Partial<Record<Token['type'], string>> = {
  colon: ':',
  semicolon: ';',
  comma: ',',
  ...Object.fromEntries(['[', ']', '(', ')', '{', '}'].map((mark) => [mark, mark])),
};

function serializeToken(token: Token): string {
  const write = WRITTEN[token.type] as ((token: Token) => string) | undefined;
  return write ? write(token) : (MARKS[token.type] ?? '');
}

/** Where no space is written: inside a bracket's edge, and before a comma. */
const NO_SPACE_AFTER = new Set(['function', '(', '[', 'whitespace']);
const NO_SPACE_BEFORE = new Set([')', ']', 'comma']);

/** The tokens written again, one space wherever there was any and a comma always followed by one. */
export function serializeTokens(tokens: readonly Token[]): string {
  let out = '';
  for (const [at, token] of tokens.entries()) {
    if (token.type === 'whitespace') {
      const before = tokens[at - 1];
      const after = tokens[at + 1];
      if (!before || !after || NO_SPACE_AFTER.has(before.type)) continue;
      if (NO_SPACE_BEFORE.has(after.type) || before.type === 'comma') continue;
      out += ' ';
    } else {
      out += serializeToken(token);
      if (token.type === 'comma' && tokens[at + 1]) out += ' ';
    }
  }
  return out.trim();
}

/** A family written as a string that is also its identifiers, `'Lucida Grande'`, is written as them. */
const PLAIN_FAMILY = /^-?[_a-zA-Z][\w-]*( -?[_a-zA-Z][\w-]*)*$/;
/** The generic families and the keywords, which in quotes are a family of that name. */
const NOT_A_FAMILY = new Set([
  ...['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji'],
  ...['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'],
]);

function familiesUnquoted(tokens: readonly Token[]): Token[] {
  return tokens.flatMap((token): Token[] => {
    if (token.type !== 'string' || !PLAIN_FAMILY.test(token.value)) return [token];
    if (NOT_A_FAMILY.has(token.value.toLowerCase())) return [token];
    return token.value
      .split(' ')
      .flatMap((word, at): Token[] => [
        ...(at ? [{ type: 'whitespace' } as const] : []),
        { type: 'ident', value: word },
      ]);
  });
}

/** Each written with an identifier as its default argument, which is left out: `counter(n)`. */
const DEFAULT_STYLE = /\b(counters?\((?:[^()]*?))\s*,\s*decimal\s*\)/gi;

/** The keywords every property takes. */
const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;

/** The properties that take one keyword of a few and nothing else, by the keywords they take. */
const KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'scroll-behavior': new Set(['auto', 'smooth']),
};

/**
 * Whether a property can take a value, so far as is known here: one of the few that take a
 * keyword alone is checked, and any other value is taken.
 */
export function takesValue(property: string, written: string): boolean {
  const keywords = KEYWORDS[property];
  const text = written.trim();
  return !keywords || CSS_WIDE.test(text) || keywords.has(text.toLowerCase());
}

/**
 * A value as the CSSOM writes it back, by the property it is for. One holding `var()`, `attr()`
 * or `env()` is substituted later, so it is kept as written.
 */
export function serializeValue(property: string, written: string): string {
  const text = written.trim();
  if (CSS_WIDE.test(text)) return text.toLowerCase();
  if (/\b(var|attr|env)\(/i.test(text)) return text;
  const tokens = tokenize(text);
  const serialized = serializeTokens(
    property === 'font-family' ? familiesUnquoted(tokens) : tokens,
  );
  return serialized.replace(DEFAULT_STYLE, '$1)');
}
