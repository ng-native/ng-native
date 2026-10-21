import { CHANGED } from './css-rule.ts';
import { tokenize } from './css-tokens.ts';
import {
  ALIASES,
  FONT_FACE_DESCRIPTORS,
  LONGHANDS,
  PAGE_DESCRIPTORS,
  SHORTHANDS,
} from './css-properties.ts';
import {
  PROPERTIES,
  canonicalName,
  declarationsOf,
  isImportant,
  mappedAfter,
  parseBlock,
  propertyValue,
  removeFrom,
  serializeBlock,
  setIn,
  type Block,
  type Vocabulary,
} from './declaration-block.ts';

/**
 * A declaration block as a script reads and writes it (https://drafts.csswg.org/cssom/#the-cssstyledeclaration-interface):
 * a rule's `style`, and an element's. Each property is also an attribute of it on its prototype,
 * by its camel-cased name and by its own, `style.backgroundColor` and `style['background-color']`.
 * Writing one changes what it is the style of, and so what the engine applies.
 */

export interface Entry {
  value: string;
  important: boolean;
}

const OPENS = new Set(['{', '(', '[']);
const CLOSES = new Set(['}', ')', ']']);

/**
 * Text with each comment in it a space, as a comment parts what is either side of it: one in a
 * string is the string's.
 */
export function withoutComments(css: string): string {
  let out = '';
  let quote = '';
  for (let at = 0; at < css.length; at++) {
    const char = css[at]!;
    if (quote) {
      out += char;
      if (char === '\\') out += css[++at] ?? '';
      else if (char === quote) quote = '';
    } else if (char === '/' && css[at + 1] === '*') {
      const end = css.indexOf('*/', at + 2);
      at = end < 0 ? css.length : end + 1;
      out += ' ';
    } else {
      if (char === '"' || char === "'") quote = char;
      out += char;
    }
  }
  return out;
}

/**
 * Text cut where `ends` says, at a depth of brackets it is given: never in a string, nor in a
 * comment, which is dropped.
 */
export function pieces(css: string, ends: (char: string, depth: number) => boolean): string[] {
  const text = withoutComments(css);
  const found: string[] = [];
  let depth = 0;
  let from = 0;
  let quote = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (quote) {
      if (char === '\\') at++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '\\') {
      at++;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    depth = Math.max(0, depth + (OPENS.has(char) ? 1 : CLOSES.has(char) ? -1 : 0));
    if (!ends(char, depth)) continue;
    found.push(text.slice(from, at + 1));
    from = at + 1;
  }
  found.push(text.slice(from));
  return found.map((each) => each.trim()).filter(Boolean);
}

/** `color: red !important` as its name and what it is set to, or nothing for no declaration. */
export function entryOf(text: string): [string, Entry] | undefined {
  const at = text.indexOf(':');
  if (at <= 0) return undefined;
  // One whose name is no identifier, `}color`, is no declaration. A name is read as CSS reads
  // an identifier, `--a\;b` as `--a;b`.
  const [token, ...more] = tokenize(text.slice(0, at)).filter((each) => each.type !== 'whitespace');
  if (token?.type !== 'ident' || more.length) return undefined;
  // A custom property is named as it is written; any other, in any case.
  const name = token.value.startsWith('--') ? token.value : token.value.toLowerCase();
  const declared = text
    .slice(at + 1)
    .replace(/;$/, '')
    .trim();
  const important = /!\s*important$/i.test(declared);
  const value = declared.replace(/\s*!\s*important$/i, '');
  return value || name.startsWith('--') ? [name, { value, important }] : undefined;
}

/** What follows an at-rule in a list of declarations, which is read on as declarations. */
function afterAtRule(piece: string): string {
  const [rule] = pieces(piece, (char, depth) => depth === 0 && char === '}');
  return rule?.endsWith('}') ? piece.slice(piece.indexOf(rule) + rule.length) : '';
}

/** The declarations of a block's text, `color: red; width: 0`, each by its name, in order. */
export const declarationsIn = (text: string): [string, Entry][] =>
  pieces(text, (char, depth) => depth === 0 && char === ';').flatMap((piece): [string, Entry][] => {
    if (piece.startsWith('@')) return declarationsIn(afterAtRule(piece));
    const entry = entryOf(piece);
    return entry ? [entry] : [];
  });

/** `backgroundColor` as the property it is, `background-color`. */
export const dashed = (name: string): string =>
  name === 'cssFloat'
    ? 'float'
    : name
        .replace(/^(webkit|moz|ms)(?=[A-Z])/, '-$1')
        .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * What a block is the style of: what it tells of a change, and, for an element's, what the
 * engine is given and what a binding has set since.
 */
