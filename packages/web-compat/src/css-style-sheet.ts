import { domError } from './dom-error.ts';
import { CHANGED, CSSRule, CSSRuleList, NOWHERE, PLACE, type SheetOfRules } from './css-rule.ts';
import {
  CSSImportRule,
  CSSLayerStatementRule,
  CSSNamespaceRule,
  checked,
  importSheetsWith,
  oneRule,
  ruleOf,
  rulesIn,
} from './css-rules.ts';
import * as rules from './css-rules.ts';
import {
  CSSFontFaceDescriptors,
  CSSPageDescriptors,
  CSSStyleDeclaration,
  CSSStyleProperties,
} from './css-style-declaration.ts';
import { MediaList } from './media-list.ts';

export { CSSRule, CSSRuleList } from './css-rule.ts';
export * from './css-rules.ts';
export {
  CSSFontFaceDescriptors,
  CSSPageDescriptors,
  CSSStyleDeclaration,
  CSSStyleProperties,
  dashed,
  declarationsIn,
  type Entry,
} from './css-style-declaration.ts';

/**
 * The rules of a stylesheet as a script reads and writes them, `style.sheet.cssRules`: a
 * CSS-in-JS library writes every class it makes with `insertRule`, and reads back what it wrote.
 * A rule is held as the text it is, and is what the engine applies only as `runtime-style.ts`
 * reads that text: a rule it has no reading of is still listed here.
 */

/**
 * Where a rule stands in a sheet's order: `@import` before `@namespace` before the rest, with an
 * `@layer` statement anywhere before them.
 */
function rank(rule: CSSRule): number | undefined {
  if (rule instanceof CSSLayerStatementRule) return undefined;
  if (rule instanceof CSSImportRule) return 0;
  return rule instanceof CSSNamespaceRule ? 1 : 2;
}

/** Whether a rule may go at a place in a list, by the order the rules of a sheet keep. */
function fits(rules: readonly CSSRule[], at: number, rule: CSSRule): boolean {
  const own = rank(rule);
  if (own === undefined) return true;
  const before = rules
    .slice(0, at)
    .map(rank)
    .filter((each) => each !== undefined);
  const after = rules
    .slice(at)
    .map(rank)
    .filter((each) => each !== undefined);
  return before.every((each) => each <= own) && after.every((each) => each >= own);
}

/** What a sheet made by a script or of an `@import` is told of where it is. */
interface Made {
  readonly node?: object;
  readonly text?: () => string;
  readonly href?: string;
  readonly media?: MediaList;
  readonly rule?: CSSImportRule;
  readonly baseURL?: string;
}

/** What `new CSSStyleSheet(options)` takes. */
interface Options {
  readonly baseURL?: string;
  readonly media?: string | MediaList;
  readonly disabled?: boolean;
}

/** What makes a sheet that is not a script's own: a `<style>`'s, or an `@import`'s. */
const MADE = Symbol('made');
/** What says a sheet is no longer its element's. */
export const DETACH = Symbol('detach');

/** What every stylesheet is: where it came from, and whether it applies. */
export class StyleSheet {
  get type(): string {
    return 'text/css';
  }
}

/**
 * `style.sheet`, or one `new CSSStyleSheet()` makes: its rules, which a script inserts and
 * deletes, and whatever applies them told each time they change.
 *
 * Its `rules` is the engine's: a `<style>` holds its sheet where the engine has the stylesheet
 * of the component an element was made by, and the engine reads none from it. A script reads
 * `cssRules`, which `rules` is another name for in a browser.
 */
export class CSSStyleSheet extends StyleSheet implements SheetOfRules {
  /** What applies the sheet, told of each change. */
  readonly watchers = new Set<() => void>();
  readonly #list = new CSSRuleList();
  /** The text the rules are read from when they are first asked for, if they have not been. */
  #source: (() => string) | undefined;
  #owner: object | null = null;
  #rule: CSSImportRule | null = null;
  #href: string | null = null;
  #medium: MediaList | undefined;
  #off = false;
  /** Whether a script made it, which an `@import` is not read in. */
  readonly #constructed: boolean;
  readonly #base: string | undefined;

