/**
 * Marked's tokens, turned into the blocks `<markdown>` draws: the entities decoded, the links and
 * images held to the schemes they may use, raw HTML made plain text, and an image lifted out of
 * its paragraph, since a `<text>` cannot hold one.
 *
 * Plain functions with no Angular in them, so the policy is the same wherever the tokens came from:
 * `marked.lexer` on the device, or a build step that lexed them ahead of time.
 */
import type { Token, Tokens } from 'marked';
import { HTML_ENTITIES } from './html-entities.ts';

/** The elements a document is drawn with, by the HTML names the Markdown would have produced. */
export type MarkdownElement =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'p'
  | 'blockquote'
  | 'ul'
  | 'ol'
  | 'li'
  | 'marker'
  | 'pre'
  | 'code'
  | 'strong'
  | 'em'
  | 'del'
  | 'a'
  | 'hr'
  | 'img'
  | 'table'
  | 'tr'
  | 'th'
  | 'td';

export type MarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong' | 'em' | 'del'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'link';
      readonly href: string;
      readonly title: string | null;
      readonly children: readonly MarkdownInline[];
    };

export interface MarkdownListItem {
  readonly marker: string;
  readonly children: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | {
      readonly kind: 'heading';
      readonly element: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      readonly children: readonly MarkdownInline[];
    }
  | { readonly kind: 'paragraph'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
  | { readonly kind: 'blockquote'; readonly children: readonly MarkdownBlock[] }
  | {
      readonly kind: 'list';
      readonly element: 'ul' | 'ol';
      readonly items: readonly MarkdownListItem[];
    }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'hr' }
  | {
      readonly kind: 'table';
      readonly header: readonly (readonly MarkdownInline[])[];
      readonly rows: readonly (readonly (readonly MarkdownInline[])[])[];
    };

let namedEntities: Map<string, string> | undefined;

/** The character HTML names `name`, from its full table, built on the first name looked up. */
function namedEntity(name: string): string | undefined {
  if (!namedEntities) {
    namedEntities = new Map();
    const pairs = HTML_ENTITIES.split(' ');
    for (let i = 0; i + 1 < pairs.length; i += 2) namedEntities.set(pairs[i]!, pairs[i + 1]!);
  }
  return namedEntities.get(name);
}

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/**
 * The text an HTML reader would show for `text`, in one pass so `&amp;lt;` is `&lt;` and not `<`.
 * A reference to no character, or to one outside Unicode, is the replacement character, as HTML
 * makes it; a name HTML does not have stays as written.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return namedEntity(name) ?? whole;
    const code = decimal !== undefined ? Number(decimal) : parseInt(hex!, 16);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : '�';
  });
}

/**
 * What a URL parser ignores while it reads a scheme: the C0 controls and the space, and the C1
 * controls and DEL beside them. `java\tscript:` is `javascript:` to the thing that opens it.
 */
const IGNORED_IN_SCHEME = /[\u0000- \u007f-\u009f]/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/;

/** The scheme `url` would be opened with, lowercased, or null for a relative one. */
export function schemeOf(url: string): string | null {
  return SCHEME.exec(url.replace(IGNORED_IN_SCHEME, '').toLowerCase())?.[1] ?? null;
}

const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const IMAGE_SCHEMES = new Set(['http', 'https']);

/**
 * A link's target if it may be followed: `http`, `https`, `mailto`, `tel`, or relative, which is
 * the app's to resolve. Anything else, `javascript:`, `data:`, `vbscript:` and `file:` among
 * them, is null, and the link is drawn as its text. The scheme is read after the trim, so
 * whitespace the trim strips cannot hide one.
 */
export function linkTarget(href: string): string | null {
  const target = href.trim();
  const scheme = schemeOf(target);
  return scheme === null || LINK_SCHEMES.has(scheme) ? target : null;
}

/** Whether `href` is absolute in a scheme a link may be followed to, and so is opened on press. */
export function opensOnPress(href: string): boolean {
  const scheme = schemeOf(href.trim());
  return scheme !== null && LINK_SCHEMES.has(scheme);
}

/**
 * An image's address if it may be loaded: `http`, `https`, or a picture written into the document
 * as a `data:` url of a raster type. A pasted screenshot arrives that way from a web editor, and
 * a native image only decodes such a picture: nothing in it runs. Any other `data:` url, an SVG
 * or HTML among them, is refused, as is every other scheme.
 */
export function imageSource(href: string): string | null {
  const source = href.trim();
  const scheme = schemeOf(source);
  if (scheme === null) return null;
  if (IMAGE_SCHEMES.has(scheme)) return source;
  if (scheme !== 'data') return null;
  // A native loader may not decode a url with whitespace in it, so a wrapped payload is joined.
  const joined = source.replace(/\s+/g, '');
  return DATA_IMAGE.test(joined) ? joined : null;
}

/** A base64 `data:` url of a raster picture: PNG, JPEG, GIF or WebP. */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

/** A link's or an image's target with its entities decoded, or null when it is not a string. */
function hrefOf(token: Token): string | null {
  const href: unknown = (token as Tokens.Link).href;
  return typeof href === 'string' ? decodeEntities(href) : null;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** The blocks a document of `tokens` is drawn as. */
export function markdownBlocks(tokens: readonly Token[]): MarkdownBlock[] {
  return tokens.flatMap(block);
}

/** What each kind of block token is drawn as. A kind not here is drawn as its source text. */
const BLOCKS: Readonly<Record<string, (token: Token) => MarkdownBlock[]>> = {
  heading: (token) => {
    const heading = token as Tokens.Heading;
    const depth = Math.min(Math.max(heading.depth, 1), 6);
    const children = trimmedEnd(inlines(heading.tokens));
    return [{ kind: 'heading', element: HEADINGS[depth - 1]!, children }];
  },
  paragraph: (token) => paragraphs((token as Tokens.Paragraph).tokens),
  text: (token) => {
    const text = token as Tokens.Text;
    return text.tokens
      ? paragraphs(text.tokens)
      : [{ kind: 'paragraph', children: [plain(softBreaks(text.text))] }];
  },
  blockquote: (token) => [
    { kind: 'blockquote', children: markdownBlocks((token as Tokens.Blockquote).tokens) },
  ],
  list: (token) => [list(token as Tokens.List)],
  code: (token) => [{ kind: 'code', text: indented((token as Tokens.Code).text) }],
  hr: () => [{ kind: 'hr' }],
  table: (token) => {
    const table = token as Tokens.Table;
    return [
      {
        kind: 'table',
        header: table.header.map((cell) => inlines(cell.tokens)),
        rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens))),
      },
    ];
  },
  html: (token) => literal((token as Tokens.HTML).text),
  space: () => [],
  def: () => [],
  checkbox: () => [],
};

