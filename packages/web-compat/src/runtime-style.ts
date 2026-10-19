import {
  boundDeclaration,
  tokenFromValue,
  type Engine,
  type EngineNode,
  type StyleRule,
  type StyleSheet,
  type TokenValue,
} from '@ng-native/fabric';
import { CSSStyleSheet, DETACH, sheetOfElement, type CSSRule } from './css-style-sheet.ts';
import { supportsCondition } from './supports-condition.ts';
import { transitionOf, transitionPart } from './transition-style.ts';
import { declarationsIn, pieces, withoutComments } from './css-style-declaration.ts';
import { partsOf } from './css-grammar.ts';
import { tokenize } from './css-tokens.ts';
import { isOneColour } from './specified-colour.ts';
import { SYSTEM_COLOURS } from './css-colour-names.ts';
import {
  asksAboutHas,
  asksAboutSiblings,
  readSelectorList,
  readSelectors,
  type ReadSelector,
} from './runtime-selector.ts';
import { documentOf } from './document.ts';
import { topOf } from './document-roots.ts';
import { own, type Reflection } from './reflect.ts';
import { engineOf } from './window.ts';
import { CompatEvent } from './events.ts';
import { WeakList } from './weak-list.ts';
import { domError } from './dom-error.ts';

/**
 * A `<style>` a component makes for itself while the app runs: a carousel's item width, by its
 * own id, written once it knows how many it shows; a toast's width under a breakpoint. A
 * stylesheet is compiled when the app is built, so a small one made on the device is read here.
 *
 * ponytail: what a component writes this way and no more. Selectors as `runtime-selector.ts`
 * reads them; `@media` by a width; lengths in `px`, `rem` and `%`, or one token; the layout
 * properties below, and colours as they are written. No shorthand but `flex`, `margin`,
 * `padding` and `inset`. A rule or a declaration outside that is passed over and said.
 * `@supports` holds for what is read here, which is `CSS.supports` too. A library's whole theme
 * is the build's to compile: see `isTheBuilds`.
 */

type Declarations = Record<string, unknown>;

