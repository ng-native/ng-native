import type { EngineNode } from '@ng-native/fabric';
import { inDocument } from './in-document.ts';
import { HTML_NAMESPACE, SVG_NAMESPACE } from './html-tree.ts';
import { domError } from './dom-error.ts';
import { engineOf } from './window.ts';

/**
 * `innerText` and `outerText`: an element's text as it is rendered, by HTML's rendered text
 * collection steps. What is rendered is what the styles written say, on the element in its
 * `style` attribute or by a stylesheet's rule the engine keeps, else what a browser's own
 * stylesheet gives an element of its name: `display`, `visibility`, `white-space`,
 * `text-transform`, `float` and `position`. No layout is asked: a line is what the boxes make
 * it, never where text wraps.
 *
 * ponytail: a pseudo-element's style (`::first-line`) and its content are not read, nor a
 * stylesheet's value the engine drops, `display: table` among them.
 */

type Dom = EngineNode & {
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  readonly textContent: string;
  readonly parentNode: Dom | null;
  readonly previousSibling: EngineNode | null;
  readonly nextSibling: EngineNode | null;
  readonly ownerDocument: { createElement(name: string): EngineNode } | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  insertBefore(node: EngineNode, before: EngineNode | null): unknown;
  removeChild(node: EngineNode): unknown;
  replaceChild(node: EngineNode, old: EngineNode): unknown;
  replaceChildren(...nodes: EngineNode[]): void;
};

/** What a browser's own stylesheet displays an element of each name as, where not inline. */
const DISPLAY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    (
      'address article aside blockquote body center dd details dialog dir div dl dt fieldset ' +
      'figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html legend li listing ' +
      'main menu nav ol optgroup option p plaintext pre search section summary ul xmp'
    )
      .split(' ')
      .map((name) => [name, 'block']),
  ),
  ...Object.fromEntries(
    'area base basefont datalist head link meta noembed noframes param rp script style template title'
      .split(' ')
      .map((name) => [name, 'none']),
  ),
  table: 'table',
  caption: 'table-caption',
  colgroup: 'table-column-group',
  col: 'table-column',
  thead: 'table-header-group',
  tbody: 'table-row-group',
  tfoot: 'table-footer-group',
  tr: 'table-row',
  td: 'table-cell',
  th: 'table-cell',
  ruby: 'ruby',
  rt: 'ruby-text',
  button: 'inline-block',
  input: 'inline-block',
  textarea: 'inline-block',
};

/** Elements whose content is none of what is rendered: a picture, a control, a frame. */
const REPLACED = new Set(
  'audio canvas embed iframe img input object textarea video meter progress'.split(' '),
);

/** SVG's elements whose text is drawn, and those that draw what they hold. */
const SVG_DRAWN = new Set('a g svg switch text textPath tspan foreignObject'.split(' '));

/** A table's parts, whose own text between rows and cells is never rendered. */
const TABLE_PARTS = /^table(-row|-row-group|-header-group|-footer-group)?$|^inline-table$/;

/** The display of a box laid out as a block, or as a part of a table, where it is blockified. */
const BLOCKIFIED: Readonly<Record<string, string>> = {
  inline: 'block',
  'inline-block': 'block',
  'inline-table': 'table',
  'inline-flex': 'flex',
  'inline-grid': 'grid',
  ruby: 'block',
};

const dashed = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** One declaration of a `style` attribute kept as written, as a browser parses it. */
function fromText(text: string, name: string): string | undefined {
  let found: string | undefined;
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== name) continue;
    found = declaration
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim()
      .toLowerCase();
  }
  return found;
}

/** The element's own declaration of a property, as `element.style` reads it. */
function ownDeclaration(node: EngineNode, key: string): string | undefined {
  const block = (node as unknown as { style?: { getPropertyValue?(name: string): string } }).style;
  return block?.getPropertyValue?.(dashed(key)) || undefined;
}

