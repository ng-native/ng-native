import { domError } from './dom-error.ts';
import { tokenize, type Token } from './css-tokens.ts';
import { serializeIdentifier, serializeString } from './css-value.ts';
import {
  CHANGED,
  CSSRule,
  CSSRuleList,
  NOWHERE,
  PLACE,
  WRITTEN,
  type Place,
  type SheetOfRules,
} from './css-rule.ts';
import {
  CSSStyleDeclaration,
  declarationOf,
  declarationsIn,
  pieces,
} from './css-style-declaration.ts';
import { MediaList } from './media-list.ts';
import { parseSelectorList } from './parse-selector.ts';
import { serializeSelectorList } from './serialize-selector.ts';

/**
 * Each kind of rule a stylesheet holds (https://drafts.csswg.org/cssom/#css-rules), read from
 * its text and written back as a browser writes it: a style rule, `@media`, `@import` and the
 * rest. An at-rule of no kind here is dropped, as a browser drops one it does not know.
 *
 * ponytail: a rule holds what it says and writes it back; the engine applies only what
 * `runtime-style.ts` reads of it. An `@import` loads nothing, so the sheet it has is empty.
 */

/** A stylesheet's text as each rule in it: a block, or an at-rule that ends at a `;`. */
export const rulesIn = (css: string): string[] =>
  pieces(css, (char, depth) => depth === 0 && (char === '}' || char === ';'));

/** A rule's text as what comes before its block, and the block, or none for a statement. */
function split(text: string): { head: string; body: string | undefined } {
  const open = indexOfBlock(text);
  if (open < 0 || !text.endsWith('}'))
    return { head: text.replace(/;$/, '').trim(), body: undefined };
  return { head: text.slice(0, open).trim(), body: text.slice(open + 1, -1) };
}

/** Where a rule's block opens: the first `{` that is in no string, and in no bracket. */
function indexOfBlock(text: string): number {
  let quote = '';
  let depth = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === '\\') at++;
    else if (quote) quote = char === quote ? '' : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === '{' && depth === 0) return at;
    else depth = Math.max(0, depth + ('([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0));
  }
  return -1;
}

/** Rules as the CSSOM writes those inside a block: each on a line of its own, indented. */
const inside = (rules: readonly CSSRule[], text: (rule: CSSRule) => string): string =>
  rules.map((rule) => `\n  ${text(rule)}`).join('') + '\n';

/** A block of declarations as a rule writes it: `{ color: red; }`, or `{ }`. */
const block = (style: CSSStyleDeclaration): string =>
  style.cssText ? `{ ${style.cssText} }` : '{ }';

/** A rule that holds rules: `insertRule` and `deleteRule` on its own list. */
export class CSSGroupingRule extends CSSRule {
  readonly #rules = new CSSRuleList();

  constructor(body: string | undefined, place: Place) {
    super(place);
    for (const each of rulesIn(body ?? '')) {
      const rule = ruleOf(each, { sheet: null, rule: this }, 'nested');
      if (rule) this.#rules.push(rule);
    }
  }

  get cssRules(): CSSRuleList {
    return this.#rules;
  }

  insertRule(text: string, index?: number): number {
    if (!arguments.length)
      throw new TypeError("Failed to execute 'insertRule': 1 argument required.");
    const at = checked(index, this.#rules.length, 0);
    const rule = oneRule(text, { sheet: null, rule: this }, 'nested');
    this.#rules.splice(at, 0, rule);
    this[CHANGED]();
    return at;
  }
  deleteRule(index: number): void {
    if (!arguments.length)
      throw new TypeError("Failed to execute 'deleteRule': 1 argument required.");
    const [gone] = this.#rules.splice(checked(index, this.#rules.length, 1), 1);
    gone![PLACE] = NOWHERE;
    this[CHANGED]();
  }

  /** The rules inside as the CSSOM writes them, or as written, for the engine. */
  protected written(head: string, as: 'cssText' | typeof WRITTEN): string {
    return `${head} {${inside(this.#rules, (rule) => rule[as])}}`;
  }
}

/** A rule of a condition: `@media`, `@supports`, `@container`. */
export class CSSConditionRule extends CSSGroupingRule {
  get conditionText(): string {
    return '';
  }
}

export class CSSMediaRule extends CSSConditionRule {
  readonly #media: MediaList;
  /** The condition as written, which the engine reads, until a script changes the list. */
  #condition: string;

