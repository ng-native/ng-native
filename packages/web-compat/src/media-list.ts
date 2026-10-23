import { tokenize } from './css-tokens.ts';
import { serializeTokens } from './css-value.ts';
import { domError, required } from './dom-error.ts';

/**
 * A list of media queries as the CSSOM has one (https://drafts.csswg.org/cssom/#the-medialist-interface):
 * `rule.media` of a `@media` rule and `sheet.media`. Each query is kept in the form a browser
 * writes it, lower case with one space between its words, and one that is no query is `not all`.
 *
 * ponytail: a query is checked for its shape alone, words and bracketed features; what a
 * feature says is not checked against the features there are.
 */

/** A query in its written form, or `not all` for one that is none. */
function serializeQuery(text: string): string {
  const tokens = tokenize(text.toLowerCase());
  let depth = 0;
  for (const token of tokens) {
    // A function where a word or a feature goes, `layer()`, is no query.
    if (token.type === 'function' && depth === 0) return 'not all';
    if (token.type === '(' || token.type === 'function') depth++;
    else if (token.type === ')') depth--;
    else if (depth === 0 && token.type !== 'ident' && token.type !== 'whitespace') return 'not all';
  }
  if (depth !== 0 || !tokens.some((token) => token.type !== 'whitespace')) return 'not all';
  // `all and` says nothing a feature after it does not, and is left out.
  return serializeTokens(tokens)
    .replace(/\s*:\s*/g, ': ')
    .replace(/^all and (?=\()/, '');
}

/** A list's text as its queries, split at the commas between them. */
function queriesIn(text: string): string[] {
  if (!text.trim()) return [];
  return text.split(',').map(serializeQuery);
}

export class MediaList {
  #queries: string[] = [];
  /** What to tell once the list changes: the rule or the sheet it is the media of. */
  readonly #changed: () => void;

  constructor(text: string, changed: () => void = () => {}) {
    this.#set(queriesIn(text));
    this.#changed = changed;
  }

  /** The queries, each also the list's own property by its place, as a browser has them. */
  #set(queries: string[]): void {
    const self = this as unknown as Record<number, string>;
    for (let at = queries.length; at < this.#queries.length; at++) delete self[at];
    this.#queries = queries;
    queries.forEach((query, at) => {
      Object.defineProperty(this, at, { value: query, configurable: true, enumerable: true });
    });
  }

  get mediaText(): string {
    return this.#queries.join(', ');
  }
  set mediaText(text: string) {
    this.#set(queriesIn(text === null ? '' : String(text)));
    this.#changed();
  }
  get length(): number {
    return this.#queries.length;
  }
  item(index: number): string | null {
    return this.#queries[Number(index) >>> 0] ?? null;
  }
  appendMedium(medium: string): void {
    // One query: a list of them is no medium to append.
    const [query, ...more] = queriesIn(String(medium));
    if (query === undefined || more.length || this.#queries.includes(query)) return;
    this.#set([...this.#queries, query]);
    this.#changed();
  }
  deleteMedium(...args: unknown[]): void {
    required(args, 1, 'deleteMedium');
    const query = serializeQuery(String(args[0]));
    const kept = this.#queries.filter((each) => each !== query);
    if (kept.length === this.#queries.length) {
      throw domError(`'${String(args[0])}' is not in the list.`, 'NotFoundError');
    }
    this.#set(kept);
    this.#changed();
  }
  toString(): string {
    return this.mediaText;
  }
}