const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const LENGTHS = new Set([
  ...['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
  ...['top', 'right', 'bottom', 'left', 'gap', 'row-gap', 'column-gap', 'flex-basis'],
  ...['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  ...['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  ...['font-size', 'border-radius', 'border-width'],
]);
const NUMBERS = new Set(['flex-grow', 'flex-shrink', 'opacity', 'z-index', 'order']);
const WORDS: Readonly<Record<string, readonly string[]>> = {
  display: ['none', 'flex', 'block', 'inline-flex', 'inline-block', 'grid', 'contents'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'flex-wrap': ['wrap', 'nowrap', 'wrap-reverse'],
  'align-items': ['flex-start', 'flex-end', 'center', 'stretch', 'baseline'],
  'align-self': ['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline'],
  'justify-content': [
    ...['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
  ],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  'text-align': ['left', 'right', 'center', 'justify'],
  'pointer-events': ['none', 'auto'],
  visibility: ['visible', 'hidden', 'collapse'],
};
const COLOURS = new Set(['color', 'background-color', 'border-color']);
/** A shape's paint, which is a colour too. */
const PAINTED = new Set(['fill', 'stroke']);

const camel = (name: string): string =>
  name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** A length as the engine has one: points, a percentage as written, or `auto`. */
function length(value: string): number | string | undefined {
  if (value === 'auto' || /^-?[\d.]+%$/.test(value)) return value;
  const [, number, unit] = /^(-?[\d.]+)(px|rem|vw|vh)?$/.exec(value) ?? [];
  if (number === undefined || (unit === undefined && Number(number) !== 0)) return undefined;
  return Number(number) * (unit ? POINTS[unit]!() : 1);
}

/**
 * The window a sheet is read in, for a length that is a share of it.
 *
 * ponytail: the share is worked out as the sheet is read, and a device turned afterwards keeps
 * it. Read the sheet again on a resize if a dialog is seen the wrong width after a turn.
 */
let screen = { width: 0, height: 0 };
const POINTS: Readonly<Record<string, () => number>> = {
  px: () => 1,
  rem: () => 16,
  vw: () => screen.width / 100,
  vh: () => screen.height / 100,
};

/** One to four lengths as a value a side, as `margin` and `padding` give them. */
function sides(box: string, value: string, out: Declarations): boolean {
  const each = value.split(/\s+/).map(length);
  if (!each.length || each.length > 4 || each.includes(undefined)) return false;
  const name = (side: string) => (box === 'inset' ? side.toLowerCase() : `${box}${side}`);
  SIDES.forEach((side, at) => (out[name(side)] = each[at] ?? each[at - 2] ?? each[0]));
  return true;
}

/** `flex: 1 0 33%`, a number alone, `auto` or `none`. */
function flex(value: string, out: Declarations): boolean {
  const named: Record<string, string> = { auto: '1 1 auto', none: '0 0 auto' };
  const [grow, shrink = '1', basis = '0%'] = (named[value] ?? value).split(/\s+/);
  const from = length(basis);
  if (!/^[\d.]+$/.test(grow ?? '') || !/^[\d.]+$/.test(shrink) || from === undefined) return false;
  Object.assign(out, { flexGrow: Number(grow), flexShrink: Number(shrink), flexBasis: from });
  return true;
}

/** A value of one word: a length, a number, a keyword or a colour, by what its property takes. */
function single(name: string, value: string): unknown {
  if (LENGTHS.has(name)) return length(value);
  if (NUMBERS.has(name)) return /^-?[\d.]+$/.test(value) ? Number(value) : undefined;
  if (WORDS[name]) return WORDS[name].includes(value) ? value : undefined;
  const colour = COLOURS.has(name) && /^(#[\da-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(value);
  // A word that is a colour's name, and not any word; a system colour as the one it is.
  if (!colour || !isOneColour(partsOf(value))) return undefined;
  return SYSTEM_COLOURS[value.toLowerCase()] ?? value;
}

/**
 * `content`, which makes a generated box: the string it writes, or `none` for no box. Nothing
 * for what is more than a string, a counter or an `attr()`.
 */
function content(value: string, out: Declarations): boolean {
  const [token, ...more] = tokenize(value.trim());
  const written =
    token?.type === 'string'
      ? token.value
      : /^(none|normal)$/i.test(value.trim())
        ? 'none'
        : undefined;
  if (written === undefined || more.length) return false;
  out['content'] = written;
  return true;
}

/** A shape's paint, kept as written for the engine to make its brush of: a chart's theme. */
function paint(name: string, value: string, out: Declarations): boolean {
  const read = /^(none|currentcolor)$/i.test(value) || single('color', value) !== undefined;
  if (read) out[name] = /^currentcolor$/i.test(value) ? 'currentColor' : value;
  return read;
}

/** The declarations read by more than one value, each by what reads it. */
const READERS: Readonly<
  Record<string, (name: string, value: string, out: Declarations) => boolean>
> = {
  flex: (_, value, out) => flex(value, out),
  content: (_, value, out) => content(value, out),
  // `background: red`, a colour alone, which is all this reads of the shorthand.
  background: (_, value, out) => declare('background-color', value, out),
  fill: paint,
  stroke: paint,
  margin: sides,
  padding: sides,
  inset: sides,
  transition: (_, value, out) => !!Object.assign(out, transitionOf(value, transitioned)),
  ...Object.fromEntries(
    ['property', 'duration', 'delay', 'timing-function'].map((part) => [
      `transition-${part}`,
      (name: string, value: string, out: Declarations) =>
        !!Object.assign(out, transitionPart(camel(name), value, transitioned)),
    ]),
  ),
};

/** The props a property sets, learnt by declaring it: one that takes no length is its own name. */
function transitioned(property: string): readonly string[] {
  const set: Declarations = {};
  declare(property, '1px', set);
  const props = Object.keys(set);
  return props.length ? props : [camel(property)];
}

/** Write one declaration as the props it is, and answer whether it was one this reads. */
function declare(name: string, value: string, out: Declarations): boolean {
  const reader = Object.hasOwn(READERS, name) ? READERS[name] : undefined;
  if (reader) return reader(name, value, out);
  const read = single(name, value);
  if (read !== undefined) out[camel(name)] = read;
  return read !== undefined;
}

const said = new Set<string>();
function pass(what: string): void {
  if (said.has(what)) return;
  said.add(what);
  console.warn(`[angular-native] a <style> made while the app runs: ${what} is not read.`);
}

type Deferred = NonNullable<StyleRule['deferred']>[number];

/** The props a property that takes one value is written as, and the kind of value it takes. */
function propsOf(name: string): { props: string[]; kind: string } | undefined {
  if (name === 'margin' || name === 'padding') {
    return { props: SIDES.map((side) => `${name}${side}`), kind: 'length' };
  }
  if (LENGTHS.has(name)) return { props: [camel(name)], kind: 'length' };
  return COLOURS.has(name) ? { props: [camel(name)], kind: 'color' } : undefined;
}

/**
 * `padding: var(--pad)`: a token, settled by the engine where the rule applies, as one in a
 * stylesheet the build compiled is. Nothing for a value that is more than the one token.
 */
function deferred(name: string, value: string): Deferred | undefined {
  // A colour made of others, `color-mix(in srgb, red, white 20%)`, worked out the same way:
  // what a chart library brightens a colour of its palette with, having asked if it may.
  //
  // ponytail: not a mix of a token, `color-mix(in srgb, var(--brand), white 20%)`, which the
  // engine does not work out yet: passed over and said, and `CSS.supports` says no to it.
  if (/^color-mix\(/i.test(value) && (COLOURS.has(name) || PAINTED.has(name))) {
    if (/var\(/i.test(value)) return undefined;
    return boundDeclaration(camel(name), tokenFromValue(value)) ?? undefined;
  }
  const [, reference] = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value) ?? [];
  const written = reference && propsOf(name);
  return written ? ({ ...written, reference } as unknown as Deferred) : undefined;
}

/**
 * Whether a declaration is one a `<style>` made at run time is read with: what `CSS.supports`
 * answers, since what a script styles after asking it styles here. A custom property takes any
 * value, as it does in a browser. A value marked `!important` is no value.
 */
export function readsDeclaration(property: string, value: string): boolean {
  const name = property.trim();
  if (name.startsWith('--')) return /^--[\w-]+$/.test(name);
  const lower = name.toLowerCase();
  const written = value.trim();
  return !!deferred(lower, written) || declare(lower, written, {});
}

/** Whether every selector of a list is one a `<style>` made at run time is read with. */
export const readsSelector = (text: string): boolean => readSelectorList(text) !== undefined;

/** Whether a `@supports` condition holds, by what this reads: see `supports-condition.ts`. */
export const readsCondition = (text: string): boolean =>
  supportsCondition(text, { declaration: readsDeclaration, selector: readsSelector });

interface Declared {
  readonly plain: Declarations;
  readonly important: Declarations;
  readonly later: Deferred[];
  /** Its custom properties, and the names of those marked `!important`. */
  readonly tokens: Record<string, TokenValue>;
  readonly importantTokens: string[];
}

/** The plain and the important declarations of a block, and those that wait for a token. */
function declarations(block: string): Declared {
  const plain: Declarations = {};
  const important: Declarations = {};
  const later: Deferred[] = [];
  const { tokens, importantTokens } = customProperties(block);
  for (const each of block.split(';')) {
    const at = each.indexOf(':');
    if (at < 0) continue;
    if (each.slice(0, at).trim().startsWith('--')) continue;
    const name = each.slice(0, at).trim().toLowerCase();
    const written = each.slice(at + 1).trim();
    const value = written.replace(/\s*!important$/i, '');
    const token = deferred(name, value);
    if (token) later.push(token);
    // What a box takes from its parent, or has with no rule, is not a value of its own here.
    else if (CSS_WIDE.test(value)) pass(`'${name}: ${value}'`);
    else if (!declare(name, value, value === written ? plain : important)) {
      pass(`'${name}: ${value}'`);
    }
  }
  return { plain, important, later, tokens, importantTokens };
}

/** A block's custom properties as the engine keeps them, and those marked `!important`. */
function customProperties(block: string): Pick<Declared, 'tokens' | 'importantTokens'> {
  const written: Record<string, string> = {};
  const marked = tokensIn(block, written);
  const tokens: Record<string, TokenValue> = {};
  for (const [name, value] of Object.entries(written)) {
    const token = tokenFromValue(value);
    if (token) tokens[name] = token;
  }
  return { tokens, importantTokens: [...marked].filter((name) => name in tokens) };
}

/** Whether a block declares anything this reads. */
const says = ({ plain, important, later, tokens }: Declared): boolean =>
  Object.keys(plain).length + Object.keys(important).length + later.length > 0 ||
  Object.keys(tokens).length > 0;

/** A selector's rule, with what its block declares, at its place in its sheet. */
function ruleFor(
  selected: ReadSelector,
  { plain, important, later, tokens, importantTokens }: Declared,
  order: number,
  condition: StyleRule['condition'] | undefined,
): StyleRule {
  return {
    ...selected,
    order,
    declarations: plain,
    ...(Object.keys(important).length ? { important } : {}),
    ...(later.length ? { deferred: later } : {}),
    ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(importantTokens.length ? { importantTokens } : {}),
    ...(condition ? { condition } : {}),
  } as StyleRule;
}

/** `@media screen and (max-width: 920px)` as the width it is for. */
function conditionOf(media: string): StyleRule['condition'] | null | undefined {
  if (!media) return undefined;
  const [, bound, value] = /\((max|min)-width:\s*([\d.]+)px\)/.exec(media) ?? [];
  if (!bound) return null;
  return {
    feature: 'width',
    op: bound === 'max' ? 'lte' : 'gte',
    value: Number(value),
  } as StyleRule['condition'];
}

/**
 * Say a query is not read, where what it holds declares something: a library writes an empty
 * rule under a query to be told when the query matches, which is nothing not read.
 */
function passMedia(media: string, text: string): void {
  if (text.includes(':')) pass(`'${media.trim()}'`);
}

/** The tokens a block gives: every custom property in it, as written. Answers those `!important`. */
function tokensIn(block: string, tokens: Record<string, string>): ReadonlySet<string> {
  const important = new Set<string>();
  for (const [name, { value, important: marked }] of declarationsIn(block)) {
    // One marked important is the one that holds, whatever is written after it.
    if (!name.startsWith('--') || (important.has(name) && !marked)) continue;
    if (marked) important.add(name);
    tokens[name] = value.trim();
  }
  return important;
}

/**
 * Read what an at-rule holds, and answer whether it was one: under `@media` by its width, and
 * under `@supports` where the condition holds as this reader answers it.
 */
function readAtRule(
  head: string,
  body: string,
  media: string,
  read: (text: string, media: string) => void,
): boolean {
  if (!head.startsWith('@')) return false;
  const supports = /^@supports\s([\s\S]*)$/i.exec(head);
  if (!supports) read(body, head);
  else if (readsCondition(supports[1]!)) read(body, media);
  return true;
}

/**
 * A stylesheet's text as the rules the engine matches. What it gives the root as tokens, under
 * no condition, is put in `tokens`: a library's palette, which its shapes are painted by.
 */
export function sheetOf(
  css: string,
  window = { width: 0, height: 0 },
  tokens: Record<string, string> = {},
): StyleSheet {
  screen = window;
  const rules: StyleRule[] = [];
  /** The rules in `text`, under `media`, nested in a rule for `parent` where there is one. */
  const read = (text: string, media: string, parent?: string): void => {
    const condition = conditionOf(media);
    if (condition === null) return passMedia(media, text);
    const { blocks, declared } = blocksIn(text);
    // What a rule declares, before or after the rules in it, is one rule that comes first.
    if (parent !== undefined && declared) readRule(parent, declared, rules, condition);
    for (const [head, body] of blocks) {
      if (readAtRule(head, body, media, (inner, at) => read(inner, at, parent))) continue;
      if (parent === undefined && head === ':root' && !media) {
        tokensIn(body, tokens);
        continue;
      }
      read(body, media, parent === undefined ? head : nestedIn(head, parent));
    }
  };
  read(withoutComments(css), '');
  return sheetFrom(rules);
}

/** The rules of `selector` for what `block` declares, put in `rules`. */
function readRule(
  selector: string,
  block: string,
  rules: StyleRule[],
  condition: StyleRule['condition'] | undefined,
): void {
  const declared = declarations(block);
  for (const selected of readSelectors(selector) ?? []) {
    if (!selected) pass(`the selector in '${selector}'`);
    else if (says(declared)) rules.push(ruleFor(selected, declared, rules.length, condition));
  }
}

/** A sheet's or a rule's text as the blocks in it, `head { body }`, and what is declared between. */
function blocksIn(text: string): { blocks: [string, string][]; declared: string } {
  const blocks: [string, string][] = [];
  let declared = '';
  for (const piece of pieces(
    text,
    (char, depth) => depth === 0 && (char === '}' || char === ';'),
  )) {
    const open = piece.indexOf('{');
    if (open >= 0 && piece.endsWith('}'))
      blocks.push([piece.slice(0, open).trim(), piece.slice(open + 1, -1)]);
    else declared += piece.endsWith(';') ? piece : `${piece};`;
  }
  return { blocks, declared };
}

/**
 * A rule nested in one for `parent`, as a selector of its own: each `&` is `:is(parent)`, as
 * specific as the most specific of it, and a selector with none is of what is in the parent,
 * `> .x` of what is a child of it and `+ .x` of what is next to it.
 */
function nestedIn(head: string, parent: string): string {
  const outer = `:is(${parent})`;
  return pieces(head, (char, depth) => depth === 0 && char === ',')
    .map((one) => one.replace(/,$/, '').trim())
    .map((one) => withParent(one, outer) ?? `${outer} ${one}`)
    .join(', ');
}

/** A selector with each `&` outside a string as `outer`, or nothing where it has none. */
function withParent(selector: string, outer: string): string | undefined {
  let written = '';
  let quote = '';
  let found = false;
  for (let at = 0; at < selector.length; at++) {
    const char = selector[at]!;
    if (char === '\\') {
      written += char + (selector[++at] ?? '');
      continue;
    }
    if (quote) quote = char === quote ? '' : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === '&') {
      written += outer;
      found = true;
      continue;
    }
    written += char;
  }
  return found ? written : undefined;
}

/** A sheet of these rules, marked for what the engine is to watch for them: see `StyleSheet`. */
function sheetFrom(rules: StyleRule[]): StyleSheet {
  const placed = rules.some(asksAboutSiblings);
  const has = rules.some(asksAboutHas);
  // A rule for a `::before` or an `::after`, which the engine looks for only in a sheet that says so.
  const generated = rules.some((rule) =>
    /^::(before|after)$/.test(rule.compounds.at(-1)?.type ?? ''),
  );
  return {
    rules,
    ...(placed ? { structural: true } : {}),
    ...(has ? { has: true } : {}),
    ...(generated ? { generated: true } : {}),
  };
}

/**
 * The sheet each `<style>` is read as while it is in the page, and the tokens it gave the root;
 * and so of each sheet a script made, for each document that adopted it.
 */
const sheets = new WeakMap<object, StyleSheet>();
const rooted = new WeakMap<object, string[]>();

/** Set the root's tokens as a sheet gives them now, and unset those it gave and no longer does. */
function root(owner: object, tokens: Readonly<Record<string, string>>, engine: Engine): void {
  for (const name of rooted.get(owner) ?? []) {
    if (!(name in tokens)) engine.setCustomProperty(engine.root, name, null);
  }
  for (const [name, value] of Object.entries(tokens)) {
    engine.setCustomProperty(engine.root, name, value);
  }
  rooted.set(owner, Object.keys(tokens));
}

interface Applied {
  readonly sheet: StyleSheet;
  readonly tokens: Readonly<Record<string, string>>;
}

/** Have the engine match what a sheet is read as now, in the place it had; or nothing at all. */
function apply(owner: object, engine: Engine, read?: Applied): void {
  const had = sheets.get(owner);
  if (read || rooted.has(owner)) root(owner, read?.tokens ?? {}, engine);
  if (read) {
    sheets.set(owner, read.sheet);
    engine.addGlobalSheet(read.sheet, had);
  } else if (had) {
    sheets.delete(owner);
    engine.removeGlobalSheet(had);
  }
}

/** As much as a component writes for itself: a theme is thousands of rules. */
const OWN_SHEET = 4096;

/**
 * Whether a `<style>` is one the build compiled already: a library's own, which it names with
 * an id of its style, or one too long to be a component's. Read again here it would be a second
 * of work for rules the app has, in a reader that knows a part of what they say.
 */
const isTheBuilds = (node: EngineNode, text: string): boolean =>
  text.length > OWN_SHEET ||
  Object.keys(node.props).some((name) => /^data-.+-style-id$/.test(name));

const textOf = (node: EngineNode): string =>
  node.childList.map((child) => (child.nodeKind === 'text' ? (child.nodeText ?? '') : '')).join('');

/**
 * Whether a `<style>` is in the page: under the engine's root, or in the document's head. One in
 * a tree that is in neither, or in a document a script made, styles nothing: see
 * `dom-implementation.ts`.
 */
function inPage(node: EngineNode, engine: Engine): boolean {
  const top = topOf(node);
  return top === engine.root || top === documentOf(engine)?.head;
}

/**
 * The text each `<style>` was last read with while it was in the page: none for one out of it.
 * What it is read as is read again when that changes, which is all that changes what it says.
 */
const readWith = new WeakMap<EngineNode, string>();

/** Read a `<style>` again: as it comes into the page, as it leaves, and as what it holds changes. */
function restyle(node: EngineNode, engine: Engine): void {
  // Its text, or its place, is new: a script reads its rules afresh, as a browser makes a new sheet.
  forget(node);
  const page = pageOf(engine);
  const placed = inPage(node, engine);
  const text = placed ? textOf(node) : '';
  if (placed) {
    page.add(node);
    readWith.set(node, text);
    loadLater(node, engine);
  } else {
    page.delete(node);
    readWith.delete(node);
  }
  if (!text.trim() || isTheBuilds(node, text)) return apply(node, engine);
  const tokens: Record<string, string> = {};
  apply(node, engine, { sheet: sheetOf(text, engine.viewport, tokens), tokens });
}

/** The `<style>` elements each engine made, held weakly: those to look at as the tree changes. */
const made = new WeakMap<Engine, WeakList<EngineNode>>();
/** What unwraps each engine's methods, for one that has made a `<style>` since its app came up. */
const unhooks = new Map<Engine, () => void>();

/**
 * Read again each `<style>` of an engine whose place in the page or whose text is not what it
 * was read with: one put in, taken out or moved in or out of the page with what it is in, and
 * one whose text was set, added or taken away.
 */
function readChanged(engine: Engine): void {
  made.get(engine)?.forEach((node) => {
    const placed = inPage(node, engine);
    const had = readWith.get(node);
    if (placed ? had !== textOf(node) : had !== undefined) restyle(node, engine);
  });
}

/** A stylesheet's box: none, as a browser's own sheet has it, so its rules are not drawn as text. */
const NO_BOX = { display: 'none' };

/**
 * A `<style>` made in an app that is up, by a template, a script, markup or a copy: drawn as
 * nothing, and read as it comes into the page, leaves it and is given its text. Its engine's
 * tree is watched from the first one made, and not before: an app with no `<style>` of a
 * library's pays nothing for it.
 */
export function styleMade(node: EngineNode, engine: Engine): void {
  engine.setDefaultStyle(node, NO_BOX);
  if (!watched.has(engine)) return;
  const all = made.get(engine) ?? made.set(engine, new WeakList()).get(engine)!;
  all.add(new WeakRef(node));
  if (!unhooks.has(engine)) unhooks.set(engine, hook(engine));
}

/** The engines of the apps that are up, whose `<style>` elements are read. */
const watched = new WeakSet<Engine>();

/** Read the `<style>` elements of an app's engine while it is up. Answers what stops it. */
export function watchStyles(engine: Engine): () => void {
  watched.add(engine);
  return () => {
    watched.delete(engine);
    unhooks.get(engine)?.();
    unhooks.delete(engine);
    made.delete(engine);
    for (const node of [...pageOf(engine)]) unstyle(node, engine);
  };
}

const HOOKED = ['appendChild', 'insertBefore', 'removeChild', 'setText'] as const;

/**
 * Look at an engine's `<style>` elements as its tree changes, at once, however it changes: by a
 * template, a script or markup. Answers what unwraps its methods again, where nothing has
 * wrapped them over these since, as `mutation-observer.ts` does.
 */
function hook(engine: Engine): () => void {
  const own = engine as unknown as Record<string, unknown>;
  const before = HOOKED.map((key) => (Object.hasOwn(own, key) ? own[key] : undefined));
  const { appendChild, insertBefore, removeChild, setText } = engine;
  engine.appendChild = function (parent, child) {
    appendChild.call(this, parent, child);
    readChanged(engine);
  };
  engine.insertBefore = function (parent, child, next) {
    insertBefore.call(this, parent, child, next);
    readChanged(engine);
  };
  engine.removeChild = function (parent, child) {
    removeChild.call(this, parent, child);
    readChanged(engine);
  };
  engine.setText = function (node, value) {
    setText.call(this, node, value);
    if (node.parent?.tag === 'style') readChanged(engine);
  };
  const wrappers = HOOKED.map((key) => own[key]);
  return () => {
    if (HOOKED.some((key, at) => own[key] !== wrappers[at])) return;
    HOOKED.forEach((key, at) => {
      if (before[at] === undefined) delete own[key];
      else own[key] = before[at];
    });
  };
}

/** The `<style>` elements told their sheet has loaded in the next task. */
const loading = new WeakSet<EngineNode>();

/**
 * Tell a `<style>` whose sheet is new that it has loaded, in a task of its own, as a browser
 * does once what it imports is in: here that is nothing, which is in at once.
 */
function loadLater(node: EngineNode, engine: Engine): void {
  if (loading.has(node)) return;
  loading.add(node);
  setTimeout(() => {
    loading.delete(node);
    if (!pageOf(engine).has(node)) return;
    const target = node as unknown as { dispatchEvent?(event: unknown): boolean };
    target.dispatchEvent?.(new CompatEvent('load'));
  }, 0);
}

/** Stop matching a `<style>`, and what a script wrote in its sheet. */
function unstyle(node: EngineNode, engine: Engine): void {
  forget(node);
  pageOf(engine).delete(node);
  apply(node, engine);
}

/** The sheet a script reads of each `<style>`, made the first time it asks: see `sheetOfStyle`. */
const scripted = new WeakMap<EngineNode, CSSStyleSheet>();
/** Forget the sheet a script read of a `<style>`, which is then the sheet of no element. */
function forget(node: EngineNode): void {
  scripted.get(node)?.[DETACH]();
  scripted.delete(node);
}
/** The `<style>` elements in each page, in the order they were put in it. */
const pages = new WeakMap<Engine, Set<EngineNode>>();
const pageOf = (engine: Engine): Set<EngineNode> =>
  pages.get(engine) ?? pages.set(engine, new Set()).get(engine)!;

/**
 * The rules of a sheet as the engine matches them: each rule's text read once, until it
 * changes, and numbered in the order of the sheet. A library that inserts a rule at the end, as
 * one does for every class it makes, has the rules before it read and numbered already.
 */
function readRules(rules: readonly CSSRule[], engine: Engine): Applied {
  const tokens: Record<string, string> = {};
  const all: StyleRule[] = [];
  for (const rule of rules) {
    const read = rule.readBy((text) => {
      const own: Record<string, string> = {};
      return { rules: [...sheetOf(text, engine.viewport, own).rules], tokens: own };
    });
    Object.assign(tokens, read.tokens);
    read.rules.forEach((each, at) => {
      const numbered = each.order === all.length ? each : { ...each, order: all.length };
      read.rules[at] = numbered;
      all.push(numbered);
    });
  }
  return { sheet: sheetFrom(all), tokens };
}

/**
 * What applies each sheet a script has changed, run once the script is done: a library inserts
 * a rule for every class it makes, one after another, and the engine takes in a whole sheet each
 * time it is given one. `getComputedStyle` runs them first, as a browser styles before it answers.
 */
const due = new Map<object, () => void>();

function later(owner: object, run: () => void): void {
  if (!due.size) queueMicrotask(applyChanged);
  due.set(owner, run);
}

/** Apply every sheet a script has changed and that is not applied yet. */
export function applyChanged(): void {
  for (const [owner, run] of due) {
    due.delete(owner);
    run();
  }
}

/** Apply a sheet a script has changed: its rules as they are now, or none while it is off. */
function reapply(owner: object, sheet: CSSStyleSheet, engine: Engine): void {
  const read = sheet.disabled ? undefined : readRules(sheet.cssRules, engine);
  const empty = !read?.sheet.rules.length && !Object.keys(read?.tokens ?? {}).length;
  if (!unchanged(owner, read)) apply(owner, engine, empty ? undefined : read);
}

/**
 * Whether a sheet is read as the same rules as before, or none where there were none, and gives
 * the root no token: a sheet the engine takes in is every node styled again, and a library
 * writes rules that declare nothing.
 */
function unchanged(owner: object, read: Applied | undefined): boolean {
  if (Object.keys(read?.tokens ?? {}).length || rooted.get(owner)?.length) return false;
  const rules = read?.sheet.rules ?? [];
  const had = sheets.get(owner)?.rules ?? [];
  return rules.length === had.length && rules.every((rule, at) => rule === had[at]);
}

/**
 * `style.sheet`: the rules of a `<style>` in the page, which a script inserts and deletes, or
 * none for one out of it. Made from its text when first asked for; a change through it is
 * applied as a change of the text would be, and leaves the text as it is.
 */
function sheetOfStyle(node: EngineNode, engine: Engine): CSSStyleSheet | null {
  if (!pageOf(engine).has(node)) return null;
  const had = scripted.get(node);
  if (had) return had;
  const sheet = sheetOfElement(node, () => textOf(node));
  // Only while it is the element's: one whose element left the page, or was given new text,
  // is a sheet of no page. And a theme the build compiled stays the build's, rules and all.
  const applies = () => scripted.get(node) === sheet && !isTheBuilds(node, textOf(node));
  sheet.watchers.add(() => later(node, () => applies() && reapply(node, sheet, engine)));
  scripted.set(node, sheet);
  return sheet;
}

/**
 * `sheet` of a `<style>`: the rules a script reads, or none out of the page. A `<link>` loads no
 * stylesheet here, and has none.
 */
export const STYLE_SHEETS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  style: { sheet: own((node) => sheetOfStyle(node, engineOf(node))) },
  link: { sheet: own(() => null) },
};

/** `document.styleSheets`: the sheet of each `<style>` in the page. */
export const styleSheetsOf = (engine: Engine): CSSStyleSheet[] =>
  [...pageOf(engine)].map((node) => sheetOfStyle(node, engine)).filter((sheet) => sheet !== null);

/** The sheets a script made that each document has adopted, each with what stops applying it. */
const adopted = new WeakMap<Engine, Map<CSSStyleSheet, () => void>>();

/**
 * Each document's `adoptedStyleSheets`: one array, the same each time it is read, which a
 * script changes in place too, `push` and `splice`, as a browser's observable array is. Each
 * change is applied as it is made. A sheet there twice is there twice.
 */
const arrays = new WeakMap<
  Engine,
  { readonly backing: CSSStyleSheet[]; readonly array: CSSStyleSheet[] }
>();

/** An index of an array, which a sheet must be put at. */
const isIndex = (key: string | symbol): boolean =>
  typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key);

/** What a document may adopt: a sheet a script made, and nothing else. */
function checkAdoptable(value: unknown): void {
  if (!(value instanceof CSSStyleSheet))
    throw new TypeError('A document adopts only a CSSStyleSheet.');
  if (value.ownerNode)
    throw domError('A document adopts only a sheet a script made.', 'NotAllowedError');
}

function arrayOf(engine: Engine): { backing: CSSStyleSheet[]; array: CSSStyleSheet[] } {
  const had = arrays.get(engine);
  if (had) return had;
  const backing: CSSStyleSheet[] = [];
  const array = new Proxy(backing, {
    set(target, key, value, receiver) {
      if (isIndex(key)) checkAdoptable(value);
      const done = Reflect.set(target, key, value, receiver);
      applyAdopted(engine, target);
      return done;
    },
    deleteProperty(target, key) {
      const done = Reflect.deleteProperty(target, key);
      applyAdopted(engine, target);
      return done;
    },
  });
  const made = { backing, array };
  arrays.set(engine, made);
  return made;
}

/** `document.adoptedStyleSheets`, as it is. */
export const adoptedOf = (engine: Engine): CSSStyleSheet[] => arrayOf(engine).array;

/** `document.adoptedStyleSheets = sheets`: the array is what they are, and is applied. */
export function adopt(engine: Engine, wanted: Iterable<CSSStyleSheet>): void {
  const list = [...wanted];
  for (const sheet of list) checkAdoptable(sheet);
  const { backing } = arrayOf(engine);
  backing.splice(0, backing.length, ...list);
  applyAdopted(engine, backing);
}

/**
 * Apply what a document adopts: those new to it, stop those gone, and again, in their new
 * order, those from the first whose place in the cascade changed. A sheet there twice is where
 * it is the last time. A hole, which a script can leave, is passed over.
 */
function applyAdopted(engine: Engine, list: readonly (CSSStyleSheet | undefined)[]): void {
  const sheets = list.filter((sheet): sheet is CSSStyleSheet => sheet instanceof CSSStyleSheet);
  const order = sheets.filter((sheet, at) => sheets.lastIndexOf(sheet) === at);
  const had = adopted.get(engine) ?? new Map<CSSStyleSheet, () => void>();
  const kept = [...had.keys()].filter((sheet) => order.includes(sheet));
  let same = 0;
  while (same < kept.length && kept[same] === order[same]) same++;
  for (const [sheet, stop] of had) if (!order.slice(0, same).includes(sheet)) stop();
  const next = new Map<CSSStyleSheet, () => void>();
  for (const [at, sheet] of order.entries()) {
    next.set(sheet, at < same ? had.get(sheet)! : adoptOne(sheet, engine));
  }
  adopted.set(engine, next);
}

/** Apply a sheet a document adopts as it changes, under a name of its own in each document. */
function adoptOne(sheet: CSSStyleSheet, engine: Engine): () => void {
  const watcher = (): void => later(watcher, () => reapply(watcher, sheet, engine));
  sheet.watchers.add(watcher);
  watcher();
  return () => {
    sheet.watchers.delete(watcher);
    due.delete(watcher);
    apply(watcher, engine);
  };
}