  constructor(condition: string, body: string | undefined, place: Place) {
    super(body, place);
    this.#condition = condition;
    this.#media = new MediaList(condition, () => {
      this.#condition = this.#media.mediaText;
      this[CHANGED]();
    });
  }

  override get type(): number {
    return CSSRule.MEDIA_RULE;
  }
  get media(): MediaList {
    return this.#media;
  }
  set media(text: string) {
    this.#media.mediaText = text;
  }
  override get conditionText(): string {
    return this.#media.mediaText;
  }
  override get cssText(): string {
    return this.written(`@media ${this.conditionText}`, 'cssText');
  }
  override get [WRITTEN](): string {
    return this.written(`@media ${this.#condition}`, WRITTEN);
  }
}

export class CSSSupportsRule extends CSSConditionRule {
  readonly #condition: string;

  constructor(condition: string, body: string | undefined, place: Place) {
    super(body, place);
    this.#condition = condition.replace(/\s+/g, ' ');
  }

  override get type(): number {
    return CSSRule.SUPPORTS_RULE;
  }
  override get conditionText(): string {
    return this.#condition;
  }
  override get cssText(): string {
    return this.written(`@supports ${this.#condition}`, 'cssText');
  }
  override get [WRITTEN](): string {
    return this.written(`@supports ${this.#condition}`, WRITTEN);
  }
}

export class CSSContainerRule extends CSSConditionRule {
  readonly #condition: string;

  constructor(condition: string, body: string | undefined, place: Place) {
    super(body, place);
    this.#condition = condition.replace(/\s+/g, ' ');
  }

  /** The name a query is for: the identifier before it, if one is written. */
  get containerName(): string {
    const [, name] = /^(-?[_a-zA-Z][\w-]*)\s+(?!and\b|or\b)/i.exec(this.#condition) ?? [];
    return name && name.toLowerCase() !== 'not' ? name : '';
  }
  get containerQuery(): string {
    const name = this.containerName;
    return name ? this.#condition.slice(name.length).trim() : this.#condition;
  }
  override get conditionText(): string {
    return this.#condition;
  }
  override get cssText(): string {
    return this.written(`@container ${this.#condition}`, 'cssText');
  }
}

export class CSSLayerBlockRule extends CSSGroupingRule {
  readonly #name: string;

  constructor(name: string, body: string | undefined, place: Place) {
    super(body, place);
    this.#name = name.replace(/\s+/g, '');
  }

  get name(): string {
    return this.#name;
  }
  override get cssText(): string {
    return this.written(this.#name ? `@layer ${this.#name}` : '@layer', 'cssText');
  }
  override get [WRITTEN](): string {
    return this.written(this.#name ? `@layer ${this.#name}` : '@layer', WRITTEN);
  }
}

export class CSSLayerStatementRule extends CSSRule {
  readonly #names: readonly string[];

  constructor(names: readonly string[], place: Place) {
    super(place);
    this.#names = Object.freeze([...names]);
  }

  get nameList(): readonly string[] {
    return this.#names;
  }
  override get cssText(): string {
    return `@layer ${this.#names.join(', ')};`;
  }
}

export class CSSScopeRule extends CSSGroupingRule {
  readonly #start: string | null;
  readonly #end: string | null;

  constructor(prelude: string, body: string | undefined, place: Place) {
    super(body, place);
    const [, start, end] = /^(?:\(([^)]*)\))?\s*(?:to\s*\(([^)]*)\))?$/i.exec(prelude.trim()) ?? [];
    this.#start = start?.trim() || null;
    this.#end = end?.trim() || null;
  }

  get start(): string | null {
    return this.#start;
  }
  get end(): string | null {
    return this.#end;
  }
  override get cssText(): string {
    const start = this.#start === null ? '' : ` (${this.#start})`;
    const end = this.#end === null ? '' : ` to (${this.#end})`;
    return this.written(`@scope${start}${end}`, 'cssText');
  }
}

export class CSSStartingStyleRule extends CSSGroupingRule {
  override get cssText(): string {
    return this.written('@starting-style', 'cssText');
  }
}

/** A rule for a selector. One whose selector is none is no rule, as a browser drops it. */
export class CSSStyleRule extends CSSGroupingRule {
  readonly #style: CSSStyleDeclaration;
  /** The selector as it was written, which the engine reads, and as it is written back. */
  #selector: { readonly written: string; readonly text: string };