  constructor(options?: Options) {
    super();
    const made = (options as { [MADE]?: Made } | undefined)?.[MADE];
    this.#constructed = !made;
    if (!made) {
      const given = options ?? {};
      this.#base = given.baseURL === undefined ? undefined : String(given.baseURL);
      const media = given.media;
      this.#medium = new MediaList(
        media instanceof MediaList ? media.mediaText : String(media ?? ''),
      );
      this.#off = !!given.disabled;
      return;
    }
    this.#owner = made.node ?? null;
    this.#source = made.text;
    this.#rule = made.rule ?? null;
    this.#href = made.href ?? null;
    this.#medium = made.media;
    this.#base = made.baseURL ?? made.href;
  }

  get ownerNode(): object | null {
    return this.#owner;
  }
  get ownerRule(): CSSImportRule | null {
    return this.#rule;
  }
  get parentStyleSheet(): SheetOfRules | null {
    return this.#rule?.parentStyleSheet ?? null;
  }
  get href(): string | null {
    return this.#href;
  }
  get baseURL(): string | undefined {
    return this.#base ?? (this.#owner as { baseURI?: string } | null)?.baseURI;
  }

  /** The `title` of the `<style>` it is the sheet of, or none. */
  get title(): string | null {
    return this.attribute('title');
  }

  /** The queries the `<style>` it is the sheet of says it is for, as they were when first asked. */
  get media(): MediaList {
    return (this.#medium ??= new MediaList(this.attribute('media') ?? ''));
  }
  set media(text: string) {
    this.media.mediaText = text;
  }

  private attribute(name: string): string | null {
    const owner = this.#owner as { getAttribute?(name: string): string | null } | null;
    return owner?.getAttribute?.(name) || null;
  }

  get cssRules(): CSSRuleList {
    const source = this.#source;
    this.#source = undefined;
    if (source) this.fill(source());
    return this.#list;
  }

  /** `cssRules` by its older name, which the CSSOM keeps. */
  get rules(): CSSRuleList {
    return this.cssRules;
  }

  get disabled(): boolean {
    return this.#off;
  }
  set disabled(value: boolean) {
    if (this.#off === !!value) return;
    this.#off = !!value;
    this[CHANGED]();
  }

  insertRule(text: string, index?: number): number {
    if (!arguments.length)
      throw new TypeError("Failed to execute 'insertRule': 1 argument required.");
    const rules = this.cssRules;
    const at = checked(index, rules.length, 0);
    const rule = oneRule(text, { sheet: this, rule: null }, 'top');
    if (this.#constructed && rule instanceof CSSImportRule) {
      throw domError('A sheet a script made imports nothing.', 'SyntaxError');
    }
    if (!fits(rules, at, rule)) {
      throw domError(`'${text}' cannot be at ${at}.`, 'HierarchyRequestError');
    }
    if (rule instanceof CSSNamespaceRule && rules.some((each) => rank(each) === 2)) {
      throw domError('A namespace comes before every other rule.', 'InvalidStateError');
    }
    rules.splice(at, 0, rule);
    this[CHANGED]();
    return at;
  }
  deleteRule(index: number): void {
    if (!arguments.length)
      throw new TypeError("Failed to execute 'deleteRule': 1 argument required.");
    const rules = this.cssRules;
    const at = checked(index, rules.length, 1);
    if (rules[at] instanceof CSSNamespaceRule && rules.some((each) => rank(each) === 2)) {
      throw domError('A namespace is not taken from before other rules.', 'InvalidStateError');
    }
    const [gone] = rules.splice(at, 1);
    gone![PLACE] = NOWHERE;
    this[CHANGED]();
  }
  /** The older names, which answer -1 as a browser's do. */
  addRule(selector = 'undefined', block = 'undefined', index?: number): number {
    this.insertRule(`${selector} { ${block} }`, index ?? this.cssRules.length);
    return -1;
  }
  removeRule(index = 0): void {
    this.deleteRule(index);
  }

  /** Every rule in place of what there was: a sheet a script made, and not a `<style>`'s. */
  replaceSync(text: string): void {
    if (!this.#constructed) {
      throw domError('Only a sheet a script made is replaced.', 'NotAllowedError');
    }
    this.fill(String(text));
    this[CHANGED]();
  }
  replace(text: string): Promise<CSSStyleSheet> {
    try {
      this.replaceSync(text);
      return Promise.resolve(this);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** The namespaces the sheet's `@namespace` rules declare, by prefix. */
  namespaces(): Map<string, string> | undefined {
    let found: Map<string, string> | undefined;
    for (const rule of this.#list) {
      if (rule instanceof CSSNamespaceRule)
        (found ??= new Map()).set(rule.prefix, rule.namespaceURI);
    }
    return found;
  }

  /** The sheet is no longer its element's: the element left the page, or has new text. */
  [DETACH](): void {
    this.#owner = null;
  }

  private fill(text: string): void {
    const place = { sheet: this, rule: null };
    for (const rule of this.#list.splice(0)) rule[PLACE] = NOWHERE;
    // One at a time, as a rule is read by the `@namespace` rules before it.
    for (const each of rulesIn(text)) {
      const rule = ruleOf(each, place, 'top');
      if (!rule || !fits(this.#list, this.#list.length, rule)) continue;
      if (this.#constructed && rule instanceof CSSImportRule) continue;
      this.#list.push(rule);
    }
  }

  [CHANGED](): void {
    for (const watcher of this.watchers) watcher();
  }
}

/** The sheet of a `<style>`, its rules read from its text when they are first asked for. */
export const sheetOfElement = (node: object, text: () => string): CSSStyleSheet =>
  new CSSStyleSheet({ [MADE]: { node, text } } as Options);

importSheetsWith(
  ({ href, media, rule }) => new CSSStyleSheet({ [MADE]: { href, media, rule } } as Options),
);

/** Each class says what it is, as `Object.prototype.toString` writes one: `[object CSSRule]`. */
function nameClasses(classes: Record<string, unknown>): void {
  for (const [name, each] of Object.entries(classes)) {
    if (typeof each !== 'function' || !/^[A-Z]/.test(name)) continue;
    const prototype = (each as { prototype: object }).prototype;
    if (Object.hasOwn(prototype, Symbol.toStringTag)) continue;
    Object.defineProperty(prototype, Symbol.toStringTag, { value: name, configurable: true });
  }
}

nameClasses({
  ...rules,
  CSSRule,
  CSSRuleList,
  CSSStyleDeclaration,
  CSSStyleProperties,
  CSSPageDescriptors,
  CSSFontFaceDescriptors,
  StyleSheet,
  CSSStyleSheet,
  MediaList,
});