export interface Hooks {
  readonly parentRule: object | null;
  /** Make a change, and tell of it after. */
  change(run: () => void): void;
  /** A property declared, by its name, or taken away with `null`, and the longhands it took. */
  declared?(name: string, value: string | null, gone: readonly string[]): void;
  /** Every declaration taken away, and those of a new text declared in their place. */
  replaced?(entries: readonly (readonly [string, string, boolean])[]): void;
  /** What a property reads, given what is declared of it. */
  read?(name: string, declared: string): string;
}

/** The block, what it is the style of, and what it may declare. */
export const BLOCK = Symbol('block');
const HOOKS = Symbol('hooks');
const VOCABULARY = Symbol('vocabulary');
const INDEX = Symbol('index');

/** What a rule is told: that it has changed. */
export const ruleHooks = (rule: { [CHANGED](): void } | null): Hooks => ({
  parentRule: rule,
  change(run) {
    run();
    rule?.[CHANGED]();
  },
});

/** The declarations of a text a block takes, each by its canonical name, as written. */
function validEntries(text: string, vocabulary: Vocabulary): [string, string, boolean][] {
  return declarationsIn(text).flatMap(
    ([written, { value, important }]): [string, string, boolean][] => {
      const name = canonicalName(written, vocabulary);
      return name && declarationsOf(name, value, important, vocabulary)
        ? [[name, value, important]]
        : [];
    },
  );
}

export class CSSStyleDeclaration {
  [BLOCK]: Block;
  readonly [HOOKS]: Hooks;
  readonly [VOCABULARY]: Vocabulary;

  constructor(text: string, hooks: Hooks, vocabulary: Vocabulary = PROPERTIES) {
    this[HOOKS] = hooks;
    this[VOCABULARY] = vocabulary;
    this[BLOCK] = parseBlock(declarationsIn(text), vocabulary);
    this[INDEX]();
  }

  get parentRule(): object | null {
    return this[HOOKS].parentRule;
  }
  get cssText(): string {
    return serializeBlock(this[BLOCK]);
  }
  set cssText(text: string) {
    const written = text === null ? '' : String(text);
    this[HOOKS].change(() => replaceDeclarations(this, written));
  }
  get length(): number {
    return this[BLOCK].size;
  }
  item(index: number): string {
    return [...this[BLOCK].keys()][Number(index) >>> 0] ?? '';
  }
  getPropertyValue(property: string): string {
    const name = canonicalName(String(property), this[VOCABULARY]);
    if (name === undefined) return '';
    const declared = propertyValue(this[BLOCK], name);
    return this[HOOKS].read ? this[HOOKS].read(name, declared) : declared;
  }
  getPropertyPriority(property: string): string {
    const name = canonicalName(String(property), this[VOCABULARY]);
    return name !== undefined && isImportant(this[BLOCK], name) ? 'important' : '';
  }
  setProperty(property: string, value: unknown, priority: unknown = ''): void {
    const name = canonicalName(String(property), this[VOCABULARY]);
    if (name === undefined) return;
    // A `DOMString` that takes `null` as empty: `undefined` is the word, and a symbol none.
    const text = value === null ? '' : `${value as string}`;
    if (!text.trim()) return void this.removeProperty(name);
    const flag = priority === null ? '' : String(priority).toLowerCase();
    if (flag !== '' && flag !== 'important') return;
    const set = declarationsOf(name, text, flag === 'important', this[VOCABULARY]);
    if (!set) return;
    const block = this[BLOCK];
    // Nothing is told of a value that is what it was.
    const moves = set.some(([longhand]) => block.has(longhand) && mappedAfter(block, longhand));
    if (!moves && set.every(([longhand, each]) => sameAs(block.get(longhand), each))) return;
    this[HOOKS].change(() => {
      setIn(block, set);
      this[HOOKS].declared?.(name, text.trim(), []);
      this[INDEX]();
    });
  }
  removeProperty(property: string): string {
    const name = canonicalName(String(property), this[VOCABULARY]);
    if (name === undefined) return '';
    const had = this.getPropertyValue(name);
    if (!removable(this[BLOCK], name)) return had;
    this[HOOKS].change(() => {
      const gone = removeFrom(this[BLOCK], name);
      this[HOOKS].declared?.(name, null, gone);
      this[INDEX]();
    });
    return had;
  }
  *[Symbol.iterator](): IterableIterator<string> {
    yield* [...this[BLOCK].keys()];
  }