  constructor(selector: { written: string; text: string }, body: string, place: Place) {
    super('', place);
    this.#selector = selector;
    this.#style = declarationOf(body, this);
  }

  override get type(): number {
    return CSSRule.STYLE_RULE;
  }
  get style(): CSSStyleDeclaration {
    return this.#style;
  }
  set style(text: string) {
    this.#style.cssText = text;
  }
  get selectorText(): string {
    return this.#selector.text;
  }
  set selectorText(given: string) {
    const written = String(given).trim();
    const text = selectorOf(written, this.parentStyleSheet);
    if (text === undefined) return;
    this.#selector = { written, text };
    this[CHANGED]();
  }
  override get cssText(): string {
    return `${this.#selector.text} ${block(this.#style)}`;
  }
  override get [WRITTEN](): string {
    return `${this.#selector.written} ${block(this.#style)}`;
  }
}

/** A `@page` selector as it is written back, or nothing where it is none. */
function pageSelector(text: string): string | undefined {
  const written = text.trim();
  const [, name = '', pseudos = ''] =
    /^(-?[_a-zA-Z][\w-]*)?((?::(?:first|left|right|blank))*)$/i.exec(written) ?? [];
  if (written && !name && !pseudos) return undefined;
  return name + pseudos.toLowerCase();
}

export class CSSPageRule extends CSSGroupingRule {
  readonly #style: CSSStyleDeclaration;
  #selector: string;

  constructor(selector: string, body: string, place: Place) {
    super('', place);
    this.#selector = selector;
    this.#style = declarationOf(body, this, 'page');
  }

  override get type(): number {
    return CSSRule.PAGE_RULE;
  }
  get style(): CSSStyleDeclaration {
    return this.#style;
  }
  set style(text: string) {
    this.#style.cssText = text;
  }
  get selectorText(): string {
    return this.#selector;
  }
  set selectorText(given: string) {
    const text = pageSelector(String(given));
    if (text === undefined) return;
    this.#selector = text;
    this[CHANGED]();
  }
  override get cssText(): string {
    return `@page ${this.#selector ? `${this.#selector} ` : ''}${block(this.#style)}`;
  }
}

export class CSSFontFaceRule extends CSSRule {
  readonly #style: CSSStyleDeclaration;

  constructor(body: string, place: Place) {
    super(place);
    this.#style = declarationOf(body, this, 'font-face');
  }

  override get type(): number {
    return CSSRule.FONT_FACE_RULE;
  }
  get style(): CSSStyleDeclaration {
    return this.#style;
  }
  set style(text: string) {
    this.#style.cssText = text;
  }
  override get cssText(): string {
    return `@font-face ${block(this.#style)}`;
  }
}

/** A keyframe's selector, `from, 50%`, as the percentages it is, or nothing where it is none. */
function keyTextOf(text: string): string | undefined {
  const keys = String(text)
    .split(',')
    .map((each) => each.trim().toLowerCase());
  const read = keys.map((key) => {
    if (key === 'from') return '0%';
    if (key === 'to') return '100%';
    const [, number] = /^([+]?\d*\.?\d+(?:e[+-]?\d+)?)%$/.exec(key) ?? [];
    return number !== undefined && Number(number) <= 100 ? `${Number(number)}%` : undefined;
  });
  return read.includes(undefined) ? undefined : read.join(', ');
}

export class CSSKeyframeRule extends CSSRule {
  readonly #style: CSSStyleDeclaration;
  #key: string;

  constructor(key: string, body: string, place: Place) {
    super(place);
    this.#key = key;
    this.#style = declarationOf(body, this, 'keyframe');
  }

