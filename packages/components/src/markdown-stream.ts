/**
 * A Markdown source that grows as it streams in, lexed a chunk at a time: the blocks before the
 * last one are kept, only the last is lexed again, and syntax still open at its end is held back
 * until it closes, so a half-written code span, emphasis, link, image, table row or code fence
 * line never shows as the characters it is written with.
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

/** A text token marked left as text, and where it is in the tail, or -1 when it was not found. */
interface Leaf {
  readonly raw: string;
  readonly at: number;
}

/**
 * The text tokens in `inline`, in order, each found in `tail` after the one before it, starting
 * from `from`. A link or an image is passed over whole, as it closed.
 */
function leavesOf(inline: readonly Token[], tail: string, from: number, leaves: Leaf[] = []) {
  let cursor = from;
  for (const token of inline) {
    const at = tail.indexOf(token.raw, cursor);
    const children = (token as Tokens.Generic).tokens;
    if (token.type === 'text' && !children?.length) leaves.push({ raw: token.raw, at });
    else if (children && token.type !== 'link' && token.type !== 'image') {
      leavesOf(children, tail, at < 0 ? cursor : at, leaves);
    }
    if (at >= 0) cursor = at + token.raw.length;
  }
  return leaves;
}

/**
 * Where the first delimiter in a text token at `at` in `tail` is that could still open a code span
 * or an emphasis. A backtick left as text always could. An asterisk, underscore or tilde could
 * when what follows is not a space, or has not arrived yet, and is not punctuation straight after
 * a letter or digit; an underscore inside a word cannot. What is before and after the delimiter
 * is read from `tail`, since a text token can end where another token starts.
 */
function openerIn(raw: string, at: number, tail: string): number | null {
  for (const match of raw.matchAll(DELIMITERS)) {
    const from = at + match.index;
    const next = tail[from + match[0].length];
    if (canOpen(match[0], tail[from - 1], next)) return from;
  }
  return null;
}

/** Whether a delimiter run, between `before` and `next`, could open a code span or an emphasis. */
function canOpen(run: string, before: string | undefined, next: string | undefined) {
  if (run[0] === '`') return true;
  if (next !== undefined && WHITESPACE.test(next)) return false;
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
  // A closing fence, or a line of the fence's own marker that may yet grow into one: a run too
  // short to close it can grow only while nothing follows it. The block's own last line, since in
  // a quote or a list item the source line starts with their markers.
  const closing = fence[1]![0] === '`' ? /^ {0,3}(`+)(\s*)$/ : /^ {0,3}(~+)(\s*)$/;
  const last = closing.exec(block.raw.slice(block.raw.lastIndexOf('\n') + 1));
  const grows = last && (!last[2] || last[1]!.length >= fence[1]!.length);
  return grows && !tail.endsWith('\n') ? lineStart : null;
}

/**
 * Where a paragraph that starts like a table row starts, while it is a header row whose delimiter
 * row has not arrived, or is arriving, and so a table once it does.
 */
function heldHeaderRow(block: Token, tail: string): number | null {
  const lines = block.raw.trimEnd().split('\n');
  // A header row has a pipe, leading or not, as in marked's table syntax.
  if (!lines[0]!.includes('|')) return null;
  if (lines.length > 2) return null;
  // A second line that has ended, or that can no longer be a delimiter row, made no table.
  if (lines.length === 2 && (tail.endsWith('\n') || !/^[\s|:-]*$/.test(lines[1]!))) return null;
  const first = tail.lastIndexOf(lines[0]!.trim());
  return first < 0 ? null : tail.lastIndexOf('\n', first - 1) + 1;
}

/**
 * From where in `tail` a bracket starts an unfinished link: a label still open, a label that a
 * target may yet follow, or a target still open. Each has at most one closing bracket after its
 * opening one, so the two last closing brackets in `tail` bound where it can start.
 */
function unfinishedLinksFrom(tail: string): number {
  const close = tail.lastIndexOf(']');
  if (close < 0) return 0;
  const after = tail.slice(close + 1);
  const open = after === '' || after[0] === '[' || (after[0] === '(' && !after.includes(')'));
  return open ? tail.lastIndexOf(']', close - 1) + 1 : close + 1;
}

/**
 * Where the first unfinished link, code span or emphasis in `inline` starts in `tail`, found in
 * one pass over its text tokens. Cutting at the first, rather than the last, means the source is
 * lexed again only when the cut opens a span that closed after it, not once for each delimiter
 * that never closes.
 */
function heldInline(inline: readonly Token[], tail: string, start: number): number | null {
  const leaves = leavesOf(inline, tail, start);
  const links = unfinishedLinksFrom(tail);
  for (const { raw, at } of leaves) {
    if (at < 0) continue;
    const opener = openerIn(raw, at, tail);
    for (let bracket = raw.indexOf('['); bracket >= 0; bracket = raw.indexOf('[', bracket + 1)) {
      const from = at + bracket;
      if (opener !== null && from > opener) break;
      if (from >= links) return tail[from - 1] === '!' ? from - 1 : from;
    }
    if (opener !== null) return opener;
  }
  return null;
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
  return inline ? heldInline(inline, tail, floorOf(tail, tokens)) : null;
}

/**
 * Where the last block starts in `tail`, inside a quote or a list item too, found by its first
 * line since there each source line starts with their markers.
 */
function floorOf(tail: string, tokens: readonly Token[]): number {
  const block = lastBlock(tokens);
  if (!block) return tail.length;
  // Its whole source when that is in the tail as it is, since its first line can come again.
  const whole = tail.lastIndexOf(block.raw.trimEnd());
  return Math.max(0, whole >= 0 ? whole : tail.lastIndexOf(block.raw.split('\n')[0]!));
}

/** A line's quote and list item markers, up to where the block they hold starts. */
const MARKERS = /^(?:[ \t]*(?:>|[-+*](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*$/;

/**
 * Where the markers before `at` on its line start, when only markers are before it, or `at`. A
 * block held back whole takes its markers with it, or a list item marker left behind would join
 * the paragraph before it.
 */
function markersStart(tail: string, at: number): number {
  const line = tail.lastIndexOf('\n', at - 1) + 1;
  return MARKERS.test(tail.slice(line, at)) ? line : at;
}

/**
 * `tail` lexed, cut back until nothing at its end is half written. Only its last block is cut:
 * once a cut reaches where that block starts, the blocks before it, in its quote or list item
 * too, are drawn as they are.
 */
function lexHeldBack(tail: string, links: Links): { tokens: Token[]; links: Links } {
  let floor: number | undefined;
  for (;;) {
    const lexer = new Lexer();
    Object.assign(lexer.tokens.links, links);
    const tokens = lexer.lex(tail);
    floor ??= floorOf(tail, tokens);
    const cut = floor < tail.length ? holdBackAt(tail, tokens) : null;
    if (cut === null || cut >= tail.length) return { tokens, links: tokens.links };
    tail = tail.slice(0, cut > floor ? cut : markersStart(tail, floor));
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
