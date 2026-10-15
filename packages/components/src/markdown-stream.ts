/**
 * A Markdown source that grows as it streams in, lexed a chunk at a time: the blocks before the
 * last one are kept, only the last is lexed again, and syntax still open at its end is held back
 * until it closes, so a half-written code span, emphasis, table row or code fence never shows as
 * the characters it is written with.
 *
 * Plain functions and a class with no Angular in them, beside `markdown-blocks.ts`.
 */
import { Lexer, type Token, type Tokens, type TokensList } from 'marked';

type Links = TokensList['links'];

/** Where the last token in `tokens` that is not blank space is, or -1. */
function lastIndexOfBlock(tokens: readonly Token[]): number {
  let at = tokens.length - 1;
  while (at >= 0 && tokens[at]!.type === 'space') at--;
  return at;
}

/** The last block in `tokens` that is not blank space, inside the last quote or list item. */
function lastBlock(tokens: readonly Token[]): Token | undefined {
  const last = tokens[lastIndexOfBlock(tokens)];
  if (last?.type === 'list') {
    const item = (last as Tokens.List).items.at(-1);
    return (item && lastBlock(item.tokens)) ?? last;
  }
  if (last?.type === 'blockquote') return lastBlock((last as Tokens.Blockquote).tokens) ?? last;
  return last;
}

const WHITESPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const DELIMITERS = /`+|\*+|_+|~+/g;

interface Opener {
  /** Where the delimiter is in the text token's raw source. */
  readonly at: number;
  readonly raw: string;
}

/**
 * The last delimiter in `tokens` that marked left as text and that could still open a code span
 * or an emphasis. A backtick left as text always could. An asterisk, underscore or tilde could
 * when what follows is not a space, or has not arrived yet, and is not punctuation straight after
 * a letter or digit; an underscore inside a word cannot.
 */
function lastOpener(tokens: readonly Token[], atEnd: boolean): Opener | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    const last = atEnd && i === tokens.length - 1;
    const children = (token as Tokens.Generic).tokens;
    if (token.type === 'text' && !children?.length) {
      const opener = openerIn(token.raw, last);
      if (opener) return opener;
    } else if (children && token.type !== 'link' && token.type !== 'image') {
      const opener = lastOpener(children, last);
      if (opener) return opener;
    }
  }
  return null;
}

function openerIn(raw: string, atEnd: boolean): Opener | null {
  let found: Opener | null = null;
  for (const match of raw.matchAll(DELIMITERS)) {
    const run = match[0];
    const at = match.index;
    if (canOpen(run, raw[at - 1], raw[at + run.length], atEnd)) found = { at, raw };
  }
  return found;
}

/** Whether a delimiter run, between `before` and `next`, could open a code span or an emphasis. */
function canOpen(
  run: string,
  before: string | undefined,
  next: string | undefined,
  atEnd: boolean,
) {
  if (run[0] === '`') return true;
  if (next === undefined ? !atEnd : WHITESPACE.test(next)) return false;
  const afterWord = before !== undefined && WORD.test(before);
  if (afterWord && next !== undefined && PUNCTUATION.test(next)) return false;
  if (run[0] === '_' && afterWord) return false;
  return !(run[0] === '~' && run.length > 2);
}