  override get type(): number {
    return CSSRule.KEYFRAME_RULE;
  }
  get style(): CSSStyleDeclaration {
    return this.#style;
  }
  set style(text: string) {
    this.#style.cssText = text;
  }
  get keyText(): string {
    return this.#key;
  }
  set keyText(given: string) {
    const key = keyTextOf(given);
    if (key === undefined) throw domError(`'${given}' is no keyframe selector.`, 'SyntaxError');
    this.#key = key;
    this[CHANGED]();
  }
  override get cssText(): string {
    return `${this.#key} ${block(this.#style)}`;
  }
}

/** One keyframe rule of text, or nothing where it is not one. */
function keyframeOf(text: string, place: Place): CSSKeyframeRule | undefined {
  const { head, body } = split(text);
  const key = body === undefined ? undefined : keyTextOf(head);
  return key === undefined ? undefined : new CSSKeyframeRule(key, body!, place);
}

/** A name as `@keyframes` writes it: as a string where it is a keyword, or no identifier. */
function keyframesName(name: string): string {
  const keyword = /^(none|initial|inherit|unset|revert|revert-layer|default)$/i.test(name);
  return keyword || !/^-?[_a-zA-Z\u0080-￿][\w\u0080-￿-]*$/.test(name)
    ? serializeString(name)
    : serializeIdentifier(name);
}

export class CSSKeyframesRule extends CSSRule {
  readonly #rules = new CSSRuleList();
  #name: string;

  constructor(name: string, body: string | undefined, place: Place) {
    super(place);
    this.#name = name;
    for (const each of rulesIn(body ?? '')) {
      const rule = keyframeOf(each, { sheet: null, rule: this });
      if (rule) this.#rules.push(rule);
    }
    this.index();
  }

  override get type(): number {
    return CSSRule.KEYFRAMES_RULE;
  }
  get name(): string {
    return this.#name;
  }
  set name(name: string) {
    this.#name = String(name);
    this[CHANGED]();
  }
  get cssRules(): CSSRuleList {
    return this.#rules;
  }
  get length(): number {
    return this.#rules.length;
  }
  appendRule(text: string): void {
    const [only, ...more] = rulesIn(String(text));
    const rule = only && !more.length ? keyframeOf(only, { sheet: null, rule: this }) : undefined;
    if (!rule) return;
    this.#rules.push(rule);
    this.changedRules();
  }
  deleteRule(select: string): void {
    const at = this.lastIndexOf(select);
    if (at < 0) return;
    const [gone] = this.#rules.splice(at, 1);
    gone![PLACE] = NOWHERE;
    this.changedRules();
  }
  findRule(select: string): CSSKeyframeRule | null {
    return (this.#rules[this.lastIndexOf(select)] as CSSKeyframeRule | undefined) ?? null;
  }
  override get cssText(): string {
    return `@keyframes ${keyframesName(this.#name)} {${inside(this.#rules, (rule) => rule.cssText)}}`;
  }

  private lastIndexOf(select: string): number {
    const key = keyTextOf(select);
    for (let at = this.#rules.length - 1; at >= 0; at--) {
      if ((this.#rules[at] as CSSKeyframeRule).keyText === key) return at;
    }
    return -1;
  }
  private changedRules(): void {
    this.index();
    this[CHANGED]();
  }
  /** Each keyframe rule as the rule's own property by its place, as a browser has them. */
  private index(): void {
    const self = this as unknown as Record<number, unknown>;
    for (let at = 0; at in self; at++) delete self[at];
    this.#rules.forEach((_, at) => {
      Object.defineProperty(this, at, {
        configurable: true,
        enumerable: true,
        get: () => this.#rules[at],
      });
    });
  }
}

/** The descriptors `@counter-style` has, each by the name of its attribute. */
const COUNTER_DESCRIPTORS = [
  ...['system', 'symbols', 'additive-symbols', 'negative', 'prefix', 'suffix', 'range'],
  ...['pad', 'speak-as', 'fallback'],
];

export class CSSCounterStyleRule extends CSSRule {
  readonly #descriptors: Map<string, string>;
  #name: string;

  constructor(name: string, body: string, place: Place) {
    super(place);
    this.#name = name;
    const entries = declarationsIn(body).filter(([key]) => COUNTER_DESCRIPTORS.includes(key));
    this.#descriptors = new Map(entries.map(([key, { value }]) => [key, value]));
  }

