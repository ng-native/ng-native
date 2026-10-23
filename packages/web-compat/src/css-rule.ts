/**
 * What every rule of a stylesheet is (https://drafts.csswg.org/cssom/#the-cssrule-interface):
 * its kind as a number, its text, and what it is in. The kinds of rule are in `css-rules.ts`.
 *
 * A rule's text is what the engine reads it by (see `runtime-style.ts`): `readBy` keeps how it
 * was read until the rule changes, and a change is told up to the sheet it is in.
 */

/** What a rule keeps of how the engine read it, until it changes. */
export const READ = Symbol('read');
/** What a rule or a sheet calls once a rule in it changes. */
export const CHANGED = Symbol('changed');
/** A rule's text as written, which the engine reads, where `cssText` is written back. */
export const WRITTEN = Symbol('written');
/** Where a rule is: the sheet, and the rule it is inside, if it is inside one. */
export const PLACE = Symbol('place');

/** What a sheet is to the rules in it. */
export interface SheetOfRules {
  [CHANGED](): void;
  /** The namespaces its `@namespace` rules declare, by prefix, to read a selector by. */
  namespaces(): Map<string, string> | undefined;
  /** What a relative URL in it is read against. */
  readonly baseURL: string | undefined;
}

export interface Place {
  readonly sheet: SheetOfRules | null;
  readonly rule: CSSRule | null;
}

/** A place in no sheet: a rule taken out of its list. */
export const NOWHERE: Place = { sheet: null, rule: null };

/** A list of rules that is the list itself as it changes: `cssRules`, with `item`. */
export class CSSRuleList extends Array<CSSRule> {
  /** What `map` and `slice` make of one is a plain list. */
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }
  item(index: number): CSSRule | null {
    return this[Number(index) >>> 0] ?? null;
  }
}

/** Each kind of rule's number, as `CSSRule` and each rule has them. */
const KINDS = {
  STYLE_RULE: 1,
  CHARSET_RULE: 2,
  IMPORT_RULE: 3,
  MEDIA_RULE: 4,
  FONT_FACE_RULE: 5,
  PAGE_RULE: 6,
  KEYFRAMES_RULE: 7,
  KEYFRAME_RULE: 8,
  MARGIN_RULE: 9,
  NAMESPACE_RULE: 10,
  COUNTER_STYLE_RULE: 11,
  SUPPORTS_RULE: 12,
  FONT_FEATURE_VALUES_RULE: 14,
} as const;

export class CSSRule {
  static readonly STYLE_RULE = KINDS.STYLE_RULE;
  static readonly CHARSET_RULE = KINDS.CHARSET_RULE;
  static readonly IMPORT_RULE = KINDS.IMPORT_RULE;
  static readonly MEDIA_RULE = KINDS.MEDIA_RULE;
  static readonly FONT_FACE_RULE = KINDS.FONT_FACE_RULE;
  static readonly PAGE_RULE = KINDS.PAGE_RULE;
  static readonly KEYFRAMES_RULE = KINDS.KEYFRAMES_RULE;
  static readonly KEYFRAME_RULE = KINDS.KEYFRAME_RULE;
  static readonly MARGIN_RULE = KINDS.MARGIN_RULE;
  static readonly NAMESPACE_RULE = KINDS.NAMESPACE_RULE;
  static readonly COUNTER_STYLE_RULE = KINDS.COUNTER_STYLE_RULE;
  static readonly SUPPORTS_RULE = KINDS.SUPPORTS_RULE;
  static readonly FONT_FEATURE_VALUES_RULE = KINDS.FONT_FEATURE_VALUES_RULE;

  [PLACE]: Place;
  /** How the engine read the rule's text, kept until the rule changes: see `readBy`. */
  [READ]: unknown = undefined;

  constructor(place: Place) {
    this[PLACE] = place;
  }

  get type(): number {
    return 0;
  }
  get cssText(): string {
    return '';
  }
  /** Setting it does nothing, as the CSSOM says. */
  set cssText(_text: string) {}
  get parentRule(): CSSRule | null {
    return this[PLACE].rule;
  }
  get parentStyleSheet(): SheetOfRules | null {
    const { rule, sheet } = this[PLACE];
    return rule ? rule.parentStyleSheet : sheet;
  }

  /** The rule's text as it was written, which the engine reads: `cssText` is written back. */
  get [WRITTEN](): string {
    return this.cssText;
  }

  /** The rule as `read` makes of its text, made again only once the rule has changed. */
  readBy<T>(read: (text: string) => T): T {
    return (this[READ] ??= read(this[WRITTEN])) as T;
  }

  /** Forget how the rule was read, and tell what it is in, up to the sheet. */
  [CHANGED](): void {
    this[READ] = undefined;
    const { rule, sheet } = this[PLACE];
    if (rule) rule[CHANGED]();
    else sheet?.[CHANGED]();
  }
}

for (const [name, value] of Object.entries(KINDS)) {
  const constant = { value, enumerable: true, writable: false, configurable: false };
  Object.defineProperty(CSSRule, name, constant);
  Object.defineProperty(CSSRule.prototype, name, constant);
}