function block(token: Token): MarkdownBlock[] {
  const draw = Object.hasOwn(BLOCKS, token.type) ? BLOCKS[token.type]! : null;
  return draw ? draw(token) : literal(token.raw ?? '');
}

/**
 * A code block's text with its first line's indent made of no-break spaces: a paragraph loses the
 * spaces at its start, and a block's indent is part of the code.
 */
function indented(text: string): string {
  return text.replace(/^ +/, (spaces) => '\u00a0'.repeat(spaces.length));
}

/** Text drawn as written, which is what raw HTML and a token nothing here knows become. */
function literal(text: string): MarkdownBlock[] {
  const trimmed = text.replace(/\n+$/, '');
  return trimmed.trim() ? [{ kind: 'paragraph', children: [{ kind: 'text', text: trimmed }] }] : [];
}

function list(token: Tokens.List): MarkdownBlock {
  const start = typeof token.start === 'number' ? token.start : 1;
  return {
    kind: 'list',
    element: token.ordered ? 'ol' : 'ul',
    items: token.items.map((item, index) => ({
      marker: item.task ? (item.checked ? '☑' : '☐') : token.ordered ? `${start + index}.` : '•',
      children: markdownBlocks(item.tokens),
    })),
  };
}

/**
 * A paragraph's runs, split around the images at its top level: an image is a block of its own,
 * and the text either side of it a paragraph each. An image whose address is refused, and one
 * inside a link or an emphasis, is its alt text instead.
 */
function paragraphs(tokens: readonly Token[]): MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  let run: MarkdownInline[] = [];
  const flush = () => {
    if (run.some((one) => one.kind !== 'text' || one.text.trim())) {
      out.push({ kind: 'paragraph', children: trimmedEnd(run) });
    }
    run = [];
  };
  for (const token of tokens) {
    const href = token.type === 'image' ? hrefOf(token) : null;
    const src = href === null ? null : imageSource(href);
    if (src === null) {
      run.push(...inline(token));
      continue;
    }
    flush();
    out.push({ kind: 'image', src, alt: decodeEntities((token as Tokens.Image).text) });
  }
  flush();
  return out;
}

/**
 * Runs without the whitespace at their end, which a paragraph does not draw. The engine works out
 * that trim when a run changes, not when a run arrives after it, so a run that ended a streaming
 * paragraph and stops ending it would otherwise keep its trimmed space: `Run ` and then a code
 * span would read as one word.
 */
function trimmedEnd(runs: MarkdownInline[]): MarkdownInline[] {
  const last = runs.at(-1);
  if (last?.kind !== 'text') return runs;
  const text = last.text.replace(/[ \t\n\r\f]+$/, '');
  if (text === last.text) return runs;
  return text ? [...runs.slice(0, -1), { kind: 'text', text }] : runs.slice(0, -1);
}