  override get type(): number {
    return CSSRule.COUNTER_STYLE_RULE;
  }
  get name(): string {
    return this.#name;
  }
  set name(name: string) {
    this.#name = String(name);
    this[CHANGED]();
  }
  override get cssText(): string {
    const said = [...this.#descriptors].map(([key, value]) => `${key}: ${value};`).join(' ');
    return `@counter-style ${serializeIdentifier(this.#name)} { ${said ? `${said} ` : ''}}`;
  }
  /** A descriptor by its attribute's name. */
  descriptor(key: string): string {
    return this.#descriptors.get(key) ?? '';
  }
  setDescriptor(key: string, value: string): void {
    this.#descriptors.set(key, String(value));
    this[CHANGED]();
  }
}

for (const key of COUNTER_DESCRIPTORS) {
  const attribute = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  Object.defineProperty(CSSCounterStyleRule.prototype, attribute, {
    configurable: true,
    enumerable: true,
    get(this: CSSCounterStyleRule) {
      return this.descriptor(key);
    },
    set(this: CSSCounterStyleRule, value: string) {
      this.setDescriptor(key, value);
    },
  });
}

/** `@font-feature-values`' maps, by the at-rule each is written with in it. */
const FEATURE_BLOCKS: Readonly<Record<string, string>> = {
  annotation: 'annotation',
  ornaments: 'ornaments',
  stylistic: 'stylistic',
  swash: 'swash',
  'character-variant': 'characterVariant',
  styleset: 'styleset',
};

/** A map of the names a feature is given to the numbers each stands for. */
export class CSSFontFeatureValuesMap extends Map<string, number[]> {
  override set(key: string, value: number | readonly number[]): this {
    return super.set(String(key), Array.isArray(value) ? [...value] : [Number(value)]);
  }
}

export class CSSFontFeatureValuesRule extends CSSRule {
  #family: string;
  readonly #maps: Record<string, CSSFontFeatureValuesMap> = {};

  constructor(family: string, body: string, place: Place) {
    super(place);
    this.#family = family;
    for (const name of Object.values(FEATURE_BLOCKS))
      this.#maps[name] = new CSSFontFeatureValuesMap();
    for (const each of rulesIn(body)) {
      const { head, body: inner } = split(each);
      const map = this.#maps[FEATURE_BLOCKS[head.slice(1).toLowerCase()] ?? ''];
      if (!map || inner === undefined) continue;
      for (const [key, { value }] of declarationsIn(inner)) {
        map.set(key, value.split(/\s+/).map(Number));
      }
    }
  }

  override get type(): number {
    return CSSRule.FONT_FEATURE_VALUES_RULE;
  }
  get fontFamily(): string {
    return this.#family;
  }
  set fontFamily(family: string) {
    this.#family = String(family);
    this[CHANGED]();
  }
  override get cssText(): string {
    const blocks = Object.entries(FEATURE_BLOCKS).flatMap(([at, name]) => {
      const map = this.#maps[name]!;
      if (!map.size) return [];
      const said = [...map].map(([key, values]) => `${key}: ${values.join(' ')};`).join(' ');
      return [`@${at} { ${said} }`];
    });
    return `@font-feature-values ${this.#family} { ${blocks.map((each) => `${each} `).join('')}}`;
  }
  /** A map by the name of its attribute. */
  map(name: string): CSSFontFeatureValuesMap {
    return this.#maps[name]!;
  }
}

for (const name of Object.values(FEATURE_BLOCKS)) {
  Object.defineProperty(CSSFontFeatureValuesRule.prototype, name, {
    configurable: true,
    enumerable: true,
    get(this: CSSFontFeatureValuesRule) {
      return this.map(name);
    },
  });
}

export class CSSPropertyRule extends CSSRule {
  readonly #name: string;
  readonly #descriptors: Map<string, string>;

  constructor(name: string, descriptors: Map<string, string>, place: Place) {
    super(place);
    this.#name = name;
    this.#descriptors = descriptors;
  }