/** Where a fenced code block's half-written fence line starts, or null when it has none. */
function heldFence(block: Token, tail: string): number | null {
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(block.raw);
  if (!fence) return null;
  const lineStart = tail.lastIndexOf('\n') + 1;
  // An opening fence whose info string is still arriving.
  if (!block.raw.includes('\n')) return lineStart;
  // A closing fence, or a line of the fence's own marker that may yet grow into one. The block's
  // own last line, since in a quote or a list item the source line starts with their markers.
  const closing = fence[1]![0] === '`' ? /^ {0,3}`+\s*$/ : /^ {0,3}~+\s*$/;
  const last = block.raw.slice(block.raw.lastIndexOf('\n') + 1);
  const open = !tail.endsWith('\n') && closing.test(last);
  return open ? lineStart : null;
}

/**
 * Where a paragraph that starts like a table row starts, while it is a header row whose delimiter
 * row has not arrived, or is arriving, and so a table once it does.
 */
function heldHeaderRow(block: Token, tail: string): number | null {
  if (!/^ {0,3}\|/.test(block.raw)) return null;
  const lines = block.raw.trimEnd().split('\n');
  if (lines.length > 2) return null;
  // A second line that has ended, or that can no longer be a delimiter row, made no table.
  if (lines.length === 2 && (tail.endsWith('\n') || !/^[\s|:-]*$/.test(lines[1]!))) return null;
  const first = tail.lastIndexOf(lines[0]!.trim());
  return first < 0 ? null : tail.lastIndexOf('\n', first - 1) + 1;
}

/** Where `tail` is cut so its last block shows nothing half written, or null to show all of it. */
function holdBackAt(tail: string, tokens: readonly Token[]): number | null {
  const block = lastBlock(tokens);
  if (!block) return null;
  if (block.type === 'code') return heldFence(block, tail);
  if (block.type === 'table') return tail.endsWith('\n') ? null : tail.lastIndexOf('\n') + 1;
  const header = block.type === 'paragraph' ? heldHeaderRow(block, tail) : null;
  if (header !== null) return header;
  const inline = (block as Tokens.Generic).tokens;
  const opener = inline ? lastOpener(inline, true) : null;
  if (!opener) return null;
  const at = tail.lastIndexOf(opener.raw);
  return at >= 0 ? at + opener.at : null;
}

/** `tail` lexed, cut back until nothing at its end is half written. */
function lexHeldBack(tail: string, links: Links): { tokens: Token[]; links: Links } {
  for (;;) {
    const lexer = new Lexer();
    Object.assign(lexer.tokens.links, links);
    const tokens = lexer.lex(tail);
    const cut = holdBackAt(tail, tokens);
    if (cut === null || cut >= tail.length) return { tokens, links: tokens.links };
    tail = tail.slice(0, cut);
  }
}

/** Adds the link references `token` defines, in a quote or a list item too, as marked does. */
function addDefinitions(token: Token, links: Links) {
  if (token.type === 'def') {
    const def = token as Tokens.Def;
    links[def.tag] ??= { href: def.href, title: def.title };
  }
  const inner =
    token.type === 'list'
      ? (token as Tokens.List).items
      : token.type === 'blockquote' || token.type === 'list_item'
        ? (token as Tokens.Generic).tokens
        : undefined;
  for (const child of inner ?? []) addDefinitions(child, links);
}

function sameLinks(next: Links, previous: Links): boolean {
  const names = Object.keys(next);
  if (names.length !== Object.keys(previous).length) return false;
  return names.every(
    (name) =>
      previous[name]?.href === next[name]!.href && previous[name]?.title === next[name]!.title,
  );
}

/**
 * Lexes a source that grows, keeping the blocks before the last one from the lex before. A source
 * that does not start with the one before is lexed whole, as is one whose new tail defines a link
 * reference or changes one, since that can change a block already kept.
 */
export class MarkdownStream {
  private source = '';
  /** The blocks before the last one, whose raw text is the start of the source exactly. */
  private settled: Token[] = [];
  /** How much of the source the settled blocks are. */
  private settledLength = 0;
  /** The link references the settled blocks define. */
  private settledLinks: Links = {};
  /** The link references the whole source defines. */
  private links: Links = {};

  lex(text: string): Token[] {
    const source = text.replace(/\r\n?/g, '\n');
    const grown = source.startsWith(this.source);
    let settled = grown ? this.settled : [];
    let offset = grown ? this.settledLength : 0;
    let links = grown ? this.settledLinks : {};
    let tail = lexHeldBack(source.slice(offset), links);
    if (settled.length && !sameLinks(tail.links, this.links)) {
      settled = [];
      offset = 0;
      links = {};
      tail = lexHeldBack(source, links);
    }
    this.settle(source, settled, offset, links, tail.tokens);
    this.source = source;
    this.links = tail.links;
    return [...settled, ...tail.tokens];
  }

  /**
   * Keeps the tail's blocks before its last one as settled, as far as their raw text is the
   * source's: marked trims some blocks' raw text, and the lex after starts again from there.
   */
  private settle(source: string, settled: Token[], offset: number, links: Links, tail: Token[]) {
    const last = lastIndexOfBlock(tail);
    const kept = [...settled];
    const keptLinks = { ...links };
    for (let i = 0; i < last; i++) {
      const token = tail[i]!;
      if (!source.startsWith(token.raw, offset)) break;
      kept.push(token);
      offset += token.raw.length;
      addDefinitions(token, keptLinks);
    }
    this.settled = kept;
    this.settledLength = offset;
    this.settledLinks = keptLinks;
  }
}