function inlines(tokens: readonly Token[] | undefined): MarkdownInline[] {
  return (tokens ?? []).flatMap(inline);
}

/**
 * Text with each line break the source wrapped it at made a space, as CommonMark reads a soft
 * break, with the spaces around it. A hard break is a `br` token of its own, and stays one.
 */
function softBreaks(text: string): string {
  return text.replace(/ *\n */g, ' ');
}

function plain(text: string): MarkdownInline {
  return { kind: 'text', text: decodeEntities(text) };
}

function emphasis(token: Token): MarkdownInline[] {
  const kind = token.type as 'strong' | 'em' | 'del';
  return [{ kind, children: inlines((token as Tokens.Strong).tokens) }];
}

/** What each kind of inline token is drawn as. A kind not here is drawn as its source text. */
const INLINES: Readonly<Record<string, (token: Token) => MarkdownInline[]>> = {
  text: (token) => {
    const text = token as Tokens.Text;
    return text.tokens ? inlines(text.tokens) : [plain(softBreaks(text.text))];
  },
  escape: (token) => [plain((token as Tokens.Escape).text)],
  strong: emphasis,
  em: emphasis,
  del: emphasis,
  codespan: (token) => [{ kind: 'code', text: (token as Tokens.Codespan).text }],
  br: () => [{ kind: 'text', text: '\n' }],
  link: (token) => {
    const link = token as Tokens.Link;
    const children = inlines(link.tokens);
    const decoded = hrefOf(link);
    const href = decoded === null ? null : linkTarget(decoded);
    if (href === null) return children;
    const title = link.title ? decodeEntities(link.title) : null;
    return [{ kind: 'link', href, title, children }];
  },
  image: (token) => [plain((token as Tokens.Image).text)],
  html: (token) => [{ kind: 'text', text: (token as Tokens.HTML).text }],
  checkbox: () => [],
};

function inline(token: Token): MarkdownInline[] {
  const draw = Object.hasOwn(INLINES, token.type) ? INLINES[token.type]! : null;
  if (draw) return draw(token);
  return token.raw ? [{ kind: 'text', text: token.raw }] : [];
}

const keys = new WeakMap<object, number>();
let lastKey = 0;

/**
 * A key for `block` that stays the same while it is drawn: a block kept from the document before
 * keeps its own, and one {@link shareBlocks} made in place of an edited one takes that one's.
 */
export function blockKey(block: MarkdownBlock): number {
  let key = keys.get(block);
  if (key === undefined) keys.set(block, (key = ++lastKey));
  return key;
}

/**
 * `next`, with every part of it that equals the same part of `previous` replaced by that part, so
 * a block that did not change is the object drawn already and is not drawn again. The two are
 * matched from each end, so a block added or removed in the middle leaves those either side of it
 * kept; what is left between is matched by position.
 */
export function shareBlocks(
  previous: readonly MarkdownBlock[] | undefined,
  next: readonly MarkdownBlock[],
): readonly MarkdownBlock[] {
  return previous ? (share(previous, next) as readonly MarkdownBlock[]) : next;
}

function share(previous: unknown, next: unknown): unknown {
  if (previous === next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (previous === null || next === null) return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  if (Array.isArray(previous)) return shareArray(previous, next as unknown[]);
  return shareObject(previous as Record<string, unknown>, next as Record<string, unknown>);
}

function shareArray(previous: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  const out = next.slice();
  // Each pair is compared once: the passes below meet at the same position, and comparing a
  // changed block again in each of them made a nested one cost three times as much a level.
  const compared = new Set<number>();
  const shareAt = (was: number, at: number): unknown => {
    if (was === at) {
      if (compared.has(at)) return out[at];
      compared.add(at);
    }
    return (out[at] = share(previous[was], out[at]));
  };
  let start = 0;
  while (start < out.length && start < previous.length) {
    if (shareAt(start, start) !== previous[start]) break;
    start++;
  }
  let end = 0;
  while (end < out.length - start && end < previous.length - start) {
    const was = previous.length - 1 - end;
    if (shareAt(was, out.length - 1 - end) !== previous[was]) break;
    end++;
  }
  for (let i = start; i < out.length - end && i < previous.length - end; i++) shareAt(i, i);
  const same = out.length === previous.length && out.every((one, i) => one === previous[i]);
  return same ? previous : out;
}

function shareObject(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (previous['kind'] !== next['kind']) return next;
  const names = Object.keys(next);
  let same = names.length === Object.keys(previous).length;
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const was = previous[name];
    const kept = Object.hasOwn(previous, name) ? share(was, next[name]) : next[name];
    if (kept !== was) same = false;
    out[name] = kept;
  }
  if (same) return previous;
  const key = keys.get(previous);
  if (key !== undefined) keys.set(out, key);
  return out;
}