  /** Each declared property's name as an own property by its place, as a browser has them. */
  [INDEX](): void {
    const self = this as unknown as Record<number, unknown>;
    for (let at = this[BLOCK].size; Object.hasOwn(self, at); at++) delete self[at];
    for (let at = 0; at < this[BLOCK].size; at++) {
      if (Object.hasOwn(self, at)) continue;
      Object.defineProperty(this, at, {
        configurable: true,
        enumerable: true,
        get: () => this.item(at),
      });
    }
  }
}

/** Every declaration of a block taken away, and those of a text declared in their place. */
export function replaceDeclarations(style: CSSStyleDeclaration, text: string): void {
  style[BLOCK] = parseBlock(declarationsIn(text), style[VOCABULARY]);
  style[HOOKS].replaced?.(validEntries(text, style[VOCABULARY]));
  style[INDEX]();
}

const sameAs = (
  had: { value: string; important: boolean } | undefined,
  now: { value: string; important: boolean },
) =>
  had?.value === now.value &&
  had.important === now.important &&
  !('from' in had) &&
  !('from' in now);

/** Whether removing a property takes anything away. */
const removable = (block: Block, name: string): boolean => {
  const shorthand = SHORTHANDS.get(name);
  const longhands =
    name === 'all'
      ? [...block.keys()]
      : shorthand && shorthand.kind !== 'opaque'
        ? shorthand.longhands
        : [name];
  return longhands.some((longhand) => block.has(longhand));
};

/** A property's names as attributes: camel-cased, and with a capital for a `-webkit-` one. */
function attributeNames(name: string): string[] {
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const names = [name, camel];
  if (name.startsWith('-webkit-')) names.push(camel.replace(/^Webkit/, 'webkit'));
  if (name === 'float') names.push('cssFloat');
  return names;
}

/** Give a class's prototype an attribute for each of some properties. */
function defineAttributes(target: object, names: Iterable<string>): void {
  for (const name of names) {
    for (const attribute of attributeNames(name)) {
      if (Object.hasOwn(target, attribute)) continue;
      Object.defineProperty(target, attribute, {
        configurable: true,
        enumerable: true,
        get(this: CSSStyleDeclaration) {
          return this.getPropertyValue(name);
        },
        set(this: CSSStyleDeclaration, value: unknown) {
          this.setProperty(name, value === null ? '' : value);
        },
      });
    }
  }
}

/** A rule's or an element's style: every property, an attribute each. */
export class CSSStyleProperties extends CSSStyleDeclaration {}
defineAttributes(CSSStyleProperties.prototype, [
  ...LONGHANDS.keys(),
  ...SHORTHANDS.keys(),
  ...ALIASES.keys(),
]);

/** What a vocabulary of descriptors takes. */
const descriptors = (names: ReadonlyMap<string, string>): Vocabulary => ({
  known: (name) => names.has(name) || (name === 'margin' && names.has('margin-top')),
  grammar: (name) => names.get(name) ?? '',
});

const PAGE = descriptors(PAGE_DESCRIPTORS);
const FONT_FACE = descriptors(FONT_FACE_DESCRIPTORS);

/** What a keyframe declares: any property but an animation's own, and none `!important`. */
const KEYFRAME: Vocabulary = {
  known: (name) =>
    PROPERTIES.known(name) &&
    (!name.startsWith('animation') ||
      name === 'animation-timing-function' ||
      name === 'animation-composition'),
  grammar: PROPERTIES.grammar,
  important: false,
};

/** `@page`'s style: its descriptors, an attribute each. */
export class CSSPageDescriptors extends CSSStyleDeclaration {
  constructor(text: string, hooks: Hooks) {
    super(text, hooks, PAGE);
  }
}
defineAttributes(CSSPageDescriptors.prototype, [...PAGE_DESCRIPTORS.keys(), 'margin']);

/** `@font-face`'s style: its descriptors, an attribute each. */
export class CSSFontFaceDescriptors extends CSSStyleDeclaration {
  constructor(text: string, hooks: Hooks) {
    super(text, hooks, FONT_FACE);
  }
}
defineAttributes(CSSFontFaceDescriptors.prototype, FONT_FACE_DESCRIPTORS.keys());

/** A rule's style: the kind of block it is, by the kind of rule. */
export function declarationOf(
  text: string,
  rule: { [CHANGED](): void },
  kind: 'style' | 'page' | 'font-face' | 'keyframe' = 'style',
): CSSStyleDeclaration {
  const hooks = ruleHooks(rule);
  if (kind === 'page') return new CSSPageDescriptors(text, hooks);
  if (kind === 'font-face') return new CSSFontFaceDescriptors(text, hooks);
  return new CSSStyleProperties(text, hooks, kind === 'keyframe' ? KEYFRAME : PROPERTIES);
}