/** What is written for a property on an element: inline, or by a rule the engine keeps. */
function declared(node: EngineNode, key: string): string | undefined {
  const inline = node.props['style'];
  const style = inline as Record<string, unknown> | undefined;
  const own =
    ownDeclaration(node, key) ??
    (typeof inline === 'string'
      ? fromText(inline, dashed(key))
      : (style?.[key] ?? style?.[dashed(key)]));
  const value = own ?? node.styleCache?.style[key];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

const isHtml = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && (node as Dom).namespaceURI === HTML_NAMESPACE;
const nameOf = (node: EngineNode): string => (node as Dom).localName ?? node.tag;

/** The white space a browser's stylesheet gives an element of each name. */
const WHITE_SPACE: Readonly<Record<string, string>> = {
  pre: 'pre',
  listing: 'pre',
  plaintext: 'pre',
  xmp: 'pre',
  textarea: 'pre-wrap',
};

/** A property inherited down the tree: the nearest element's that writes one, or `initial`. */
function inherited(node: EngineNode | null, key: string, initial: string): string {
  for (let at = node; at; at = at.parent) {
    if (at.nodeKind !== 'element') continue;
    const value =
      declared(at, key) ??
      (key === 'whiteSpace' && isHtml(at) ? WHITE_SPACE[nameOf(at)] : undefined);
    if (value !== undefined && value !== 'inherit') return value;
  }
  return initial;
}

/** An element's display, before what its parent makes of it. */
function ownDisplay(node: EngineNode): string {
  const name = nameOf(node);
  // A browser's stylesheet hides these whatever is written.
  if (name === 'noscript' && isHtml(node)) return 'none';
  const written = declared(node, 'display');
  if (written) return written;
  if (!isHtml(node)) return 'inline';
  if ((node as Dom).hasAttribute('hidden')) return 'none';
  if (name === 'audio' && !(node as Dom).hasAttribute('controls')) return 'none';
  return DISPLAY[name] ?? 'inline';
}

/** An element's display as laid out: a float, an absolute box, and a flex or grid item are blocks. */
function displayOf(node: EngineNode): string {
  const display = ownDisplay(node);
  if (display === 'none' || display === 'contents') return display;
  const parent = node.parent;
  const inFlexOrGrid = parent?.nodeKind === 'element' && /flex|grid/.test(ownDisplay(parent));
  const float = declared(node, 'float');
  const position = declared(node, 'position');
  const out = (float && float !== 'none') || position === 'absolute' || position === 'fixed';
  return inFlexOrGrid || out ? (BLOCKIFIED[display] ?? display) : display;
}

/** Whether a drawing puts a child in a box: its own elements that draw, and no HTML. */
function drawsChild(parent: EngineNode, child: EngineNode): boolean {
  if ((parent as Dom).namespaceURI !== SVG_NAMESPACE || nameOf(parent) === 'foreignObject') {
    return true;
  }
  return isHtml(child) ? false : child.nodeKind !== 'element' || SVG_DRAWN.has(nameOf(child));
}

const isHtmlNamed = (node: EngineNode, pattern: RegExp): boolean =>
  isHtml(node) && pattern.test(nameOf(node));

/** Whether a child of `parent` is put in a box at all, by what the parent is. */
function rendersChild(parent: EngineNode, child: EngineNode): boolean {
  if (parent.nodeKind !== 'element') return true;
  if (!isHtml(parent)) return drawsChild(parent, child);
  const name = nameOf(parent);
  if (REPLACED.has(name)) return false;
  if (name === 'select') return isHtmlNamed(child, /^(option|optgroup)$/);
  // An option list's group holds options alone; one out of a list is a block like any other.
  if (name === 'optgroup' && parent.parent && nameOf(parent.parent) === 'select') {
    return isHtmlNamed(child, /^option$/);
  }
  if (name !== 'details' || (parent as Dom).hasAttribute('open')) return true;
  return child === inDocument(parent).find((each) => isHtmlNamed(each, /^summary$/));
}

/** Whether an element is rendered in the page: in the app, with a box, as is all it is in. */
function beingRendered(node: EngineNode): boolean {
  let at: EngineNode = node;
  for (; at.parent; at = at.parent) {
    if (at.nodeKind === 'element' && displayOf(at) === 'none') return false;
    if (!rendersChild(at.parent, at)) return false;
  }
  return at === engineOf(node).root;
}

// The rendered text collection steps, as a list of what each node gives.

/** A count of required line breaks, the text of a box as it is written, or a forced break. */
type Item =
  | { readonly lines: number }
  | { readonly text: string; readonly space: string }
  | { readonly atom: string }
  | { readonly literal: string };

function transformed(text: string, transform: string, node: EngineNode): string {
  if (transform === 'none') return text;
  const lang = langOf(node);
  if (transform === 'uppercase') return text.toLocaleUpperCase(lang);
  if (transform === 'lowercase') return text.toLocaleLowerCase(lang);
  if (transform === 'capitalize') {
    return text.replace(
      /(^|[\s\p{P}])(\p{L})/gu,
      (_, before: string, letter: string) => before + letter.toLocaleUpperCase(lang),
    );
  }
  return text;
}

/** The language an element's text is in, by the nearest `lang` written. */
function langOf(node: EngineNode): string | undefined {
  for (let at: EngineNode | null = node; at; at = at.parent) {
    if (at.nodeKind !== 'element') continue;
    const lang = (at as Dom).getAttribute?.('lang');
    if (lang) return lang;
  }
  return undefined;
}

/** Whether a node is the last of its kind, a cell in its row or a row in its table. */
function lastOf(node: EngineNode, display: string, within: EngineNode | null): boolean {
  if (!within) return true;
  const found: EngineNode[] = [];
  const walk = (at: EngineNode): void => {
    for (const child of inDocument(at)) {
      if (child.nodeKind !== 'element') continue;
      const shown = displayOf(child);
      if (shown === display) found.push(child);
      // A cell's own rows are its own table's, and a row's cells are its own.
      else if (!/^(table|inline-table|table-row|table-cell)$/.test(shown)) walk(child);
    }
  };
  walk(within);
  return found.at(-1) === node;
}

/** The table a row is in: its nearest that is one. */
function tableOf(node: EngineNode): EngineNode | null {
  for (let at = node.parent; at; at = at.parent) {
    if (at.nodeKind === 'element' && /^(inline-)?table$/.test(displayOf(at))) return at;
  }
  return null;
}

function collectChildren(node: EngineNode): Item[] {
  return inDocument(node)
    .filter((child) => rendersChild(node, child))
    .flatMap((child) => collect(child));
}

/** What one node gives: its text, and the breaks and tabs its box puts around it. */
function collect(node: EngineNode): Item[] {
  if (node.nodeKind === 'text') return textItems(node);
  if (node.nodeKind !== 'element') return [];
  const display = displayOf(node);
  if (display === 'none') return [];
  if (display === 'contents') return collectChildren(node);
  const visible = inherited(node, 'visibility', 'visible') === 'visible';
  const name = isHtml(node) ? nameOf(node) : '';
  if (name === 'br') return visible ? [{ literal: '\n' }] : [];
  const items: Item[] = REPLACED.has(name) ? [] : collectChildren(node);
  return visible ? boxed(node, name, display, items) : items;
}

/** What a rendered element's box puts around what it holds: none, a tab, or line breaks. */
function boxed(node: EngineNode, name: string, display: string, held: Item[]): Item[] {
  let items = held;
  const atomic =
    /^inline-(block|table|flex|grid)$/.test(display) ||
    (REPLACED.has(name) && !/^(block|flex|grid|list-item|table)/.test(display));
  if (atomic) items = [{ atom: joined(items) }];
  if (display === 'table-cell') {
    items = [{ lines: 0 }, ...items, { lines: 0 }];
    if (!lastOf(node, 'table-cell', node.parent)) items.push({ literal: '\t' });
  }
  if (display === 'table-row' && !lastOf(node, 'table-row', tableOf(node))) {
    items.push({ lines: 1 });
  }
  if (name === 'p') items = [{ lines: 2 }, ...items, { lines: 2 }];
  const block = /^(block|flex|grid|list-item|table|flow-root|table-caption)$/.test(display);
  if (block || name === 'option' || name === 'optgroup') {
    items = [{ lines: 1 }, ...items, { lines: 1 }];
  }
  return items;
}

function textItems(node: EngineNode): Item[] {
  const parent = node.parent;
  if (inherited(parent, 'visibility', 'visible') !== 'visible') return [];
  const text = node.nodeText ?? '';
  // What is between a table's rows and cells is no box's.
  if (parent && /^[ \t\n\r\f]*$/.test(text) && TABLE_PARTS.test(displayOf(parent))) return [];
  const space = inherited(parent, 'whiteSpace', 'normal');
  const transform = inherited(parent, 'textTransform', 'none');
  return [{ text: transformed(text, transform, node), space }];
}

/** A character of a line, and whether it is a space that collapses into one beside it. */
interface Piece {
  readonly text: string;
  readonly soft: boolean;
}

const COLLAPSIBLE = /[ \t\n\r\f]/;

/**
 * The items as text: spaces collapsed as CSS does where the white space they are in says, none at
 * the start or end of a line, and each run of required line breaks the most of them in it.
 */
function joined(items: readonly Item[]): string {
  const out: (string | number)[] = [];
  let line: Piece[] = [];
  const endLine = () => {
    while (line.at(-1)?.soft) line.pop();
    const text = line.map((piece) => piece.text).join('');
    if (text) out.push(text);
    line = [];
  };
  const space = () => {
    const last = line.at(-1);
    if (last && !last.soft) line.push({ text: ' ', soft: true });
  };
  for (const item of items) {
    if ('lines' in item) {
      endLine();
      out.push(item.lines);
    } else if ('literal' in item) {
      endLine();
      out.push(item.literal);
    } else if ('atom' in item) line.push({ text: item.atom, soft: false });
    else addText(item.text, item.space, { line: () => line, space, endLine, out });
  }
  endLine();
  return finish(out);
}

interface Lines {
  line(): Piece[];
  space(): void;
  endLine(): void;
  readonly out: (string | number)[];
}

function addText(text: string, whiteSpace: string, lines: Lines): void {
  const keepsSpaces = /^(pre|pre-wrap|break-spaces)$/.test(whiteSpace);
  const keepsBreaks = keepsSpaces || whiteSpace === 'pre-line';
  const parts = keepsBreaks ? text.replace(/\r\n?/g, '\n').split('\n') : [text];
  parts.forEach((part, at) => {
    if (at > 0) {
      lines.endLine();
      lines.out.push('\n');
    }
    for (const char of part) {
      if (keepsSpaces || !COLLAPSIBLE.test(char)) lines.line().push({ text: char, soft: false });
      else lines.space();
    }
  });
}

/** The text and line break counts as one string: counts at the ends are none. */
function finish(out: readonly (string | number)[]): string {
  let text = '';
  let pending = -1;
  for (const each of out) {
    if (typeof each === 'number') {
      pending = Math.max(pending, each);
      continue;
    }
    if (text && pending > 0) text += '\n'.repeat(pending);
    pending = -1;
    text += each;
  }
  return text;
}

/** `innerText` read: the text rendered, or all the text where the element is not rendered. */
export function innerText(node: EngineNode): string | undefined {
  if (!isHtml(node)) return undefined;
  if (!beingRendered(node)) return (node as Dom).textContent;
  return joined(collectChildren(node));
}

/** The text and `<br>`s a string is, as `innerText` and `outerText` are set: each line break one. */
function textFragment(node: Dom, value: unknown): EngineNode[] {
  const text = value === null ? '' : String(value);
  const engine = engineOf(node);
  const nodes: EngineNode[] = [];
  text.split(/\r\n|\r|\n/).forEach((line, at) => {
    if (at > 0) nodes.push(node.ownerDocument!.createElement('br'));
    if (line) nodes.push(engine.createText(line));
  });
  return nodes;
}

/** `innerText` written: what the element holds replaced with the text and its line breaks. */
export function setInnerText(node: EngineNode, value: unknown): void {
  if (!isHtml(node)) return;
  const dom = node as Dom;
  dom.replaceChildren(...textFragment(dom, value));
}

/** Join a text to the one after it, where both are texts. */
function mergeWithNext(node: EngineNode | null | undefined): void {
  const next = (node as Dom | null)?.nextSibling;
  if (node?.nodeKind !== 'text' || next?.nodeKind !== 'text') return;
  engineOf(node).setText(node, (node.nodeText ?? '') + (next.nodeText ?? ''));
  (node.parent as Dom).removeChild(next);
}

/** `outerText` written: the element replaced with the text, joined to the texts beside it. */
export function setOuterText(node: EngineNode, value: unknown): void {
  if (!isHtml(node)) return;
  const dom = node as Dom;
  const parent = dom.parentNode;
  if (!parent) {
    throw domError('An element in no parent cannot be replaced.', 'NoModificationAllowedError');
  }
  const previous = dom.previousSibling;
  const next = dom.nextSibling;
  const nodes = textFragment(dom, value);
  if (nodes.length === 0) nodes.push(engineOf(node).createText(''));
  for (const each of nodes) parent.insertBefore(each, dom);
  parent.removeChild(dom);
  mergeWithNext(next ? (next as Dom).previousSibling : null);
  mergeWithNext(previous);
}