  get name(): string {
    return this.#name;
  }
  get syntax(): string {
    return this.#descriptors.get('syntax') ?? '';
  }
  get inherits(): boolean {
    return this.#descriptors.get('inherits') === 'true';
  }
  get initialValue(): string | null {
    return this.#descriptors.get('initial-value') ?? null;
  }
  override get cssText(): string {
    const said = [...this.#descriptors].map(([key, value]) => `${key}: ${value};`).join(' ');
    return `@property ${this.#name} { ${said} }`;
  }
}

/** `@property --x { ... }`, which says what syntax its property takes, and whether it inherits. */
function propertyRuleOf(name: string, body: string, place: Place): CSSPropertyRule | undefined {
  if (!/^--[\w-]+$/.test(name)) return undefined;
  const known = new Set(['syntax', 'inherits', 'initial-value']);
  const descriptors = new Map(
    declarationsIn(body)
      .filter(([key]) => known.has(key))
      .map(([key, { value }]) => [
        key,
        key === 'syntax' ? serializeString(unquoted(value)) : value,
      ]),
  );
  const inherits = descriptors.get('inherits');
  if (!descriptors.has('syntax') || (inherits !== 'true' && inherits !== 'false')) return undefined;
  return new CSSPropertyRule(name, descriptors, place);
}

/** A string token's text, or the text itself where it is none. */
function unquoted(text: string): string {
  const [token, ...more] = tokenize(text.trim());
  return token?.type === 'string' && !more.length ? token.value : text.trim();
}

export class CSSNamespaceRule extends CSSRule {
  readonly #prefix: string;
  readonly #uri: string;

  constructor([prefix, uri]: readonly [string, string], place: Place) {
    super(place);
    this.#prefix = prefix;
    this.#uri = uri;
  }

  override get type(): number {
    return CSSRule.NAMESPACE_RULE;
  }
  get namespaceURI(): string {
    return this.#uri;
  }
  get prefix(): string {
    return this.#prefix;
  }
  override get cssText(): string {
    const prefix = this.#prefix ? `${serializeIdentifier(this.#prefix)} ` : '';
    return `@namespace ${prefix}url(${serializeString(this.#uri)});`;
  }
}

/** `@namespace x url(a)` or `@namespace "a"`: the prefix, `''` for none, and the namespace. */
export function namespaceOf(prelude: string): [string, string] | undefined {
  const tokens = tokenize(prelude).filter((token) => token.type !== 'whitespace');
  const at = tokens[0]?.type === 'ident' ? 1 : 0;
  const prefix = at ? (tokens[0] as { value: string }).value : '';
  const uri = uriAt(tokens, at);
  if (!uri || tokens.length !== uri.next) return undefined;
  return [prefix, uri.value];
}

/** A URL at a place in a list of tokens, `url(a)`, `url("a")` or `"a"`, and what comes after. */
function uriAt(tokens: readonly Token[], at: number): { value: string; next: number } | undefined {
  const token = tokens[at];
  if (token?.type === 'string' || token?.type === 'url')
    return { value: token.value, next: at + 1 };
  const inner = tokens[at + 1];
  if (token?.type !== 'function' || token.value.toLowerCase() !== 'url') return undefined;
  if (inner?.type !== 'string' || tokens[at + 2]?.type !== ')') return undefined;
  return { value: inner.value, next: at + 3 };
}

/** What makes a sheet of an `@import`: the sheet's own kind, which is not known here. */
export interface ImportedSheet {
  readonly href: string;
  readonly media: MediaList;
  readonly rule: CSSImportRule;
}
let importedSheet: ((made: ImportedSheet) => object) | undefined;

/** Say what the sheet of an `@import` is made by: see `css-style-sheet.ts`. */
export function importSheetsWith(make: (made: ImportedSheet) => object): void {
  importedSheet = make;
}

/** An `@import`'s prelude as its URL, its layer, its condition and its media. */
interface Import {
  readonly href: string;
  readonly layer: string | null;
  readonly supports: string | null;
  readonly media: string;
}

const URL_AT_START =
  /^(?:url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)"'\s]*)\s*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/i;

/** The text of a function at the start, `supports(a (b))`, to its closing bracket. */
function bracketed(text: string): number {
  let depth = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '(') depth++;
    else if (text[at] === ')' && --depth === 0) return at;
  }
  return -1;
}

function importOf(prelude: string): Import | undefined {
  const [written] = URL_AT_START.exec(prelude) ?? [];
  if (!written) return undefined;
  const [token, inner] = tokenize(written).filter((each) => each.type !== 'whitespace');
  const href =
    token?.type === 'function'
      ? (inner as { value: string }).value
      : (token as { value: string }).value;
  let rest = prelude.slice(written.length).trim();
  let layer: string | null = null;
  // A layer by its name, dotted as one is; `layer()` and `layer(a b)` are none, and media.
  const [named, name] =
    /^layer(?:\(\s*(-?[_a-zA-Z][\w-]*(?:\.-?[_a-zA-Z][\w-]*)*)\s*\)|(?![\w(-]))/i.exec(rest) ?? [];
  if (named !== undefined) {
    layer = name ?? '';
    rest = rest.slice(named.length).trim();
  }
  let supports: string | null = null;
  if (/^supports\(/i.test(rest)) {
    const end = bracketed(rest);
    if (end < 0) return undefined;
    supports = rest.slice('supports('.length, end).trim();
    rest = rest.slice(end + 1).trim();
  }
  return { href, layer, supports, media: rest };
}

export class CSSImportRule extends CSSRule {
  readonly #import: Import;
  readonly #media: MediaList;
  #sheet: object | undefined;

  constructor(read: Import, place: Place) {
    super(place);
    this.#import = read;
    this.#media = new MediaList(read.media, () => this[CHANGED]());
  }

  override get type(): number {
    return CSSRule.IMPORT_RULE;
  }
  get href(): string {
    return this.#import.href;
  }
  get media(): MediaList {
    return this.#media;
  }
  set media(text: string) {
    this.#media.mediaText = text;
  }
  get layerName(): string | null {
    return this.#import.layer;
  }
  get supportsText(): string | null {
    return this.#import.supports;
  }
  /** The sheet it imports, which is the same each time it is asked for, and holds no rules. */
  get styleSheet(): object | null {
    const base = this.parentStyleSheet?.baseURL;
    const href = resolved(this.#import.href, base);
    return (this.#sheet ??= importedSheet?.({ href, media: this.#media, rule: this })) ?? null;
  }
  override get cssText(): string {
    const { href, layer, supports } = this.#import;
    const named = layer === null ? '' : layer ? ` layer(${layer})` : ' layer';
    const condition = supports === null ? '' : ` supports(${supports})`;
    const media = this.#media.mediaText ? ` ${this.#media.mediaText}` : '';
    return `@import url(${serializeString(href)})${named}${condition}${media};`;
  }
}

/** A URL read against a base, or as it is where there is none to read it against. */
function resolved(href: string, base: string | undefined): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** A selector list as the CSSOM writes it back, or nothing where it is not one. */
export function selectorOf(text: string, sheet: SheetOfRules | null): string | undefined {
  if (/[{};]/.test(text)) return undefined;
  const namespaces = sheet?.namespaces();
  try {
    return serializeSelectorList(parseSelectorList(text, { namespaces }), namespaces);
  } catch {
    return undefined;
  }
}

/** Where a rule is read: at the top of a sheet, which a few rules must be, or inside a rule. */
export type Level = 'top' | 'nested';

type Make = (prelude: string, body: string | undefined, place: Place) => CSSRule | undefined;

const withBody =
  (make: (prelude: string, body: string, place: Place) => CSSRule | undefined): Make =>
  (prelude, body, place) =>
    body === undefined ? undefined : make(prelude, body, place);

const keyframes = withBody((name, body, place) => {
  const [token, ...more] = tokenize(name.trim());
  const named = token?.type === 'ident' || token?.type === 'string' ? token.value : undefined;
  if (named === undefined || more.length) return undefined;
  if (
    token!.type === 'ident' &&
    /^(none|initial|inherit|unset|revert|revert-layer|default)$/i.test(named)
  ) {
    return undefined;
  }
  return new CSSKeyframesRule(named, body, place);
});

/** Each at-rule a sheet holds, by its name, as what it is made of. */
const AT_RULES: Readonly<Record<string, Make>> = {
  media: withBody((condition, body, place) => new CSSMediaRule(condition, body, place)),
  supports: withBody((condition, body, place) => new CSSSupportsRule(condition, body, place)),
  container: withBody((condition, body, place) => new CSSContainerRule(condition, body, place)),
  scope: withBody((prelude, body, place) => new CSSScopeRule(prelude, body, place)),
  'starting-style': withBody((_, body, place) => new CSSStartingStyleRule(body, place)),
  'font-face': withBody((_, body, place) => new CSSFontFaceRule(body, place)),
  page: withBody((selector, body, place) => {
    const text = pageSelector(selector);
    return text === undefined ? undefined : new CSSPageRule(text, body, place);
  }),
  keyframes,
  '-webkit-keyframes': keyframes,
  'counter-style': withBody((name, body, place) =>
    /^-?[_a-zA-Z][\w-]*$/.test(name.trim()) &&
    !/^(none|decimal|disc|inherit|initial|unset)$/i.test(name.trim())
      ? new CSSCounterStyleRule(name.trim(), body, place)
      : undefined,
  ),
  'font-feature-values': withBody(
    (family, body, place) => new CSSFontFeatureValuesRule(family.trim(), body, place),
  ),
  property: withBody((name, body, place) => propertyRuleOf(name.trim(), body, place)),
  layer: (prelude, body, place) => {
    if (body !== undefined) {
      return /^([\w-]+(\.[\w-]+)*)?$/.test(prelude.trim().replace(/\s*\.\s*/g, '.'))
        ? new CSSLayerBlockRule(prelude, body, place)
        : undefined;
    }
    const names = prelude.split(',').map((each) => each.trim());
    return names.every((name) => /^[\w-]+(\.[\w-]+)*$/.test(name))
      ? new CSSLayerStatementRule(names, place)
      : undefined;
  },
};

/** The at-rules that are only at the top of a sheet, each by what reads it there. */
const TOP_ONLY: Readonly<Record<string, Make>> = {
  import: (prelude, body, place) => {
    const read = body === undefined ? importOf(prelude) : undefined;
    return read ? new CSSImportRule(read, place) : undefined;
  },
  namespace: (prelude, body, place) => {
    const read = body === undefined ? namespaceOf(prelude) : undefined;
    return read ? new CSSNamespaceRule(read, place) : undefined;
  },
};

/** A rule's text as the rule it is, or nothing where it is none. */
export function ruleOf(text: string, place: Place, level: Level = 'top'): CSSRule | undefined {
  const { head, body } = split(text);
  const [, keyword] = /^@([\w-]+)/.exec(head) ?? [];
  if (keyword) {
    const name = keyword.toLowerCase();
    const make = AT_RULES[name] ?? (level === 'top' ? TOP_ONLY[name] : undefined);
    return make?.(head.slice(keyword.length + 1).trim(), body, place);
  }
  const selector = body === undefined ? undefined : selectorOf(head, sheetOf(place));
  if (selector === undefined) return undefined;
  return new CSSStyleRule({ written: head, text: selector }, body!, place);
}

/** The sheet a rule in a place is in. */
const sheetOf = (place: Place): SheetOfRules | null =>
  place.rule ? place.rule.parentStyleSheet : place.sheet;

/** Whether a rule is one only the top of a sheet holds. */
export const isTopOnly = (rule: CSSRule): boolean =>
  rule instanceof CSSImportRule || rule instanceof CSSNamespaceRule;

/** Where a rule goes in a list: at or before its end, as `insertRule` and `deleteRule` ask. */
export function checked(index: unknown, length: number, end: number): number {
  const at = Number(index ?? 0) >>> 0;
  if (at > length - end) throw domError(`There is no rule at ${at}.`, 'IndexSizeError');
  return at;
}

/**
 * One rule of text, in a place, or an error a browser names for text that is not one: an
 * `@import` or an `@namespace` inside a rule is one in the wrong place.
 */
export function oneRule(text: string, place: Place, level: Level): CSSRule {
  const [only, ...more] = rulesIn(String(text));
  const rule = only && !more.length ? ruleOf(only, place, 'top') : undefined;
  if (!rule) throw domError(`'${text}' is not one rule.`, 'SyntaxError');
  if (level === 'nested' && isTopOnly(rule)) {
    throw domError(`'${text}' cannot be inside a rule.`, 'HierarchyRequestError');
  }
  return rule;
}
