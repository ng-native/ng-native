/**
 * Runtime half of the CSS system: selector matching and the cascade.
 *
 * All the expensive work happened at build time (parsing, longhand expansion, value conversion,
 * specificity maths, sorting), so this only walks a pre-sorted rule list and merges. It is
 * framework-agnostic and knows nothing about Angular.
 */
import {
  type HueMethod,
  type MixSide,
  type MixSpace,
  type Rgba,
  mixChannels,
  mixColours,
} from './color-mix.ts';
import { type BackgroundLayers, backgroundLayers } from './background-layers.ts';
import { ELEMENT_STYLES } from './element-styles.ts';
import { type Channel, relativeColour } from './relative-colour.ts';
import type { Keyframe } from './transition.ts';

/** One `[name]` or `[name op "value"]` test. */
export interface AttributeTest {
  readonly name: string;
  /** Absent means a presence test. */
  readonly operator?: 'equal' | 'prefix' | 'suffix' | 'substring' | 'includes' | 'dash-match';
  readonly value?: string;
  /** The `i` flag: the value is compared without case, and is written here in lower case. */
  readonly insensitive?: true;
}

export interface Compound {
  readonly type?: string;
  readonly id?: string;
  /** `:root`: the node at the top of the tree. */
  readonly root?: true;
  readonly classes: readonly string[];
  readonly attributes?: readonly AttributeTest[];
  /** `:is()` / `:where()` arguments: the compound matches if any of these do. */
  readonly is?: readonly (readonly Compound[])[];
  /** `:not()` arguments: the compound matches only if none of these do. */
  readonly not?: readonly Compound[];
  /** `:host`: the node must be the host of the component whose sheet is being evaluated. */
  readonly host?: true;
  /** `:host-context()`, once for each written: the host, or one of its ancestors, must match it. */
  readonly hostContext?: readonly Compound[];
  /**
   * `:is(<compound> *)`: every one of these must match some ancestor, the node itself excluded.
   * What Tailwind's `group-*` variants compile to.
   */
  readonly ancestors?: readonly Compound[];
  /**
   * `:is(<compound> > *)`: every one of these must match the node's parent. What Tailwind's `*:`
   * variant compiles to.
   */
  readonly parents?: readonly Compound[];
  /** Interaction state the engine tracks: `:focus` and `:active`. */
  readonly pseudo?: readonly ('focus' | 'active')[];
  /**
   * `:first-child` and its family, reduced to the counting tests CSS defines them as. More than
   * one because `:only-child` is two: first from the start and first from the end.
   */
  readonly nth?: readonly NthTest[];
  /** `:empty`: no children at all, text included. */
  readonly empty?: true;
  /** `:has()`: every one of these must find a match beneath the node. */
  readonly has?: readonly HasTest[];
}

/** One `:has()`: some element beneath the node, or some child of it, matches one of `any`. */
export interface HasTest {
  /** `:has(> x)`: a child, not any descendant. */
  readonly child?: true;
  readonly any: readonly Compound[];
}

/** `an + b`, counted from the start unless `fromEnd`. */
export interface NthTest {
  readonly a: number;
  readonly b: number;
  readonly fromEnd?: true;
  /** Counted among the siblings with the node's own element name: `:nth-of-type()`. */
  readonly ofType?: true;
}

export type Combinator = 'descendant' | 'child' | 'next-sibling' | 'later-sibling';

export interface StyleRule {
  readonly compounds: readonly Compound[];
  /** Between compounds; length is `compounds.length - 1`. */
  readonly combinators: readonly Combinator[];
  readonly specificity: number;
  /**
   * The cascade layer the rule is in, as its place in its sheet's `layers`, or nothing for a rule
   * in no layer, which beats every layered one whatever their specificity.
   */
  readonly layer?: number;
  readonly order: number;
  readonly declarations: Readonly<Record<string, unknown>>;
  readonly important?: Readonly<Record<string, unknown>>;
  /** Custom properties this rule defines, pre-converted into every form a use site might want. */
  readonly tokens?: Readonly<Record<string, TokenValue>>;
  /** The names among `tokens` declared `!important`, which beat every plain one. */
  readonly importantTokens?: readonly string[];
  /** Declarations whose value is a `var()`, resolved once the token map is known. */
  readonly deferred?: readonly DeferredDeclaration[];
  /**
   * The corners and edges the rule's plain declarations wrote, in the order it wrote them, where
   * it wrote one in both its logical form and its physical one. The cascade settles the two as
   * one property, and a value settled on device is in a list of its own, with no order between
   * it and the rest.
   */
  readonly sides?: readonly string[];
  /** The same for the rule's important declarations. */
  readonly importantSides?: readonly string[];
  /** The media query guarding this rule, if any. */
  readonly condition?: MediaCondition;
  /** Memo of the last condition evaluation, and the conditions version it was made against. */
  activeAt?: number;
  active?: boolean;
}

export type MediaCondition =
  | { readonly all: readonly MediaCondition[] }
  | { readonly any: readonly MediaCondition[] }
  | {
      readonly feature: 'width' | 'height';
      readonly op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
      readonly value: number;
    }
  | {
      /** `direction` is not a media feature: it is what `:dir()` asks, of the app as a whole. */
      readonly feature:
        'orientation' | 'prefers-color-scheme' | 'prefers-reduced-motion' | 'direction';
      readonly value: string;
    };

/** What media queries are evaluated against. Pushed in by the host: the engine imports no RN. */
export interface Conditions {
  readonly width: number;
  readonly height: number;
  readonly colorScheme: 'light' | 'dark';
  /**
   * The user asked for less animation. Optional because it is a preference rather than a
   * measurement: an app that never asks the platform gets `no-preference`, which is what a
   * platform that cannot answer means anyway.
   */
  readonly reducedMotion?: boolean;
  /**
   * The system text size, as a multiplier: `PixelRatio.getFontScale()`. What native text scales
   * by; the engine scales the line box it keeps for a single-line iOS text input by it too.
   * Optional, and 1 when absent. A change reaches that line box when text is measured again
   * (`Engine.remeasureText`), which `watchConditions` does after it.
   */
  readonly fontScale?: number;
  /**
   * The direction the app is laid out in, which is the device's unless the app forced one:
   * `I18nManager.isRTL`. Optional, and left to right when absent. It decides which physical
   * corner or edge a logical one is, where an element has both and no `direction` of its own.
   */
  readonly direction?: 'ltr' | 'rtl';
}

/** A run of CSS whitespace: spaces, tabs, newlines, carriage returns and form feeds, and no other. */
export const CSS_SPACE = /[ \t\n\r\f]+/;

/** A custom property's value, in each form it can legally take. Absent forms are unusable. */
export interface TokenValue {
  readonly length?: number | string;
  /** An angle, in degrees whatever unit it was written in. */
  readonly angle?: number;
  /** A time, in milliseconds whatever unit it was written in. */
  readonly time?: number;
  readonly color?: string;
  readonly keyword?: string;
  readonly number?: number;
  /** A font weight, as the string `fontWeight` takes. */
  readonly weight?: string;
  /** The first family of a font stack. A single word is read from `keyword` instead. */
  readonly family?: string;
  /**
   * A bare number as a line-height: a multiple of the font size, settled where it is used. A
   * length is read from `length` instead.
   */
  readonly lineHeight?: { readonly __defer: DeferredDeclaration['compute'] };
  /**
   * Two to four lengths, which a shorthand of sides or corners takes a value each from:
   * `padding: var(--list-padding)` of `--list-padding: 0.25rem 0.5rem`.
   */
  readonly lengths?: readonly (number | string)[];
  /**
   * The same where a part is a `var()`, each such part as the alias a token that is one is:
   * `0 var(--modal-padding) var(--modal-padding)`. Worked out into `lengths` where it is defined.
   */
  readonly deferredLengths?: readonly (number | string | TokenValue)[];
  /** A whole shadow list, in the processed shape `boxShadow` takes. */
  readonly shadow?: readonly unknown[];
  /** One filter function, as the one-entry list `filter` takes: a slot of Tailwind's filters. */
  readonly filter?: readonly unknown[];
  /** One transform function, as the one-entry list `transform` takes: a 3D rotation or skew. */
  readonly transform?: readonly unknown[];
  /** One font variant, as the one-entry list `fontVariant` takes: a numeric variant's slot. */
  readonly fontVariant?: readonly string[];
  /** Bare colour channels as `rgb()` reads them, 0 to 255: `13, 110, 253` or `100% 0% 0%`. */
  readonly channels?: readonly number[];
  /** The same as `hsl()` reads them: degrees, then saturation and lightness as fractions. */
  readonly hslChannels?: readonly number[];
  /** A transition's curve, as the cubic-bezier control points a timing keyword stands for. */
  readonly easing?: readonly number[];
  /** A whole animation, as the spec the engine plays: `--animate-spin`. */
  readonly animation?: Readonly<Record<string, unknown>>;
  /**
   * Defined as a colour made of other tokens: `rgba(var(--channels), <alpha>)`, or a `color-mix()`
   * of one. Settled on the node that defines it, as an `hsl` one is.
   */
  readonly deferredColour?: ColourExpression;
  /**
   * Defined as arithmetic of other tokens, `calc(var(--spacing) * 4)`, read as a length and as a
   * number. Settled on the node that defines it, as an `hsl` one is.
   */
  readonly deferredCalc?: readonly CalcMarker[];
  /**
   * Defined as another token, `var(--name)`. Resolved on the node that defines it, against the
   * tokens in scope there, and passed down resolved - which is what a browser does.
   */
  readonly alias?: string;
  /** What an alias becomes when the token it names is not defined. */
  readonly fallback?: TokenValue;
  /**
   * Defined as `hsl(var(--h), var(--s), var(--l))`, or `hsla()` with an alpha: how Bulma writes
   * every colour. Resolved into `color` on the node that defines it, alongside its aliases, so a
   * use site never has to know a token was ever built this way.
   */
  readonly hsl?: {
    readonly h: HslChannel;
    readonly s: HslChannel;
    readonly l: HslChannel;
    readonly alpha?: HslChannel;
    /** Written with commas, whose saturation and lightness are percentages alone. */
    readonly legacy?: true;
  };
}

/** One channel of an `hsl()` token: settled at build time, or a token to read at match time. */
export type HslChannel = number | { readonly reference: string; readonly fallback?: number };

/** The forms a token can be read in: one per kind of value a use site can need. */
export type TokenKind =
  | 'length'
  | 'color'
  | 'keyword'
  | 'number'
  | 'weight'
  | 'family'
  | 'lineHeight'
  | 'shadow'
  | 'filter'
  | 'transform'
  | 'fontVariant'
  | 'channels'
  | 'hslChannels'
  | 'easing'
  | 'time'
  | 'animation'
  | 'display';

/**
 * Where a form a token does not have can be read from instead. A length is already a
 * line-height and a single word is already a family, so neither is stored twice in every token
 * that happens to be one. The compiler reads fallbacks with the same table.
 */
const STAND_IN: Partial<Record<TokenKind, keyof TokenValue>> = {
  lineHeight: 'length',
  family: 'keyword',
};

function formOf(token: TokenValue | undefined, kind: TokenKind): unknown {
  if (!token) return undefined;
  // A display is a word, read as one native has where it is used: see `displayOf`. Two words,
  // `inline flex`, are a family when the stylesheet wrote them, as a font stack's first name is.
  if (kind === 'display') return token.keyword ?? token.family;
  const stand = STAND_IN[kind];
  return token[kind] ?? (stand ? token[stand] : undefined);
}

export interface DeferredDeclaration {
  /**
   * The React Native style properties this lands in. Usually one, but a four-sided shorthand is
   * unambiguous given a single-valued token, so `padding: var(--gap)` writes all four.
   */
  readonly props: readonly string[];
  /**
   * `background: var()`: the token may hold gradients over a colour, so `props` names the image
   * beside the colour and each is written from its own part of the token. See `layersOf`.
   */
  readonly layers?: true;
  /**
   * `inherit`, written for these props: each is the parent's value for it, or nothing where the
   * parent has none.
   */
  readonly inherit?: true;
  /** The element a bound declaration is on, by name, for a message about it to say. */
  readonly on?: string;
  /** A `var()` reference. Exactly one of this and `compute` is present. */
  readonly kind?: TokenKind;
  readonly reference?: string;
  /**
   * The tokens a fallback that is itself a `var()` names, tried in turn when `reference` is not
   * defined: `var(--a, var(--b, green))` is `--a`, then `--b`, then `green`.
   */
  readonly alternatives?: readonly string[];
  readonly fallback?: unknown;
  /**
   * A fallback made of other tokens, `var(--missing, calc(var(--gap) * 2))`, worked out from the
   * tokens in scope where it is used, as a browser substitutes it there.
   */
  readonly fallbackToken?: TokenValue;
  /**
   * What to write when the reference resolves, whatever it resolves to: `flex: var(--grow)` sets a
   * shrink of 1 and a basis of 0%, but only when there is a grow for them to go with.
   */
  readonly whenSet?: unknown;
  /**
   * What to write when the reference resolves to nothing: the property's initial value, which is
   * what a browser gives a property whose `var()` cannot be substituted. Only where it differs
   * from leaving the property out: `flex-shrink` starts at 1 in CSS and at 0 in Yoga.
   */
  readonly unset?: unknown;
  /**
   * For a colour built from `channels`, the token its alpha comes from:
   * `rgba(var(--bs-primary-rgb), var(--bs-bg-opacity))`. A written alpha is an `adjust` instead.
   */
  readonly alpha?: { readonly reference: string; readonly fallback?: number };
  /** For a colour built from `channels`, read through `hsl()` rather than `rgb()`. */
  readonly space?: ChannelSpace;
  /**
   * A gradient whose stops are custom properties, filled in once a node's tokens are known. What
   * a utility framework's `from-*` and `to-*` classes compile to, since the class that paints the
   * gradient is not the class that supplies its colours.
   */
  readonly gradient?: GradientTemplate | readonly GradientTemplate[];
  /**
   * Arithmetic around the reference, settled at build time. `value * scale + offset`, then no
   * smaller than `floor`. What `calc(var(--x) + 12px)` and `max(var(--x), 16px)` become.
   */
  readonly adjust?: {
    readonly scale?: number;
    readonly offset?: number;
    readonly floor?: number;
    /**
     * The reference is multiplied by a length, so it is a number: `calc(var(--n) * 1px)`. Without
     * this it is a length, and a number token is no such thing, as CSS types a calc().
     */
    readonly number?: true;
    /**
     * A fraction to multiply the resolved colour's alpha by. What
     * `color-mix(in oklab, var(--x) 90%, transparent)` becomes, which is Tailwind's `/90`.
     */
    readonly alpha?: number;
  };
  /** Declared `!important`: ranked with the important declarations, not the plain ones. */
  readonly important?: true;
  /**
   * A length relative to the viewport or to the font size in scope, plus an absolute `offset`
   * when it came from a sum: `calc(1.375rem + 1.5vw)` is 1.5vw with 22 added.
   */
  readonly compute?: {
    readonly unit: 'em' | 'vw' | 'vh' | 'vmin' | 'vmax';
    readonly factor: number;
    readonly offset?: number;
    /**
     * A unitless line-height: the node renders `factor` em, and what it hands down is the number,
     * which each text under it multiplies its own font size by. See `LineHeightMultiple`.
     */
    readonly multiple?: true;
  };
  /**
   * A structured value - a transform list, a shadow, a filter - with lengths like `compute`'s
   * somewhere inside it, each marked `{ __defer: compute }`. Filled in where it is used.
   */
  readonly within?: unknown;
  /** A `border` or a side's line with tokens in it, each given its role where it is used. */
  readonly line?: LineTemplate;
}

/**
 * `border: var(--w) var(--s) var(--c)`: which token is the width, the style or the colour cannot be
 * told at build time, so each is given the role its form says on device. `roles` are those the
 * written parts left open; `props` of the declaration are every longhand, which a line its tokens
 * make nothing of unsets.
 */
export interface LineTemplate {
  readonly references: readonly {
    readonly reference: string;
    readonly alternatives?: readonly string[];
    readonly fallback?: TokenValue;
    /** `var(--x,)`: nothing at all when the token is unset. */
    readonly empty?: true;
    /** `calc(var(--w) * 2)`: the arithmetic that makes the token the width, and only that. */
    readonly adjust?: DeferredDeclaration['adjust'];
  }[];
  readonly roles: readonly ('width' | 'style' | 'color')[];
  readonly widths: readonly string[];
  readonly colors: readonly string[];
  /** `color-mix(in srgb, var(--tint) 35%, transparent)`: the colour, written as a function. */
  readonly colour?: unknown;
  readonly style?: string;
  /** Each side's own style, which the line's style is written to as well: see `settleBorders`. */
  readonly marks?: readonly string[];
}

/**
 * A colour a deferred value is made of: settled at build time, a token, or a `color-mix()` of two
 * such, worked out once the tokens are known. What a gradient stop, a shadow's colour or a colour
 * property with a `var()` in a mix becomes.
 */
export type ColourExpression =
  | { readonly color: string }
  | {
      readonly reference: string;
      readonly alternatives?: readonly string[];
      readonly fallback?: string;
      /** A fallback made of other tokens, worked out from the tokens where it is used. */
      readonly fallbackToken?: TokenValue;
      /**
       * A shadow's `var(--x,)` with no colour beside it, which holds the colour or the word
       * `inset`: currentcolor when it is `inset` or unset.
       */
      readonly orInset?: true;
    }
  | {
      /** A token of bare channels, as `rgba(var(--channels), <alpha>)` reads it. */
      readonly channels: {
        readonly reference: string;
        readonly fallback?: readonly number[];
        readonly space?: ChannelSpace;
      };
      readonly alpha?: number | { readonly reference: string; readonly fallback?: number };
    }
  | { readonly hsl: NonNullable<TokenValue['hsl']> }
  | {
      /** `oklch(from <colour> <channel> <channel> <channel> [/ <alpha>])`. */
      readonly relative: {
        readonly space: MixSpace;
        readonly from: ColourExpression;
        readonly channels: readonly [Channel, Channel, Channel];
        readonly alpha?: Channel;
      };
    }
  | {
      readonly mix: {
        readonly space: MixSpace;
        readonly hue?: HueMethod;
        readonly a: ColourExpression;
        readonly aPercentage?: MixShare;
        readonly b: ColourExpression;
        readonly bPercentage?: MixShare;
      };
    };

/**
 * The share of a colour in a mix: a percentage, or a token multiplied into one, as
 * `calc(var(--opacity) * 100%)` is the token times a hundred, with the number the token falls
 * back to where it wrote one.
 */
export type MixShare =
  number | { readonly reference: string; readonly scale: number; readonly fallback?: number };

/** One component's compiled styles, pre-sorted by specificity then source order. */
/**
 * A gradient with holes in it: everything but the stop colours is settled at build time.
 *
 * The shape is React Native's own processed one, so filling it in is a copy with the references
 * resolved rather than a translation.
 */
export interface GradientTemplate {
  readonly type: 'linear-gradient' | 'radial-gradient';
  readonly colorStops: readonly {
    /** The custom property holding this stop's colour. A stop with no colour is not painted. */
    readonly reference?: string;
    /** A colour made from tokens and literals instead, such as a `color-mix()` of one. */
    readonly colour?: ColourExpression;
    readonly positionReference?: string;
    readonly position?: string | number;
  }[];
  /**
   * A radial gradient's centre, by the edges native measures from: each offset written, or a
   * token with what is written beside its name to use when it is not set.
   */
  readonly position?: Readonly<
    Record<
      string,
      string | number | { readonly reference: string; readonly fallback?: string | number }
    >
  >;
}

export interface StyleSheet {
  readonly rules: readonly StyleRule[];
  /**
   * The sheet's cascade layers, each by its name from the outermost layer in, in the order they
   * were first named. A name that starts with a null is a block with no name, which is a layer
   * no other block can name.
   */
  readonly layers?: readonly (readonly string[])[];
  /**
   * `@keyframes` by name. Global within a sheet, as they are within a document; the engine keeps
   * one registry across every sheet it sees, so a name defined in a global stylesheet is usable
   * from a component's.
   */
  readonly keyframes?: Readonly<Record<string, readonly Keyframe[]>>;
  /**
   * Whether any rule here asks about a node's position among its siblings.
   *
   * Said on the sheet because what these cost is not matching but invalidation: adding a row
   * changes what its neighbours match while nothing about those neighbours moved, so the engine
   * has to re-resolve a whole child list when it changes. It only does that where a sheet asks.
   */
  readonly structural?: true;
  /**
   * Some rule uses `:has()`, so what a node matches can change when something beneath it does.
   * Said on the sheet for the same reason `structural` is: the cost is invalidation, and only a
   * sheet that asks has the engine match a changed node's ancestors again.
   */
  readonly has?: true;
  /**
   * The `@font-face` rules the sheet declares, each `source` the bundler's `require` of the file.
   * The engine does not read them: `loadFonts()` in `@ng-native/expo/fonts` registers them with
   * the platform before mount.
   */
  readonly fonts?: readonly {
    readonly family: string;
    readonly source: unknown;
    readonly weight?: number;
    /** The weights a variable font covers, `font-weight: 100 900`, in place of one `weight`. */
    readonly weightRange?: readonly [number, number];
    readonly style?: string;
  }[];
}

/**
 * What one node resolved to. `style` is what it renders with; `inherited` is what its children
 * start from, which is the parent's own `inherited` plus whatever inheritable values this node
 * set. Keeping the two apart is what lets resolution go downwards.
 */
/** What a node's matched rules come to: shared between nodes that match the same way. */
type Styled = Pick<StyleCache, 'style' | 'inherited' | 'tokens' | 'important'>;

export interface StyleCache {
  epoch: number;
  /**
   * Identity token standing for "the ancestor chain, as far as matching is concerned". A node
   * mints a fresh one whenever it recomputes, and reuses its previous one when it does not, so a
   * descendant can tell whether anything above it moved with a single reference comparison.
   *
   * It has to cover more than the inherited values. `.wrap.dark .label` and
   * `:host-context(.dark) .label` both change what a descendant matches when a class toggles on
   * an ancestor, while nothing inherited changes at all, so watching the inherited map alone
   * leaves those stale.
   */
  context: object;
  /** The parent's `context` this was computed from. */
  parentContext: object;
  /**
   * Identity token standing for what an element under this node could match differently: minted
   * when the node is styled for a change that can alter that, and kept when it is styled again
   * for one that cannot, a custom property of its own or an inherited value from above. An
   * element whose parent's is the one it was last styled under matches the rules it did, so it
   * is styled from those it kept and they are not found again.
   */
  scope: object;
  /** The parent's `scope` this was computed from. */
  parentScope: object;
  /** The rules the node matched, for a styling that finds its parent's `scope` as it was. */
  rules?: readonly StyleRule[];
  /** The conditions version this was resolved under. */
  generation: number;
  style: Record<string, unknown>;
  inherited: Record<string, unknown>;
  /**
   * Custom properties in scope for this node and its descendants. Cascades exactly as inherited
   * values do, and by the same copy-on-write rule, so a subtree that defines none shares one map.
   */
  tokens: Readonly<Record<string, TokenValue>>;
  /**
   * The rules the node matched, kept only while a sheet uses `:has()`: what a node whose
   * subtree changed is compared against, to tell whether it has to be restyled.
   */
  matched?: readonly StyleRule[];
  /**
   * Set once a child takes a value from this node's own style, an `inherit` for a property CSS
   * does not hand down: a change to the node's inline style then restyles it, and its children
   * with it, where otherwise an inline style changes nothing a child resolves to.
   */
  heirs?: true;
  /**
   * The properties a rule declared `!important`, where any did: an inline style is the last of
   * the plain declarations, so for these what the rules say stands over it.
   */
  important?: ReadonlySet<string>;
}

/**
 * Whether a child is one `:empty` sees. An anchor is a comment on the web, which it does not;
 * nor text of no length, which a binding to nothing leaves behind.
 */
export function fills(child: StyleTarget): boolean {
  if (child.kind === 'anchor') return false;
  return child.kind !== 'text' || (child as { text?: string }).text !== '';
}

/** What the matcher needs of a node. The engine's node satisfies this structurally. */
export interface StyleTarget {
  readonly name: string;
  readonly parent: StyleTarget | null;
  /**
   * Needed only by the selectors that ask about a node's place among its siblings, which is why
   * it is read through the parent rather than kept as an index: an index would have to be right
   * after every insertion and removal, and this is right by construction.
   */
  readonly children?: readonly StyleTarget[];
  /**
   * Only elements are counted by the selectors that ask about position. Text is not one, and
   * neither is the anchor a structural directive leaves behind - the same reason a browser does
   * not count a comment. Absent means element, so a hand-built target needs nothing extra.
   */
  readonly kind?: string;
  readonly classes: ReadonlySet<string> | null;
  readonly props: Readonly<Record<string, unknown>>;
  /**
   * Whether `props.style` sets a property children inherit, kept by whoever sets the style so the
   * resolver reads the style only where it can matter. Absent is false.
   */
  readonly inlineInherits?: boolean;
  /**
   * The bound declarations that are a `var()`, `[style.color]="'var(--brand)'"`, as the deferred
   * declarations a rule's would be: settled with the node's tokens, last of its normal ones.
   */
  readonly boundStyle?: readonly DeferredDeclaration[] | null;
  /** A node the engine made, such as the paragraph around loose text: it only inherits. */
  readonly anonymous?: true;
  /** One of HTML's text elements the engine has styles of its own for, such as `strong`. */
  readonly styled?: true;
  /**
   * The sheet this node's own rules come from, which is the sheet of the component whose renderer
   * created it. Read from the node rather than passed in, because a node's ancestors usually
   * belong to other components and must be matched against their own sheets, not this one's.
   */
  readonly sheet: StyleSheet | null;
  /**
   * The sheet of the component this node is the *host* of, if it is one. Distinct from `sheet`,
   * which is the sheet of the component that *created* it: a host node is created by the parent,
   * so those two are always different sheets and `:host` needs the second.
   */
  hostSheet: StyleSheet | null;
  /**
   * Custom properties set on the node itself, `[style.--tint]` or `style="--tint: red"`, already
   * converted (`inline-token.ts`). In scope for its own rules and its descendants', and stronger
   * than any rule's, as inline style is on the web. Absent on a hand-built target.
   */
  readonly customProperties?: Readonly<Record<string, TokenValue>> | null;
  /** Memo slot, owned by the resolver. */
  styleCache: StyleCache | null;
  /** Set when something that could change what this node matches has changed. */
  styleDirty: boolean;
  /**
   * Set when what this node matches, or a custom property it holds, may have changed, and nothing
   * that an element under it is matched by: the node is matched and styled again, and those under
   * it are styled from the rules they matched. Absent on a hand-built target.
   */
  ownDirty?: boolean;
  /**
   * Set when something beneath this node changed and a sheet uses `:has()`: the node is matched
   * again, and restyled only if the rules it matches came out different. Absent on a hand-built
   * target.
   */
  hasDirty?: boolean;
  /**
   * Set by the engine when the node's own interaction state changed and nothing else about it
   * did: a press began or ended on it or under it. It is matched again, and keeps the style it
   * has, and everything under it, when it matches the rules it did. Not for an element a rule
   * asks about from another one, which is restyled: see `usesActive`.
   *
   * Set as well when its place among its siblings changed and nothing else about it did, which
   * is the same case: what it is asked about from another element is `placeReadElsewhere`.
   */
  stateDirty?: boolean;
  /** `:focus`. Set by the engine from the native focus and blur events. */
  focused?: boolean;
  /**
   * `:active`. Set by the engine on the responder and every one of its ancestors, because a press
   * activates the whole chain on the web too, not only the deepest element under the finger.
   */
  active?: boolean;
}

/**
 * Properties CSS inherits that mean something on native.
 *
 * RN does not inherit these: a `color` on a view has no effect on a text inside it, only a text
 * inside a text inherits. CSS authors expect otherwise, and a stylesheet written against that
 * expectation would silently lose every colour, so the cascade emulates inheritance for exactly
 * this set. NativeScript does the same.
 */
const INHERITED = new Set([
  'color',
  // Yoga inherits it for layout already; carried here as well so a paragraph can align by it.
  'direction',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textTransform',
  'textDecorationLine',
  'writingDirection',
  // CSS inherits a text shadow, and `user-select: auto` takes the parent's, so a card's
  // `text-shadow-md` or `select-none` reaches the text inside it.
  'textShadowOffset',
  'textShadowRadius',
  'textShadowColor',
  'selectable',
  // CSS inherits it, and its `none` is the element alone: a descendant's `auto` takes touches
  // again. The engine commits a computed `none` as native's `box-none`, which means that.
  'pointerEvents',
]);

/**
 * The `pointer-events` values CSS has. Native's own `box-none` and `box-only` say what their
 * children do already, so neither is handed down.
 */
const INHERITED_POINTER_EVENTS = new Set(['none', 'auto']);

/**
 * `border-style: none`, which the compiler writes as a style native does not have. On the web it
 * makes every border width 0, whichever rule set the width, so `border-hidden border-x` draws no
 * side. Settled here, once the cascade has picked a style, and not sent on.
 */
function drawNoBorder(own: Record<string, unknown>): void {
  delete own['borderStyle'];
  for (const key of Object.keys(own)) if (/^border\w*Width$/.test(key)) own[key] = 0;
  own['borderWidth'] = 0;
}

/** Each side's own style, as the compiler keeps it, and the width it is the style of. */
const SIDE_STYLES = ['Top', 'Right', 'Bottom', 'Left', 'Start', 'End'].map(
  (side) => [`border${side}Style`, `border${side}Width`] as const,
);

/**
 * Settle a border side by side, once the cascade has picked each side's style: a side styled
 * `none` has no width, whichever rule set one, and the one style native has is that of a side
 * that is drawn. With no side drawn and no style at all, there is no border. A side's own style
 * is not sent on: native has none.
 */
function settleBorders(own: Record<string, unknown>): void {
  let drawn: unknown;
  for (const [style, width] of SIDE_STYLES) {
    if (!(style in own)) continue;
    if (own[style] === 'none') own[width] = 0;
    else drawn ??= own[style];
    delete own[style];
  }
  if (own['borderStyle'] !== 'none') return;
  if (drawn === undefined) drawNoBorder(own);
  else own['borderStyle'] = drawn;
}

/**
 * Deterministic work counters for the matcher.
 *
 * Wall-clock is noise; a compound comparison is not. Asserting on these catches an algorithmic
 * regression (a walk that became quadratic, a cache that stopped hitting) in a way that a timing
 * assertion never could without being flaky. `test/css-cost.test.ts` holds the baselines.
 *
 * The cost is one integer increment per comparison, against a Set lookup and several property
 * reads, so it does not distort what it measures.
 */
/**
 * What a sheet asks about a pressed element. `own` is whether a rule styles one, `.button:active`,
 * which matching the pressed elements again answers. `elsewhere` is each compound that asks about
 * a pressed element from another one: `.card:active .title`, `.a:active + .b`, or `:active`
 * inside `:not()`, `:is()` or `:has()`. An element such a compound could be is restyled with
 * everything under it when it is pressed, as what it changes is not itself alone.
 */
export function usesActive(sheet: StyleSheet): ActiveUse {
  const known = ACTIVE_USE.get(sheet);
  if (known) return known;
  let own = false;
  const elsewhere: Compound[] = [];
  for (const rule of sheet.rules) {
    rule.compounds.forEach((compound, at) => {
      const subject = at === rule.compounds.length - 1;
      // Asked of the element itself, on the compound or in its `:is()` and `:not()`: the
      // subject's is its own, and any other compound's is of the element that compound is.
      if (activeItself(compound, elsewhere)) {
        if (subject) own = true;
        else elsewhere.push(compound);
      }
      activeAround(compound, elsewhere);
    });
  }
  const use = { own, elsewhere };
  ACTIVE_USE.set(sheet, use);
  return use;
}

const isActive = (compound: Compound): boolean => compound.pseudo?.includes('active') === true;

/**
 * Whether a compound asks about the pressed state of the element it matches: on itself, in a
 * `:not()`, or as the last compound of an `:is()` argument. The compounds before the last in
 * such an argument are other elements, and are collected as they are.
 */
function activeItself(compound: Compound, elsewhere: Compound[]): boolean {
  let itself = isActive(compound);
  for (const inner of compound.not ?? []) {
    if (activeItself(inner, elsewhere)) itself = true;
    activeAround(inner, elsewhere);
  }
  for (const chain of compound.is ?? []) {
    chain.forEach((inner, at) => {
      const asked = activeItself(inner, elsewhere);
      if (asked && at === chain.length - 1) itself = true;
      else if (asked) elsewhere.push(inner);
      activeAround(inner, elsewhere);
    });
  }
  return itself;
}

/** Each compound that asks about a pressed element around the one a compound matches. */
function activeAround(compound: Compound, elsewhere: Compound[]): void {
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (isActive(value as Compound)) elsewhere.push(value as Compound);
    for (const inside of Object.values(value)) collect(inside);
  };
  for (const [key, inside] of Object.entries(compound)) {
    if (key !== 'is' && key !== 'not' && key !== 'pseudo') collect(inside);
  }
}
export interface ActiveUse {
  readonly own: boolean;
  readonly elsewhere: readonly Compound[];
}
const ACTIVE_USE = new WeakMap<StyleSheet, ActiveUse>();

export const styleStats = {
  /** Calls to `matchesCompound`, the innermost unit of matching work. */
  compoundTests: 0,
  /** Rules considered, i.e. calls to `matches`. */
  ruleTests: 0,
  /** Nodes cascaded, as opposed to handed back from the memo. */
  nodesResolved: 0,
  /** Rules filed by key selector: each sheet's once, however many sheets come after it. */
  rulesFiled: 0,
};

export function resetStyleStats(): void {
  styleStats.compoundTests = 0;
  styleStats.ruleTests = 0;
  styleStats.nodesResolved = 0;
  styleStats.rulesFiled = 0;
}

/** A prop's value as an attribute test compares it: in lower case, under the i flag. */
const attributeText = (actual: unknown, test: AttributeTest): string =>
  test.insensitive ? String(actual).toLowerCase() : String(actual);

/**
 * `[disabled]`, and the value operators.
 *
 * A prop set to `false` or `null` counts as absent, matching the web, where an attribute is either
 * present or not and a `disabled` binding that evaluates false removes it. Everything else is
 * compared as a string, so `[tabIndex="0"]` works against a numeric prop. `class` is no prop: it
 * is the element's class list, as the attribute would spell it.
 */
function matchesAttribute(node: StyleTarget, test: AttributeTest): boolean {
  const actual = test.name === 'class' ? classAttribute(node) : node.props[test.name];
  if (actual === undefined || actual === null || actual === false) return false;
  if (test.operator === undefined) return true;
  // `^=`, `$=`, `*=` and `~=` with an empty value match nothing, as Selectors 4 says.
  if (test.value === '' && !EMPTY_MATCHES.has(test.operator)) return false;
  return matchesValue(attributeText(actual, test), test.operator, test.value!);
}

/** The classes of a node in the order they were set, one space between each; none is absent. */
const classAttribute = (node: StyleTarget): string | undefined =>
  node.classes?.size ? [...node.classes].join(' ') : undefined;

/** The operators an empty value can still match by: `=` and `|=`. */
const EMPTY_MATCHES: ReadonlySet<AttributeTest['operator']> = new Set(['equal', 'dash-match']);

/** Whether an attribute's value, as `attributeText` gives it, passes an operator's test. */
function matchesValue(
  value: string,
  operator: NonNullable<AttributeTest['operator']>,
  expected: string,
): boolean {
  switch (operator) {
    case 'equal':
      return value === expected;
    case 'prefix':
      return value.startsWith(expected);
    case 'suffix':
      return value.endsWith(expected);
    case 'substring':
      return value.includes(expected);
    case 'includes':
      // `~=` matches one whole word of a space-separated list.
      return value.split(/\s+/).includes(expected);
    case 'dash-match':
      // `|=` matches the value itself or the value followed by a hyphen, as `lang` uses.
      return value === expected || value.startsWith(`${expected}-`);
  }
}

/*
 * Exempt from the complexity limit deliberately. This is a flat conjunction of independent
 * guards, not nested logic: cyclomatic complexity scores the two the same, and they are not the
 * same thing. It is also the hottest function in the matcher, called tens of thousands of times
 * per commit, so splitting each guard into its own call would cost more than it reads better.
 */
// eslint-disable-next-line complexity
function matchesCompound(node: StyleTarget, compound: Compound, sheet: StyleSheet | null): boolean {
  styleStats.compoundTests++;
  if (compound.host !== undefined && node.hostSheet !== sheet) return false;
  if (compound.root !== undefined && node.parent !== null) return false;
  if (compound.pseudo !== undefined) {
    for (const state of compound.pseudo) {
      if (state === 'focus' ? !node.focused : !node.active) return false;
    }
  }
  if (compound.type !== undefined && compound.type !== node.name) return false;
  if (compound.id !== undefined && node.props['nativeID'] !== compound.id) return false;
  for (const className of compound.classes) {
    if (!node.classes?.has(className)) return false;
  }
  if (compound.attributes) {
    for (const test of compound.attributes) {
      if (!matchesAttribute(node, test)) return false;
    }
  }
  if (compound.empty !== undefined && node.children?.some(fills)) return false;
  if (compound.nth !== undefined) {
    for (const test of compound.nth) {
      if (!matchesNth(node, test)) return false;
    }
  }
  if (compound.not) {
    for (const excluded of compound.not) {
      if (matchesCompound(node, excluded, sheet)) return false;
    }
  }
  if (compound.is) {
    for (const alternatives of compound.is) {
      if (!alternatives.some((option) => matchesCompound(node, option, sheet))) return false;
    }
  }
  if (compound.has) {
    for (const test of compound.has) {
      if (!hasBeneath(node, test, sheet)) return false;
    }
  }
  if (compound.parents) {
    const parent = node.parent;
    if (!parent) return false;
    for (const above of compound.parents) {
      if (!matchesCompound(parent, above, sheet)) return false;
    }
  }
  if (compound.ancestors) {
    for (const ancestor of compound.ancestors) {
      let found = false;
      // From the parent: a descendant combinator never matches the node against itself.
      for (let n = node.parent; n && !found; n = n.parent) {
        found = matchesCompound(n, ancestor, sheet);
      }
      if (!found) return false;
    }
  }
  if (compound.hostContext) {
    for (const context of compound.hostContext) {
      // The host itself counts, as it does on the web.
      let found = false;
      for (let n: StyleTarget | null = node; n && !found; n = n.parent) {
        found = matchesCompound(n, context, sheet);
      }
      if (!found) return false;
    }
  }
  return true;
}

/** Whether some element beneath `node`, or some child of it for `:has(> x)`, matches the test. */
function hasBeneath(node: StyleTarget, test: HasTest, sheet: StyleSheet | null): boolean {
  for (const child of node.children ?? []) {
    if (child.kind !== undefined && child.kind !== 'element') continue;
    if (test.any.some((option) => matchesCompound(child, option, sheet))) return true;
    if (!test.child && hasBeneath(child, test, sheet)) return true;
  }
  return false;
}

/**
 * Right-to-left matching, as every CSS engine does it: the rightmost compound is the cheapest
 * filter and rejects almost everything immediately.
 */
export function matches(
  node: StyleTarget,
  rule: StyleRule,
  sheet: StyleSheet | null = null,
): boolean {
  styleStats.ruleTests++;
  const last = rule.compounds.length - 1;
  const subject = rule.compounds[last]!;
  // From the sheet of the component this node hosts, only a :host rule reaches it. Its other
  // rules are for the elements inside that component, which is how emulated encapsulation scopes
  // them on the web; without this, a class the parent puts on the host picks up the child's rule
  // of the same name.
  if (
    sheet !== null &&
    sheet === node.hostSheet &&
    sheet !== node.sheet &&
    subject.host === undefined
  ) {
    return false;
  }
  if (!matchesCompound(node, subject, sheet)) return false;
  return matchPrefix(node, rule, last - 1, sheet);
}

/**
 * Match the part of a selector to the left of an already-matched compound.
 *
 * `index` is the compound still to match, counting leftwards, and `from` is where to start
 * looking. A descendant combinator tries every ancestor and, crucially, keeps trying when the
 * rest of the selector does not work out from there. Taking the first ancestor that fits and
 * committing to it misses `.a > .b .c` whenever the nearest `.b` fails the child combinator while
 * a further one satisfies it, which is what the browser differential suite caught.
 */
function matchPrefix(
  matched: StyleTarget,
  rule: StyleRule,
  index: number,
  sheet: StyleSheet | null,
): boolean {
  if (index < 0) return true;

  const compound = rule.compounds[index]!;
  // `combinators[index]` joins this compound to the one on its right.
  switch (rule.combinators[index]) {
    case 'child':
      return matchStep(matched.parent, rule, index, compound, sheet);
    case 'next-sibling':
      return matchStep(previousElement(matched), rule, index, compound, sheet);
    case 'later-sibling':
      return matchAny(previousElement(matched), previousElement, rule, index, compound, sheet);
    default:
      return matchAny(matched.parent, (node) => node.parent, rule, index, compound, sheet);
  }
}

/** A combinator with exactly one candidate: the parent, or the sibling immediately before. */
function matchStep(
  candidate: StyleTarget | null,
  rule: StyleRule,
  index: number,
  compound: Compound,
  sheet: StyleSheet | null,
): boolean {
  if (!candidate || !matchesCompound(candidate, compound, sheet)) return false;
  return matchPrefix(candidate, rule, index - 1, sheet);
}

/**
 * A combinator with many candidates: every ancestor, or every earlier sibling.
 *
 * Crucially it keeps trying when the rest of the selector does not work out from a candidate that
 * fits. Taking the first and committing to it misses `.a > .b .c` whenever the nearest `.b` fails
 * the child combinator while a further one satisfies it, which is what the browser differential
 * suite caught.
 */
function matchAny(
  first: StyleTarget | null,
  next: (node: StyleTarget) => StyleTarget | null,
  rule: StyleRule,
  index: number,
  compound: Compound,
  sheet: StyleSheet | null,
): boolean {
  for (let candidate = first; candidate; candidate = next(candidate)) {
    if (
      matchesCompound(candidate, compound, sheet) &&
      matchPrefix(candidate, rule, index - 1, sheet)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * An ancestor filter, as a browser has one. A selector of several parts is matched leftwards
 * from the node, up through its ancestors: a node a dozen boxes down is asked of a dozen
 * ancestors for each rule its last part fits, and almost every such rule names an ancestor it
 * has not got. So what a node's ancestors are, their classes, names and ids, is gathered once
 * as sixty-four bits, and a rule that names one of them whose bit is not there is passed over
 * without a walk. Two names can share a bit: that is a walk that finds nothing, as before.
 */
type Bits = readonly [number, number];

const BIT_OF = new Map<string, number>();
/** Past this many names the bits are worked out again: ids made per row would be kept for ever. */
const BITS_KEPT = 4096;

/** The bit a class, a name or an id has among the sixty-four. */
function bitOf(kind: string, name: string): number {
  const key = kind + name;
  let bit = BIT_OF.get(key);
  if (bit === undefined) {
    let hash = 0;
    for (let at = 0; at < key.length; at++) hash = (Math.imul(hash, 31) + key.charCodeAt(at)) | 0;
    bit = (hash ^ (hash >>> 16)) & 63;
    // A bit is its name's hash, so one forgotten is the same when it is asked for again.
    if (BIT_OF.size >= BITS_KEPT) BIT_OF.clear();
    BIT_OF.set(key, bit);
  }
  return bit;
}

const NAMED_ABOVE = new WeakMap<StyleRule, Bits | null>();

/**
 * The classes, names and ids a rule names of the node's ancestors: of each part joined to what
 * is on its right by a descendant or a child combinator. One joined by a sibling combinator is
 * no ancestor of the node, though the parts to its left that are ancestors of it are ancestors
 * of the node as well. Null where it names none, a rule of one part among them.
 */
function namedAbove(rule: StyleRule): Bits | null {
  let named = NAMED_ABOVE.get(rule);
  if (named !== undefined) return named;
  let [low, high] = [0, 0];
  const add = (bit: number) => {
    if (bit < 32) low |= 1 << bit;
    else high |= 1 << (bit - 32);
  };
  for (let at = 0; at < rule.compounds.length - 1; at++) {
    const joined = rule.combinators[at];
    if (joined === 'next-sibling' || joined === 'later-sibling') continue;
    const compound = rule.compounds[at]!;
    for (const className of compound.classes) add(bitOf('.', className));
    if (compound.type !== undefined) add(bitOf('<', compound.type));
    if (compound.id !== undefined) add(bitOf('#', compound.id));
  }
  named = low === 0 && high === 0 ? null : [low, high];
  NAMED_ABOVE.set(rule, named);
  return named;
}

/** The classes, names and ids of a node's ancestors, as bits. */
function bitsAbove(node: StyleTarget): Bits {
  let [low, high] = [0, 0];
  const add = (bit: number) => {
    if (bit < 32) low |= 1 << bit;
    else high |= 1 << (bit - 32);
  };
  for (let up = node.parent; up; up = up.parent) {
    if (up.classes) for (const className of up.classes) add(bitOf('.', className));
    if (up.name !== undefined) add(bitOf('<', up.name));
    const id = up.props?.['nativeID'];
    if (typeof id === 'string') add(bitOf('#', id));
  }
  return [low, high];
}

/** Whether what is above a node lacks something a rule names there. */
const lacks = (above: Bits, named: Bits): boolean =>
  (named[0] & ~above[0]) !== 0 || (named[1] & ~above[1]) !== 0;

const TAKES_PARENTS = new WeakMap<StyleRule, boolean>();

/** Whether a rule has an `inherit` in it, which is settled from the parent's own style. */
function takesParents(rule: StyleRule): boolean {
  let takes = TAKES_PARENTS.get(rule);
  if (takes === undefined) {
    takes = rule.deferred?.some((declaration) => declaration.inherit) === true;
    TAKES_PARENTS.set(rule, takes);
  }
  return takes;
}

/** Whether a node is one of the children CSS counts. Text and anchors are children, not elements. */
const isElement = (node: StyleTarget) => node.kind === undefined || node.kind === 'element';

/** A node's first `count` elements, or its last, skipping everything that is not one. */
export function elementsAtEnd<T extends StyleTarget>(
  siblings: readonly T[],
  count: number,
  fromEnd: boolean,
): T[] {
  const found: T[] = [];
  for (let step = 0; step < siblings.length && found.length < count; step++) {
    const sibling = siblings[fromEnd ? siblings.length - 1 - step : step]!;
    if (isElement(sibling)) found.push(sibling);
  }
  return found;
}

/**
 * Which way from a change in a child list a sheet's rules can match differently, past the
 * elements at its two ends. An element's place from the start hangs on the elements before it
 * and on none after, so a change moves the ones after it; its place from the end is the other
 * way about.
 */
export interface SiblingReach {
  /**
   * How many elements after a change it reaches. All of them, `Infinity`, where it counts from
   * the start (`:nth-child(odd)`) or asks about any element before (`~`). Where it asks only
   * about the element just before (`+`), as many as its longest run of them steps along: one for
   * `.a + .b`, two for `.a + .b + .c`. Zero where it asks none of these.
   */
  readonly after: number;
  /** It counts from the end (`:nth-last-child(2)`). */
  readonly before: boolean;
}

const REACH = new WeakMap<StyleSheet, SiblingReach>();

/**
 * How far a sheet asks about a child list beyond which element is first and which is last.
 * Where no sheet reaches either way, only the elements at the two ends can match differently.
 */
export function siblingReach(sheet: StyleSheet): SiblingReach {
  let known = REACH.get(sheet);
  if (known === undefined) {
    const reach = { after: 0, before: false };
    for (const rule of sheet.rules) {
      reach.after = Math.max(reach.after, stepsAlong(rule.combinators));
      for (const compound of rule.compounds) countSiblings(compound, reach, false);
    }
    known = reach;
    REACH.set(sheet, known);
  }
  return known;
}

/**
 * How many elements on from one a rule's combinators read: every later one for a `~`, and
 * otherwise its longest run of `+`. A run ends at a descendant or child combinator, which steps
 * out of the list.
 */
function stepsAlong(combinators: readonly Combinator[]): number {
  let longest = 0;
  let run = 0;
  for (const one of combinators) {
    if (one === 'later-sibling') return Infinity;
    run = one === 'next-sibling' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * Note in `reach` which end a compound, or one nested in it, counts its siblings from, further
 * than the first or last. A count inside a `:has()` is read as both: what it is asked of is
 * matched again by other means, and which way it reaches is not worked out.
 */
function countSiblings(
  compound: Compound,
  reach: { after: number; before: boolean },
  withinHas: boolean,
): void {
  // Which is first and which is last is the ends, and no count. Not of one name: the first of
  // its name is wherever the others of it are not.
  const counts = (compound.nth ?? []).filter((test) => test.a !== 0 || test.b !== 1 || test.ofType);
  if (counts.some((test) => withinHas || !test.fromEnd)) reach.after = Infinity;
  if (counts.some((test) => withinHas || test.fromEnd)) reach.before = true;
  for (const inner of nestedCompounds(compound)) countSiblings(inner, reach, withinHas);
  for (const test of compound.has ?? []) {
    for (const inner of test.any) countSiblings(inner, reach, true);
  }
}

/**
 * A compound whose element's place is read from another element, with the classes the rule asks
 * of what that element is in: its parent's where `child`, and otherwise of anything above it.
 */
export interface PlaceReader {
  readonly compound: Compound;
  readonly above?: readonly string[];
  readonly child?: boolean;
}

const PLACE_ELSEWHERE = new WeakMap<StyleSheet, readonly PlaceReader[]>();

/**
 * Each compound in a sheet whose element's place among its siblings is read from another
 * element: one with something under it in the rule, `.row:nth-child(odd) .label` and
 * `.a + .b .c`, or one an `:is()` or `:host-context()` looks for above the element styled.
 *
 * An element whose place changed is matched again, and where it matches the rules it did, it
 * and everything under it are left as they were: its own rules are all that its place can
 * change. Not an element one of these could be. What is under that one can match differently
 * though it matches the same, so it is styled again with everything under it.
 *
 * A place read by the element a rule styles, or by the elements before it that the rule steps
 * from (`.a:first-child + .b`), is that element's own: the rules it matches say.
 */
export function placeReadElsewhere(sheet: StyleSheet): readonly PlaceReader[] {
  let known = PLACE_ELSEWHERE.get(sheet);
  if (known === undefined) {
    const elsewhere: PlaceReader[] = [];
    for (const rule of sheet.rules) {
      // A run of compounds joined by `+` and `~` is one child list. Every run but the last is
      // above the element styled, and its last compound is the element the rest hangs under.
      let start = 0;
      rule.compounds.forEach((compound, at) => {
        placeReadAbove(compound, elsewhere);
        const joined = rule.combinators[at];
        if (joined === 'next-sibling' || joined === 'later-sibling') return;
        const run = rule.compounds.slice(start, at + 1);
        // What the run is in: the compound before it, which every element of it is under.
        const list = rule.compounds[start - 1];
        const child = rule.combinators[start - 1] === 'child';
        start = at + 1;
        const above = at < rule.compounds.length - 1;
        if (above && (run.length > 1 || run.some(readsPlace)))
          elsewhere.push({ compound, above: list?.classes, child });
      });
    }
    known = elsewhere;
    PLACE_ELSEWHERE.set(sheet, known);
  }
  return known;
}

/** Whether a compound, or one nested in it at any depth, asks about a place in a child list. */
function readsPlace(compound: Compound): boolean {
  if (compound.nth?.length) return true;
  const within = (compound.has ?? []).flatMap((test) => test.any);
  return [...nestedCompounds(compound), ...within].some(readsPlace);
}

/**
 * Collect the compounds nested in one that are matched against an element above the one it is
 * matched against, and ask about that element's place: `:is(.group:first-child *)`.
 */
function placeReadAbove(compound: Compound, elsewhere: PlaceReader[]): void {
  const above = [
    ...(compound.ancestors ?? []),
    ...(compound.parents ?? []),
    ...(compound.hostContext ?? []),
  ];
  for (const inner of above) if (readsPlace(inner)) elsewhere.push({ compound: inner });
  for (const inner of nestedCompounds(compound)) placeReadAbove(inner, elsewhere);
}

/** The compounds nested in one, a `:has()`'s apart. */
const nestedCompounds = (compound: Compound): Compound[] => [
  ...(compound.not ?? []),
  ...(compound.is ?? []).flat(),
  ...(compound.ancestors ?? []),
  ...(compound.parents ?? []),
  ...(compound.hostContext ?? []),
];

/** The element before this one, skipping everything that is not one. */
function previousElement(node: StyleTarget): StyleTarget | null {
  const siblings = node.parent?.children;
  if (!siblings) return null;
  for (let i = siblings.indexOf(node) - 1; i >= 0; i--) {
    if (isElement(siblings[i]!)) return siblings[i]!;
  }
  return null;
}

/**
 * Whether a node's position satisfies `an + b`.
 *
 * ponytail: the general case counts the node's siblings, so a rule like `:nth-child(2n)` over a
 * long list is quadratic in it. The two that matter - first and last - are answered without
 * counting, and the rest wait for a list that is actually slow.
 */
function matchesNth(node: StyleTarget, test: NthTest): boolean {
  const siblings = node.parent?.children;
  if (!siblings) return false;

  if (test.a === 0 && test.b === 1 && !test.ofType) {
    return (test.fromEnd ? lastElement(siblings) : firstElement(siblings)) === node;
  }

  const from = countPosition(node, siblings, test.fromEnd === true, test.ofType === true);
  if (from === 0) return false;
  // `an + b` for some whole number of steps, which is what CSS counts from.
  if (test.a === 0) return from === test.b;
  const steps = (from - test.b) / test.a;
  return Number.isInteger(steps) && steps >= 0;
}

/** Which element this is among its siblings, counting from one end or the other. Zero if absent. */
/**
 * Drop from the pending deferred set every property a later rule has now set outright.
 *
 * Per property rather than per declaration: one deferred declaration can cover four sides, and a
 * later `padding-left` should take only that side away from it.
 */
function overriddenBy(
  deferred: DeferredDeclaration[],
  declarations: Readonly<Record<string, unknown>>,
  important: boolean,
): DeferredDeclaration[] | null {
  const kept: DeferredDeclaration[] = [];
  for (const declaration of deferred) {
    // A plain declaration cannot take anything from an important one.
    if (declaration.important && !important) {
      kept.push(declaration);
      continue;
    }
    const props = declaration.props.filter((prop) => !(prop in declarations));
    if (props.length === declaration.props.length) kept.push(declaration);
    else if (props.length) kept.push({ ...declaration, props });
  }
  return kept.length ? kept : null;
}

/**
 * The logical property and the physical one for the same corner or edge, left to right. CSS
 * settles the two as one property, the later declaration winning. A native view has a prop for
 * each and takes one whatever their order: React Native the physical corner, Yoga the logical
 * edge. So a declaration of either takes the other out of the cascade.
 */
const SIDES_LTR: readonly (readonly [logical: string, physical: string])[] = [
  ['borderStartStartRadius', 'borderTopLeftRadius'],
  ['borderStartEndRadius', 'borderTopRightRadius'],
  ['borderEndStartRadius', 'borderBottomLeftRadius'],
  ['borderEndEndRadius', 'borderBottomRightRadius'],
  ...['margin', 'padding'].flatMap((box) => [
    [`${box}Start`, `${box}Left`] as const,
    [`${box}End`, `${box}Right`] as const,
  ]),
  ...['Width', 'Color'].flatMap((part) => [
    [`borderStart${part}`, `borderLeft${part}`] as const,
    [`borderEnd${part}`, `borderRight${part}`] as const,
  ]),
  ['start', 'left'],
  ['end', 'right'],
];

const mirrored = (physical: string): string =>
  physical.includes('Left') || physical === 'left'
    ? physical.replace('Left', 'Right').replace('left', 'right')
    : physical.replace('Right', 'Left').replace('right', 'left');

/** Each property's other form, both ways, in a layout of each direction. */
const twins = (pairs: readonly (readonly [string, string])[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    pairs.flatMap(([logical, physical]) => [
      [logical, physical],
      [physical, logical],
    ]),
  );

const TWIN: Readonly<Record<'ltr' | 'rtl', Readonly<Record<string, string>>>> = {
  ltr: twins(SIDES_LTR),
  rtl: twins(SIDES_LTR.map(([logical, physical]) => [logical, mirrored(physical)] as const)),
};

/** The properties of a rule that have another form, plain and important, or null for neither. */
interface Sided {
  readonly plain: readonly string[];
  readonly important: readonly string[];
}

const sidedOf = new WeakMap<StyleRule, Sided | null>();

function sided(rule: StyleRule): Sided | null {
  let found = sidedOf.get(rule);
  if (found !== undefined) return found;
  const twin = TWIN.ltr;
  const plain = Object.keys(rule.declarations).filter((key) => key in twin);
  const important = rule.important ? Object.keys(rule.important).filter((key) => key in twin) : [];
  for (const declaration of rule.deferred ?? []) {
    for (const prop of declaration.props) {
      if (prop in twin) (declaration.important ? important : plain).push(prop);
    }
  }
  found = plain.length || important.length ? { plain, important } : null;
  sidedOf.set(rule, found);
  return found;
}

/** Of `keys`, in the order a rule wrote them, each whose other form comes after it. */
function writtenEarlier(keys: readonly string[], twin: Readonly<Record<string, string>>): string[] {
  return keys.filter((key, at) => keys.indexOf(twin[key]!) > at);
}

/** The other form of each of `keys`, as the record `overriddenBy` reads. */
function twinsOf(
  keys: readonly string[],
  twin: Readonly<Record<string, string>>,
): Record<string, true> {
  const out: Record<string, true> = {};
  for (const key of keys) out[twin[key]!] = true;
  return out;
}

/**
 * One cascade's settling of the corners and edges set in both forms: each rule's are taken out of
 * what the rules before it left, in the form the rule does not use.
 */
class OtherForms {
  /** Worked out for the first rule that sets a corner or an edge, which most elements have none of. */
  private twin: Readonly<Record<string, string>> | null = null;
  private overImportant: Record<string, true> | null = null;
  private readonly direction: () => 'ltr' | 'rtl';

  constructor(direction: () => 'ltr' | 'rtl') {
    this.direction = direction;
  }

  /** Before `rule` is applied: the other form of what it sets goes, as the same property would. */
  before(
    rule: StyleRule,
    normal: Record<string, unknown>,
    important: Record<string, unknown>,
    deferred: DeferredDeclaration[] | null,
  ): DeferredDeclaration[] | null {
    const sides = sided(rule);
    if (!sides) return deferred;
    const twin = (this.twin ??= TWIN[this.direction()]);
    const plain = twinsOf(sides.plain, twin);
    for (const key in plain) delete normal[key];
    let kept = deferred && overriddenBy(deferred, plain, false);
    if (!sides.important.length) return kept;
    const gone = twinsOf(sides.important, twin);
    for (const key in gone) delete important[key];
    kept &&= overriddenBy(kept, gone, true);
    Object.assign((this.overImportant ??= {}), gone);
    return kept;
  }

  /**
   * Once `rule` is applied, its deferred values among `deferred`: where it wrote both forms, the
   * one it wrote later stands, among its plain declarations and among its important ones. The
   * order is the rule's own, sent with it, since a value settled on device is in another list.
   */
  within(
    rule: StyleRule,
    normal: Record<string, unknown>,
    important: Record<string, unknown>,
    deferred: DeferredDeclaration[] | null,
  ): DeferredDeclaration[] | null {
    if (!rule.sides && !rule.importantSides) return deferred;
    const twin = (this.twin ??= TWIN[this.direction()]);
    let kept = deferred;
    const settle = (order: readonly string[], into: Record<string, unknown>, tier: boolean) => {
      const lost: Record<string, true> = {};
      for (const key of writtenEarlier(order, twin)) {
        delete into[key];
        lost[key] = true;
      }
      kept &&= overriddenBy(kept, lost, tier);
    };
    if (rule.sides) settle(rule.sides, normal, false);
    if (rule.importantSides) settle(rule.importantSides, important, true);
    return kept;
  }

  /** An important one stands over the other form wherever that was set, as over its own. */
  after(
    normal: Record<string, unknown>,
    deferred: DeferredDeclaration[] | null,
  ): DeferredDeclaration[] | null {
    if (!this.overImportant) return deferred;
    for (const key in this.overImportant) delete normal[key];
    return deferred && overriddenBy(deferred, this.overImportant, false);
  }
}

/**
 * The deferred values still standing once `rule` has been applied, plus its own.
 *
 * A plain declaration from this rule beats a `var()` from an earlier one. Deferred values are
 * resolved after the cascade has run, so without this a token would win whatever the cascade
 * said: `.row { background: var(--surface) }` would repaint over
 * `.row:nth-child(odd) { background: ... }`, which is a rule with a pseudo-class on top of the
 * same class and should win. An important one survives a plain declaration, and only an important
 * declaration takes it away.
 */
function carryDeferred(
  deferred: DeferredDeclaration[] | null,
  rule: StyleRule,
): DeferredDeclaration[] | null {
  let kept = deferred;
  if (kept && Object.keys(rule.declarations).length) {
    kept = overriddenBy(kept, rule.declarations, false);
  }
  if (kept && rule.important) kept = overriddenBy(kept, rule.important, true);
  if (rule.deferred) (kept ??= []).push(...rule.deferred);
  return kept;
}

const NO_DECLARATIONS: Readonly<Record<string, unknown>> = Object.freeze({});

const pick = <T>(from: Readonly<Record<string, T>>, names: readonly string[]): Record<string, T> =>
  Object.fromEntries(names.map((name) => [name, from[name]!]));

const isImportant = (rule: StyleRule): boolean =>
  rule.important !== undefined ||
  rule.importantTokens !== undefined ||
  rule.deferred?.some((one) => one.important) === true;

/**
 * The matched rules in the order their declarations apply, weakest first.
 *
 * That is the order they matched in, unless a layered rule is important. Layers turn round for
 * `!important`: an important declaration in a layer beats one in a later layer, and both beat one
 * in no layer. So each such rule is split, its plain declarations where it matched, and its
 * important ones after every plain one, in the layers' order reversed.
 */
function byImportance(
  matched: readonly StyleRule[],
  places: WeakMap<StyleRule, LayerPlace>,
): readonly StyleRule[] {
  if (!matched.some((rule) => rule.layer !== undefined && isImportant(rule))) return matched;
  const plain = matched.map((rule) =>
    isImportant(rule)
      ? {
          ...rule,
          important: undefined,
          importantTokens: undefined,
          deferred: rule.deferred?.filter((one) => !one.important),
        }
      : rule,
  );
  const important = matched
    .filter(isImportant)
    // Stable, so rules of one layer keep the order their specificity gave them. Sorted before
    // they are copied, since a rule's place is kept by the rule itself.
    .sort((a, b) => layerOrder(places.get(b), places.get(a)))
    .map((rule) => ({
      ...rule,
      declarations: NO_DECLARATIONS,
      // Its important custom properties alone: the plain ones were applied where it matched.
      tokens: rule.importantTokens && pick(rule.tokens!, rule.importantTokens),
      deferred: rule.deferred?.filter((one) => one.important),
    }));
  return [...plain, ...important];
}

function countPosition(
  node: StyleTarget,
  siblings: readonly StyleTarget[],
  fromEnd: boolean,
  ofType: boolean,
): number {
  let position = 0;
  let seen = 0;
  for (const sibling of siblings) {
    if (!isElement(sibling) || (ofType && sibling.name !== node.name)) continue;
    seen++;
    if (sibling === node) position = seen;
  }
  if (position === 0) return 0;
  return fromEnd ? seen - position + 1 : position;
}

function firstElement(siblings: readonly StyleTarget[]): StyleTarget | null {
  for (const sibling of siblings) if (isElement(sibling)) return sibling;
  return null;
}

function lastElement(siblings: readonly StyleTarget[]): StyleTarget | null {
  for (let i = siblings.length - 1; i >= 0; i--) {
    if (isElement(siblings[i]!)) return siblings[i]!;
  }
  return null;
}

/**
 * How much specificity a component's own rules gain over the application's global sheet.
 *
 * One class, which is precisely what Angular's emulated encapsulation already grants them by
 * rewriting a component rule to carry an `[_ngcontent-x]` attribute. Matching that keeps the
 * precedence people already have in their fingers rather than inventing a rule for native.
 */
const COMPONENT_SPECIFICITY_BUMP = 1_000;

/**
 * Where a layer is among every layer the app's sheets have named: at each depth, its place among
 * the layers nested in its parent, in the order they were first named.
 */
type LayerPlace = readonly number[];

/** The layers named so far at one depth, each with its place and the layers nested in it. */
interface LayerNames {
  readonly place: number;
  readonly nested: Map<string, LayerNames>;
}

/**
 * Two rules' layers, weakest first: a layer before each one named after it, a layer's nested
 * layers before its own rules, and every layered rule before a rule in no layer.
 */
function layerOrder(a: LayerPlace | undefined, b: LayerPlace | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const shared = Math.min(a.length, b.length);
  for (let depth = 0; depth < shared; depth++) {
    if (a[depth] !== b[depth]) return a[depth]! - b[depth]!;
  }
  // One is nested in the other, whose own rules are the stronger.
  return b.length - a.length;
}

/**
 * The engine's own styles for HTML's text elements, as rules to match before any a stylesheet
 * holds, so every rule an author writes beats them whatever its specificity, as a browser's own
 * sheet is beaten. Offered only to a node marked `styled`, which few are.
 */
const ELEMENT_ENTRIES: readonly RuleEntry[] = ELEMENT_STYLES.rules.map((rule) => ({
  rule,
  sheet: ELEMENT_STYLES,
  weight: rule.specificity,
}));

/** One rule in a cascade: the sheet it came from, which `:host` needs, and its weight here. */
interface RuleEntry {
  readonly rule: StyleRule;
  readonly sheet: StyleSheet;
  readonly weight: number;
}

/**
 * The bucket a rule is filed under: the most selective simple selector in its rightmost compound,
 * which is what a browser calls the key selector.
 *
 * Matching counts leftwards from that compound, so if it cannot match a node then nothing to its
 * left needs looking at. Anything that could match a node whose name, id and classes say nothing -
 * an attribute test, `:host`, `:is()`, a bare pseudo-class, `*` - goes in the universal bucket and
 * is offered to everything, because the alternative is a rule that silently stops applying.
 */
export function ruleKey(rule: StyleRule): string {
  return ruleKeys(rule)[0]!;
}

/**
 * Every bucket a rule is filed under. One, but for a rule whose rightmost compound is only an
 * `:is()` of compounds that each have a key: it is filed under each of theirs, since a node it
 * matches has one of them.
 *
 * A rule that says nothing of the node's own name can still say whose child it is, `.row > *`.
 * It is filed under the parent's class, and offered to the children of an element that has it.
 */
export function ruleKeys(rule: StyleRule): readonly string[] {
  const key = rule.compounds[rule.compounds.length - 1];
  if (!key) return EVERY_NODE;
  if (key.classes.length) return [`class:${key.classes[0]}`];
  if (key.id !== undefined) return [`id:${key.id}`];
  if (key.type !== undefined) return [`type:${key.type}`];
  const held = parentClass(rule, key);
  if (held !== undefined) return [`in:${held}`];
  return alternativeKeys(key) ?? attributeKey(key) ?? ancestorKeys(rule, key) ?? EVERY_NODE;
}

/**
 * The buckets of a rule for anything inside an element with a class, `.item:focus *`: under the
 * class, or each class the element may have instead. Offered to what has such an element
 * somewhere over it, where the universal bucket has every element walk to the root to find none.
 */
function ancestorKeys(rule: StyleRule, key: Compound): string[] | undefined {
  const joined = rule.combinators[rule.combinators.length - 1];
  const above =
    key.ancestors?.[0] ??
    (joined === 'descendant' ? rule.compounds[rule.compounds.length - 2] : undefined);
  if (!above) return undefined;
  if (above.classes.length) return [`under:${above.classes[0]}`];
  const any = above.is?.[0];
  if (!any?.length || any.some((one) => !one.classes.length)) return undefined;
  return any.map((one) => `under:${one.classes[0]}`);
}

/**
 * The bucket of a rule that names its element by an attribute and nothing else, `[ngpButton]`:
 * a prop the element has to have, which is how a headless library names every element it
 * styles. Not `class`, which is no prop of the element's to find the bucket by.
 */
function attributeKey(key: Compound): string[] | undefined {
  const named = key.attributes?.find((test) => test.name !== 'class');
  return named ? [`attr:${named.name}`] : undefined;
}

/** A class the node's parent has to have for the rule to match, where its selector says one. */
function parentClass(rule: StyleRule, key: Compound): string | undefined {
  const written = key.parents?.find((compound) => compound.classes.length > 0);
  if (written) return written.classes[0];
  if (rule.combinators[rule.combinators.length - 1] !== 'child') return undefined;
  return rule.compounds[rule.compounds.length - 2]?.classes[0];
}

/** The keys of each compound a bare `:is()` takes, or nothing where one of them has none. */
function alternativeKeys(key: Compound): string[] | undefined {
  const any = key.is?.[0];
  if (!any?.length) return undefined;
  const keys: string[] = [];
  for (const one of any) {
    if (one.classes.length) keys.push(`class:${one.classes[0]}`);
    else if (one.id !== undefined) keys.push(`id:${one.id}`);
    else if (one.type !== undefined) keys.push(`type:${one.type}`);
    else return undefined;
  }
  return keys;
}

const UNIVERSAL = '*';
const EVERY_NODE: readonly string[] = [UNIVERSAL];

/**
 * Where each kind of sheet is filed, as a multiple of the room one sheet's rules are given: the
 * global sheet first, then a host's own, its creator's, and each added sheet after those.
 */
const SHEET_ROOM = 1_000_000;
const HOSTS = 1;
const CREATED = 2;
const ADDED = 3;

/** A rule in an index, and where it comes among rules of the same weight: the order it was written in. */
interface IndexedEntry {
  readonly entry: RuleEntry;
  readonly at: number;
}

export interface RuleIndex {
  readonly buckets: Map<string, IndexedEntry[]>;
  readonly universal: IndexedEntry[];
  /** Whether any rule is filed under an attribute, which a node's props are then looked up for. */
  attributes?: boolean;
  /** Whether any is filed under the class of an element its own is inside. */
  under?: boolean;
}

/**
 * File rules by key selector, each at `from` and on: its place among every rule there is, which
 * settles the order of two of the same weight. Into an index there already where one is given,
 * so a sheet that arrives later is added to what is filed and nothing is filed again.
 */
export function indexRules(
  entries: readonly RuleEntry[],
  into: RuleIndex = { buckets: new Map(), universal: [] },
  from = 0,
): RuleIndex {
  styleStats.rulesFiled += entries.length;
  entries.forEach((entry, n) => {
    const indexed = { entry, at: from + n };
    for (const key of ruleKeys(entry.rule)) {
      if (key === UNIVERSAL) {
        into.universal.push(indexed);
        continue;
      }
      if (key.startsWith('attr:')) into.attributes = true;
      else if (key.startsWith('under:')) into.under = true;
      const bucket = into.buckets.get(key);
      if (bucket) bucket.push(indexed);
      else into.buckets.set(key, [indexed]);
    }
  });
  return into;
}

/** Rules in the order they were filed in, which is the order of a list sorted before it was. */
const byPlace = (a: IndexedEntry, b: IndexedEntry): number => a.at - b.at;

/** Add to `found` what one index holds in the buckets a node's name, id and classes reach. */
function reach(node: StyleTarget, index: RuleIndex, found: IndexedEntry[]): void {
  const take = (key: string): void => {
    const bucket = index.buckets.get(key);
    if (bucket) found.push(...bucket);
  };
  if (index.universal.length) found.push(...index.universal);
  take(`type:${node.name}`);
  const id = node.props['nativeID'];
  if (typeof id === 'string') take(`id:${id}`);
  if (node.classes) for (const name of node.classes) take(`class:${name}`);
  // What is written for any child of an element with one of the parent's classes.
  const around = node.parent?.classes;
  if (around) for (const name of around) take(`in:${name}`);
  if (index.attributes) reachByAttribute(node, take);
  if (index.under) reachUnder(node, take);
}

/** The buckets of the classes of every element over a node. */
function reachUnder(node: StyleTarget, take: (key: string) => void): void {
  for (let above = node.parent; above; above = above.parent) {
    if (above.classes) for (const name of above.classes) take(`under:${name}`);
  }
}

/** The buckets of the attributes a node has: a prop of its own that is set. */
function reachByAttribute(node: StyleTarget, take: (key: string) => void): void {
  for (const name in node.props) {
    const value = node.props[name];
    // As `matchesAttribute` has it: a prop that is false is an attribute that is not there.
    if (value !== undefined && value !== null && value !== false) take(`attr:${name}`);
  }
}

/**
 * The rules worth trying against a node, in cascade order: `order` says which of two comes
 * first, and with none it is the order they were filed in.
 *
 * From each index, only the buckets the node's name, id and classes reach, which is the entire
 * point of the index: the lists are short by construction, so sorting them is cheap.
 */
export function candidateRules(
  node: StyleTarget,
  indexes: RuleIndex | readonly RuleIndex[],
  order: (a: IndexedEntry, b: IndexedEntry) => number = byPlace,
): RuleEntry[] {
  const found: IndexedEntry[] = [];
  const all = Array.isArray(indexes) ? (indexes as readonly RuleIndex[]) : [indexes as RuleIndex];
  for (const index of all) reach(node, index, found);
  if (found.length < 2) return found.map((indexed) => indexed.entry);
  found.sort(order);
  // A rule filed under two keys the node has is offered once.
  const offered: RuleEntry[] = [];
  for (let i = 0; i < found.length; i++) {
    if (found[i] !== found[i - 1]) offered.push(found[i]!.entry);
  }
  return offered;
}

/**
 * The properties the rules matching a node declared `!important`, or nothing where none did:
 * each by its own name and by the other form of it, so `margin-left` stands over an inline
 * `marginStart` as it does over an inline `marginLeft`.
 */
function importantNames(
  result: CascadeResult,
  twin: () => Readonly<Record<string, string>>,
): ReadonlySet<string> | undefined {
  const deferred = result.deferred?.filter((one) => one.important) ?? [];
  if (!result.important && !deferred.length) return undefined;
  const names = [...Object.keys(result.important ?? {}), ...deferred.flatMap((one) => one.props)];
  const sided = names.filter((name) => name in TWIN.ltr);
  return new Set(sided.length ? [...names, ...sided.map((name) => twin()[name]!)] : names);
}

/** What the rules matching one node add up to. */
interface CascadeResult {
  readonly declarations: Record<string, unknown>;
  /** The important declarations alone, which a deferred value that is not important cannot beat. */
  readonly important: Record<string, unknown> | null;
  readonly tokens: Record<string, TokenValue> | null;
  /** The custom properties among `tokens` declared `!important`, which the element's own do not take. */
  readonly importantTokens: Record<string, TokenValue> | null;
  readonly deferred: DeferredDeclaration[] | null;
}

/** What `em` falls back to when nothing in scope has set a font size. The web's default. */
const DEFAULT_FONT_SIZE = 16;

/** Shared empty result. Never handed out anywhere that mutates it. */
const EMPTY: Record<string, unknown> = {};

/** Stands in for the parent of a root node, so the comparison needs no null case. */
const ROOT_CONTEXT: object = {};
/** The `scope` over a node with no parent. */
const ROOT_SCOPE: object = {};
/**
 * The `scope` of the one cache every node with nothing to style shares. It is no one node's, so
 * nothing styled under it, or holding it, is taken to match what it did.
 */
const SHARED_SCOPE: object = {};

/** Shared empty token map, for the overwhelmingly common case of a subtree defining none. */
const NO_TOKENS: Readonly<Record<string, TokenValue>> = {};

/**
 * Conditions generations are unique across every resolver in the process, not merely
 * increasing within one, because the memo they stamp lives on the compiled rule and a sheet is
 * shared by every engine that mounts the component.
 */
let generations = 0;

/** What a sheet's rules are written for: the last compound of each, by its class or its name. */
export interface Subjects {
  readonly classes: Set<string>;
  readonly types: Set<string>;
  /**
   * The classes of the boxes that rules for anything are written inside: `.dialog > :first-child`
   * is for any element, but only one that has an element with `dialog` over it.
   */
  readonly inside: Set<string>;
  /** A rule for anything anywhere: no class, no name, and no such box to be in. */
  any: boolean;
  /**
   * In what a class reaches: a rule is for the element that has the class, `.on`, which is then
   * matched again itself. Unset where the rules are only for elements under it.
   */
  own?: boolean;
}

interface Addition {
  readonly before: number;
  readonly after: number;
  readonly subjects: Subjects;
}

const subjects = new WeakMap<StyleSheet, Subjects>();

function subjectsOf(sheet: StyleSheet): Subjects {
  let found = subjects.get(sheet);
  if (found) return found;
  const classes = new Set<string>();
  const types = new Set<string>();
  const inside = new Set<string>();
  const all = { classes, types, inside, any: false };
  for (const rule of sheet.rules) noteSubject(all, rule);
  subjects.set(sheet, (found = all));
  return found;
}

/**
 * A box a rule asks `:has()` of that is not the node it styles, `.card:has(.x) .title`, by the
 * classes the rule asks of that box, with what the rule is for: the nodes under such a box to
 * match again when what is in it changes.
 */
export interface HasAbove {
  readonly classes: readonly string[];
  readonly subjects: Subjects;
}

const HAS_ABOVE = new WeakMap<StyleSheet, readonly HasAbove[]>();

/** Whether a compound, or one it asks of the same node, uses `:has()`. */
const asksBeneath = (compound: Compound): boolean =>
  compound.has !== undefined ||
  [...(compound.not ?? []), ...(compound.is ?? []).flat()].some(asksBeneath);

/**
 * The boxes above the styled node that a compound asks `:has()` of: the compound's own node,
 * where that is not the styled one, and each box it is asked to be inside,
 * `.body:is(.card:has(.x) *) .title`.
 */
function* boxesAsked(compound: Compound, styled: boolean): Generator<Compound> {
  if (!styled && asksBeneath(compound)) yield compound;
  for (const key of ['ancestors', 'parents', 'hostContext'] as const) {
    for (const outer of compound[key] ?? []) yield* boxesAsked(outer, false);
  }
}

/** Each box a sheet's rules ask `:has()` of above the node they style. */
export function hasAbove(sheet: StyleSheet): readonly HasAbove[] {
  let known = HAS_ABOVE.get(sheet);
  if (known === undefined) {
    const found: HasAbove[] = [];
    for (const rule of sheet.rules) {
      const last = rule.compounds.length - 1;
      for (const [at, compound] of rule.compounds.entries()) {
        for (const box of boxesAsked(compound, at === last)) {
          const subjects = noSubjects();
          noteSubject(subjects, rule);
          found.push({ classes: box.classes, subjects });
        }
      }
    }
    HAS_ABOVE.set(sheet, (known = found));
  }
  return known;
}

/** Note in `into` what a rule is for. */
function noteSubject(into: Subjects, rule: StyleRule): void {
  const subject = rule.compounds.at(-1);
  // One class of several is enough to ask: a node without it matches none of them.
  if (subject?.classes.length) into.classes.add(subject.classes[0]!);
  else if (boxAround(rule) !== undefined) into.inside.add(boxAround(rule)!);
  else if (subject?.type && subject.type !== '*') into.types.add(subject.type);
  else into.any = true;
}

/**
 * What a class changing on an element can restyle, by the rules that name the class:
 *
 * - `true`, the element and all under it and after it, each matched again: a rule names the
 *   class beside its element, or inside `:has()` or `:host-context()`;
 * - or the element itself, `own`, where a rule is for the element that has the class, and the
 *   elements under it that rules are for, where a rule names it as what its own element is
 *   inside, `.busy .row` or `.row:is(.busy *)`: those and no other are matched again.
 *
 * A class in no rule is in neither, and restyles nothing.
 */
type ClassReach = Map<string, true | Subjects>;

interface SheetReach {
  readonly classes: ClassReach;
  /** The tests of the `class` attribute itself, which a class in no rule can still answer. */
  readonly reads: readonly AttributeTest[];
  /** Every attribute a selector of the sheet asks about, by name. */
  readonly named: ReadonlySet<string>;
}

const reaches = new WeakMap<StyleSheet, SheetReach>();

/**
 * How far each class a sheet's selectors name reaches, and the tests of the `class` attribute
 * itself that are in them.
 *
 * The rules are walked whole for the classes in them, whatever a selector is made of: a part of
 * one added later counts as a class that reaches everything, without being named here.
 */
function classReach(sheet: StyleSheet): SheetReach {
  let found = reaches.get(sheet);
  if (found) return found;
  const classes: ClassReach = new Map();
  const reads: AttributeTest[] = [];
  const named = new Set<string>();
  for (const rule of sheet.rules) {
    const every = new Set<string>();
    collectClasses(rule, every, reads, named);
    const { own, inside } = classPlaces(rule);
    for (const name of every) {
      if (!own.has(name) && !inside.has(name)) classes.set(name, true);
      if (own.has(name)) noteOwn(classes, name);
      if (inside.has(name)) noteInside(classes, name, rule);
    }
  }
  reaches.set(sheet, (found = { classes, reads, named }));
  return found;
}

/** Note a rule as one for the element that has a class. */
function noteOwn(found: ClassReach, name: string): void {
  const subjects = found.get(name);
  if (subjects === true) return;
  if (subjects) subjects.own = true;
  else found.set(name, { ...noSubjects(), own: true });
}

/** Note a rule as one that names a class as what its element is inside. */
function noteInside(found: ClassReach, name: string, rule: StyleRule): void {
  let subjects = found.get(name);
  if (subjects === true) return;
  if (!subjects) found.set(name, (subjects = noSubjects()));
  const subject = rule.compounds.at(-1);
  if (subject?.classes.length) subjects.classes.add(subject.classes[0]!);
  else if (subject?.type && subject.type !== '*') subjects.types.add(subject.type);
  // A rule for anything in the box, `.busy > *`: anything under the node the class changed
  // on. Asking which box has the class finds none once the class has gone from it.
  else subjects.any = true;
}

const noSubjects = (): Subjects => ({
  classes: new Set(),
  types: new Set(),
  inside: new Set(),
  any: false,
});

/** The reach of classes that rules are for the element of, and for nothing under it. */
const OWN_ALONE: Subjects = { ...noSubjects(), own: true };

/** Add to `into` what `from` is for. */
function addSubjects(into: Subjects, from: Subjects): void {
  for (const name of from.classes) into.classes.add(name);
  for (const name of from.types) into.types.add(name);
  for (const name of from.inside) into.inside.add(name);
  into.any ||= from.any;
  if (from.own) into.own = true;
}

/**
 * Where a rule names each class it names, for the classes it names in no other place than these:
 *
 * - `own`, on the element the rule is for: its own classes, and those in `:is()` and `:not()` of
 *   it, which are asked of that element;
 * - `inside`, as what that element is inside: the classes of a compound before the last, with
 *   nothing but `>` and a space between there and the element, and those of what `:is(.box *)`
 *   and `:is(.box > *)` put over it.
 *
 * A class named anywhere else in the rule is in neither, whatever else names it: beside the
 * element, inside `:has()` or `:host-context()`, or in `:not()` of a box the element is in.
 */
function classPlaces(rule: StyleRule): { own: ReadonlySet<string>; inside: ReadonlySet<string> } {
  const own = new Set<string>();
  const inside = new Set<string>();
  const elsewhere = new Set<string>();
  const last = rule.compounds.length - 1;
  let under = true;
  for (let index = last; index >= 0; index--) {
    const compound = rule.compounds[index]!;
    if (index === last) {
      placeClasses(compound, own, inside, elsewhere);
      continue;
    }
    const joined = rule.combinators[index];
    under &&= joined === 'child' || joined === 'descendant';
    // A box the element is under, by its classes and by those it is asked to have or not to,
    // `.box:not(.busy) .row`: each is asked of that box, as its own are.
    const over = under ? inside : elsewhere;
    placeClasses(compound, over, over, elsewhere);
  }
  for (const name of elsewhere) {
    own.delete(name);
    inside.delete(name);
  }
  return { own, inside };
}

/**
 * The classes of a compound asked of the element a rule is for, into `at`, and of the compounds
 * it puts over that element, into `inside`. What any other part of it names goes `elsewhere`:
 * a part read here by name is one this knows the reach of, and one added later is not.
 */
function placeClasses(
  compound: Compound,
  at: Set<string>,
  inside: Set<string>,
  elsewhere: Set<string>,
): void {
  const {
    classes,
    is,
    not,
    ancestors,
    parents,
    type: _t,
    id: _i,
    root: _r,
    pseudo: _p,
    ...rest
  } = compound;
  for (const name of classes) at.add(name);
  for (const alternatives of is ?? []) {
    for (const option of alternatives) placeClasses(option, at, inside, elsewhere);
  }
  for (const excluded of not ?? []) placeClasses(excluded, at, inside, elsewhere);
  // What is over the element is over it whichever of these said so, and what is over that is too.
  for (const above of [...(ancestors ?? []), ...(parents ?? [])]) {
    placeClasses(above, inside, inside, elsewhere);
  }
  // `attributes` among them: a test of the `class` attribute is answered through `classTests`.
  collectClasses(rest, elsewhere, []);
}

/** What a rule declares, which names no element. */
const DECLARED = new Set(['declarations', 'important', 'tokens']);

/**
 * Add each class under `value` to `into`, each test of the `class` attribute to `reads`, and the
 * name of every attribute asked about to `named`.
 */
function collectClasses(
  value: unknown,
  into: Set<string>,
  reads: AttributeTest[],
  named?: Set<string>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    return value.forEach((inner) => collectClasses(inner, into, reads, named));
  }
  const part = value as { classes?: unknown; attributes?: unknown };
  if (Array.isArray(part.classes)) for (const name of part.classes) into.add(String(name));
  if (Array.isArray(part.attributes)) {
    for (const test of part.attributes as AttributeTest[]) {
      named?.add(test.name);
      if (test.name === 'class') reads.push(test);
    }
  }
  for (const [key, inner] of Object.entries(value)) {
    if (!DECLARED.has(key)) collectClasses(inner, into, reads, named);
  }
}

/**
 * Whether a class coming or going could change what a test of the `class` attribute answers.
 * One class of the list where the test is for a whole class or for part of one; any class
 * where it is for how the list starts or ends, or for a part with a space in it.
 */
function answers(test: AttributeTest, name: string): boolean {
  const value = test.value ?? '';
  const folded = test.insensitive ? name.toLowerCase() : name;
  if (test.operator === 'includes') return folded === value;
  if (test.operator === 'substring' && !/\s/.test(value)) return folded.includes(value);
  return true;
}

/**
 * A class of the nearest box a rule's subject has to be in: the compound before it, where that
 * is joined as what holds it and names a class. Nothing where it is a sibling, or has no class.
 */
function boxAround(rule: StyleRule): string | undefined {
  const joined = rule.combinators.at(-1);
  if (joined !== 'child' && joined !== 'descendant') return undefined;
  return rule.compounds.at(-2)?.classes[0];
}

/** Whether a rule among these could be for a node: never no where one is. */
function writtenFor(of: Subjects, node: StyleTarget): boolean {
  if (of.any || of.types.has(node.name)) return true;
  for (const name of node.classes ?? []) if (of.classes.has(name)) return true;
  if (!of.inside.size) return false;
  for (let over = node.parent; over; over = over.parent) {
    for (const name of over.classes ?? []) if (of.inside.has(name)) return true;
  }
  return false;
}

/**
 * Whether a node has its answer for this commit already. Not one marked since it was given the
 * one cache every box with nothing to style shares, see `unstyled`: another of them resolved in
 * this commit has set that cache's epoch, and it is not this node's answer.
 */
function resolvedIn(epoch: number, cache: StyleCache | null, node: StyleTarget): boolean {
  return (
    cache !== null && cache.epoch === epoch && (!node.styleDirty || cache.context !== ROOT_CONTEXT)
  );
}

function emptyCacheFor(epoch: number, generation: number): StyleCache {
  return {
    epoch,
    generation,
    context: ROOT_CONTEXT,
    parentContext: ROOT_CONTEXT,
    scope: SHARED_SCOPE,
    parentScope: SHARED_SCOPE,
    style: EMPTY,
    inherited: EMPTY,
    tokens: NO_TOKENS,
  };
}

/**
 * A unitless line-height as a node hands it down. CSS inherits the number, not the points it comes
 * to where it is written, so a title under `.card { font-size: 10px; line-height: 2 }` with a
 * font size of 20 is 40 tall, not 20. It is only ever in an inherited map: `settleLineHeight`
 * turns it into points in every style a node renders with.
 */
interface LineHeightMultiple {
  readonly multiple: number;
}

function isMultiple(value: unknown): value is LineHeightMultiple {
  return typeof value === 'object' && value !== null && 'multiple' in value;
}

/** A line-height as points, for a node of font size `size`: what an em of it comes to. */
function lineHeightPoints(line: LineHeightMultiple, size: unknown): number {
  const points = line.multiple * (typeof size === 'number' ? size : DEFAULT_FONT_SIZE);
  return Math.round(points * 1000) / 1000;
}

/** A node's style with a unitless line-height it set or inherited worked out against its font size. */
function settleLineHeight(style: Record<string, unknown>): void {
  const line = style['lineHeight'];
  if (isMultiple(line)) style['lineHeight'] = lineHeightPoints(line, style['fontSize']);
}

/** The styles of nodes with no rules, by the map they inherit, for one that hands down a multiple. */
const unstyledStyles = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

/**
 * The style of a node no rule matches: what it inherits, with a unitless line-height worked out
 * against its font size, which an inline style can set. The same object where there is none.
 */
function unstyledStyle(
  inherited: Record<string, unknown>,
  inline: Record<string, unknown> | null,
): Record<string, unknown> {
  const line = inherited['lineHeight'];
  if (!isMultiple(line)) return inherited;
  const size = inline?.['fontSize'];
  if (typeof size === 'number') return { ...inherited, lineHeight: lineHeightPoints(line, size) };
  let style = unstyledStyles.get(inherited);
  if (!style) {
    style = { ...inherited, lineHeight: lineHeightPoints(line, inherited['fontSize']) };
    unstyledStyles.set(inherited, style);
  }
  return style;
}

/**
 * What this node's children inherit: the parent's map, overlaid with any inheritable value the
 * node set itself. Copied on first write only, so a node that sets none hands the same object on
 * and a whole subtree can share it.
 */
function inheritFrom(
  parentInherited: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  let inherited = parentInherited;
  for (const key of Object.keys(own)) {
    if (!INHERITED.has(key)) continue;
    // `pointer-events: inherit`, which only an inline style on an element no rule matches still
    // holds here: what the parent hands down stands.
    if (key === 'pointerEvents' && own[key] === 'inherit') continue;
    if (inherited === parentInherited) inherited = { ...parentInherited };
    if (key === 'pointerEvents' && !INHERITED_POINTER_EVENTS.has(own[key] as string)) {
      delete inherited[key];
    } else {
      inherited[key] = own[key];
    }
  }
  return inherited;
}

/**
 * A text decoration's colour, which travels with its line rather than inheriting on its own. A
 * decoration is drawn under the text inside the element that declares it, in that element's
 * decoration colour or its text colour, and a text's own decoration colour only colours a line it
 * declares itself. `style` is the node's, and gets the colour its line is drawn in; what its
 * children inherit is returned.
 */
function decorate(
  style: Record<string, unknown>,
  inherited: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  const declared = own['textDecorationLine'] !== undefined;
  // With no line declared here or above, nothing is drawn and the colour is left as computed.
  if (!declared && !drawsLine(inherited['textDecorationLine'])) return inherited;
  const colour = declared
    ? (own['textDecorationColor'] ?? style['color'])
    : inherited['textDecorationColor'];
  if (colour === undefined) delete style['textDecorationColor'];
  else style['textDecorationColor'] = colour;
  if (!declared || inherited['textDecorationColor'] === colour) return inherited;
  const { textDecorationColor: _parent, ...rest } = inherited;
  return colour === undefined ? rest : { ...rest, textDecorationColor: colour };
}

function drawsLine(line: unknown): boolean {
  return line !== undefined && line !== 'none';
}

/** Whether an inline style sets a property children inherit. Allocates nothing: it runs per set. */
export function setsInherited(style: unknown): boolean {
  if (!style || typeof style !== 'object') return false;
  if (Array.isArray(style)) return style.some(setsInherited);
  for (const key in style) {
    if (INHERITED.has(key) && (style as Record<string, unknown>)[key] != null) return true;
  }
  return false;
}

/**
 * The inherited properties a node's inline style sets, or null for none. Inline style is the
 * strongest normal declaration on its element, so what it sets is inherited, and read by
 * `color: inherit` and `currentColor`, as a rule's would be.
 */
export function inlineInherited(style: unknown): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  // Flattened first, as native applies it, so a later entry's null clears an earlier value.
  for (const [key, value] of Object.entries(flattenInline(style, {}))) {
    if (INHERITED.has(key) && value !== undefined && value !== null) (out ??= {})[key] = value;
  }
  return out;
}

function flattenInline(style: unknown, into: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(style)) for (const entry of style) flattenInline(entry, into);
  else if (style && typeof style === 'object') Object.assign(into, style);
  return into;
}

/**
 * The runtime half of CSS for one engine: the global sheet, the conditions media queries are
 * evaluated against, and the memo that makes resolution cost nodes x rules rather than
 * nodes x rules x depth.
 *
 * One per engine rather than module state, so two surfaces in one process (or two engines in
 * one test) cannot overwrite each other's sheet or viewport.
 *
 * Inherited state is pushed **down** rather than walked up: a node takes what its parent already
 * resolved and overlays its own declarations. That is how real CSS engines do it, and it matters
 * for two separate reasons.
 *
 * Correctness first. Walking up meant matching every ancestor against the *starting node's*
 * sheet, but an ancestor almost always belongs to a different component, so a component's rules
 * reached nodes it did not own while a parent's real values never arrived. Reading `sheet` off
 * each node fixes both directions at once.
 *
 * Cost second. Walking up re-derived, for every node, everything its parent had already worked
 * out. Memoising by epoch makes it nodes x rules, and a node that sets no inheritable value hands
 * its parent's map straight on rather than copying it, so the common case allocates nothing.
 */
export class StyleResolver {
  private conditions: Conditions;
  /**
   * Bumped whenever the conditions move. Every cached result and every per-rule condition memo
   * is stamped with it, so a rotation or a theme switch invalidates the lot in one assignment
   * rather than walking the tree.
   */
  private generation = ++generations;
  private emptyCache = emptyCacheFor(-1, -1);
  /**
   * The rules a node is matched against, merged across the global sheet, the sheet of the
   * component it hosts and the sheet that created it, sorted once by weight and then filed by key
   * selector. Keyed by the creating sheet and then the hosted one, so a component's nodes share a
   * single index.
   */
  /** The global sheet and every sheet added to it, filed by key selector. See `rulesFor`. */
  private filed: RuleIndex | null = null;
  /** How many of the added sheets `filed` holds: one added since is filed at the next read. */
  private filedAdded = 0;
  /** A component's own sheet, indexed once for each place it can take: a host's, or its creator's. */
  private readonly ownIndexes = new WeakMap<StyleSheet, (RuleIndex | undefined)[]>();
  /**
   * Whether any sheet merged so far has a rule in a cascade layer. Until one does, rules are
   * ordered by weight alone and the cascade does not look for layers, which is nearly every app.
   * It stays set once a layered sheet has gone, which costs a look at each cascade and no more.
   */
  private layered = false;
  /**
   * Every layer the sheets seen so far have named, in the order each name was first seen, which
   * is the one order a document has for them. A name keeps its place when its sheet is replaced.
   */
  private readonly layerNames: LayerNames = { place: 0, nested: new Map() };
  /** Each layered rule's place among them, set when its sheet is first merged. */
  private readonly layerPlaces = new WeakMap<StyleRule, LayerPlace>();
  private readonly layeredSheets = new WeakSet<StyleSheet>();
  private unnamedLayers = 0;

  /**
   * The application-level sheet, if any: the one set of rules allowed to match a node whatever
   * component created it, which is what resets, utility classes and `:root` tokens all need.
   */
  private readonly globalSheet: StyleSheet | null;

  /**
   * Global sheets added once the engine is running, in the order they came: a
   * `ViewEncapsulation.None` component's, which a browser adds to the document unscoped when the
   * component first renders, after the application's own. See `addGlobalSheet`.
   */
  private readonly addedSheets: StyleSheet[] = [];

  /**
   * Custom properties the host supplies rather than the stylesheet: the safe-area insets, and
   * whatever else is a property of the device instead of the design.
   *
   * Seeded rather than forced. They stand in for the root's inherited tokens, so a `:root` rule
   * in the app's own sheet overrides them the way it would override anything it inherited, and an
   * app that wants to pin an inset for a tablet layout or a screenshot still can.
   */
  private tokensOnRoot: Readonly<Record<string, TokenValue>> = NO_TOKENS;

  /** What the host has supplied so far, so a second source can add to it rather than replace it. */
  get rootTokens(): Readonly<Record<string, TokenValue>> {
    return this.tokensOnRoot;
  }

  /**
   * Told of a `var()` that names a custom property nothing in scope defines and has no fallback,
   * which is dropped. Set only in development, where it is how the engine says so.
   */
  onUndefinedToken: ((name: string, props: readonly string[], on?: string) => void) | null = null;

  /**
   * Told of a `display: var()` whose token holds no display native has, `grid` or `table`, which
   * leaves display unset. Set only in development, where it is how the engine says so: the
   * compiler refuses the same value written out, but a token is only known here.
   */
  onUnreadDisplay: ((name: string, value: string | undefined) => void) | null = null;

  constructor(globalSheet: StyleSheet | null, conditions: Conditions) {
    this.globalSheet = globalSheet;
    this.conditions = conditions;
  }

  /**
   * Match `sheet` against every node from now on, as a global sheet, after the application's;
   * false when it already is. Every cached result goes, as on a theme switch: rules that were not
   * there can now match anything. `:host` in it matches nothing, since no node hosts it.
   *
   * With `replacing`, a sheet added before, it takes that one's place, and so its order: a hot
   * swap of the component's CSS edits the sheet where it is.
   */
  addGlobalSheet(sheet: StyleSheet, replacing?: StyleSheet): boolean {
    if (sheet === this.globalSheet || this.addedSheets.includes(sheet)) return false;
    const at = replacing ? this.addedSheets.indexOf(replacing) : -1;
    if (at === -1) this.addedSheets.push(sheet);
    else this.addedSheets[at] = sheet;
    // One added at the end is filed after what is there. One in another's place files them all again.
    if (at !== -1) this.filed = null;
    const before = this.generation;
    this.generation = ++generations;
    // One that takes another's place can change what any node comes to. One that names layers
    // cannot: a layer has its place from the first sheet to name it, and a new name comes last.
    if (at !== -1) this.additions.length = 0;
    else this.additions.push({ before, after: this.generation, subjects: subjectsOf(sheet) });
    return true;
  }

  /**
   * The sheets added one after another with nothing else changed between them, each with the
   * generation it began and ended: a cache made before them still stands for a node none of
   * them could match. Emptied by anything else that moves the generation on.
   */
  private readonly additions: Addition[] = [];

  /** Whether a sheet could match a node: one of its rules is written for it. */
  couldMatch(sheet: StyleSheet, node: StyleTarget): boolean {
    return writtenFor(subjectsOf(sheet), node);
  }

  /** How far each class named by the sheets met so far reaches: see `classReach`. */
  private readonly reach: ClassReach = new Map();
  /** The tests of the `class` attribute itself in those sheets, which any class may answer. */
  private readonly classTests: AttributeTest[] = [];
  private readonly noted = new WeakSet<StyleSheet>();

  /** Read the classes a sheet names, once, as soon as any node is given it. */
  noteSheet(sheet: StyleSheet | null | undefined): void {
    if (!sheet || this.noted.has(sheet)) return;
    this.noted.add(sheet);
    const { classes, reads, named } = classReach(sheet);
    for (const [name, how] of classes) this.noteReach(name, how);
    this.classTests.push(...reads);
    for (const name of named) this.named.add(name);
  }

  /** The props a selector of some sheet asks about: an id, and each attribute by its name. */
  private readonly named = new Set<string>(['nativeID']);

  /**
   * Whether a prop changing can change what any element matches: only where a selector of a
   * sheet that was ever loaded names it. A sheet loaded later has every element matched again.
   */
  reads(prop: string): boolean {
    return this.named.has(prop);
  }

  private noteReach(name: string, how: true | Subjects): void {
    const had = this.reach.get(name);
    if (had === true) return;
    if (how === true) this.reach.set(name, true);
    else addSubjects(had ?? (this.reach.set(name, noSubjects()).get(name) as Subjects), how);
  }

  /** Whether a class's reach names any element under the one that has it. */
  reachesUnder(subjects: Subjects): boolean {
    return (
      subjects.any ||
      subjects.classes.size > 0 ||
      subjects.types.size > 0 ||
      subjects.inside.size > 0
    );
  }

  /**
   * What classes coming to an element or going from it can restyle: `true` for it and all
   * under it and after it, as any change to it does; the element itself, where `own`, and the
   * elements under it to match again, by what rules are for; or null, where no rule names any
   * of them and nothing is styled again.
   */
  reachOf(classes: Iterable<string>): true | Subjects | null {
    let under: Subjects | null = null;
    let own = false;
    for (const name of classes) {
      const how = this.reach.get(name);
      if (how === true || this.classTests.some((test) => answers(test, name))) return true;
      if (!how) continue;
      own ||= how.own === true;
      // Made only for a class that reaches under: most are a rule's own, and this is asked for
      // every element as it is given its classes.
      if (this.reachesUnder(how)) addSubjects((under ??= noSubjects()), how);
    }
    if (!under) return own ? OWN_ALONE : null;
    if (own) under.own = true;
    return under;
  }

  /** Whether one of the rules `subjects` stands for could be for a node. */
  isFor(subjects: Subjects, node: StyleTarget): boolean {
    return writtenFor(subjects, node);
  }

  /**
   * Whether a cache is of this generation, or of one before sheets that could not match the
   * node were added, which leaves it as it was: it is then brought up to this one.
   */
  private current(cached: StyleCache, node: StyleTarget): boolean {
    if (cached.generation === this.generation) return true;
    // The one cache shared by every node with nothing to style is not one node's to move on.
    if (cached.context === ROOT_CONTEXT) return false;
    let at = cached.generation;
    for (const added of this.additions) {
      if (added.before !== at) continue;
      if (writtenFor(added.subjects, node)) return false;
      at = added.after;
    }
    if (at !== this.generation) return false;
    cached.generation = at;
    return true;
  }

  /** Stop matching a sheet `addGlobalSheet` added; false when it is not one. */
  removeGlobalSheet(sheet: StyleSheet): boolean {
    const at = this.addedSheets.indexOf(sheet);
    if (at === -1) return false;
    this.addedSheets.splice(at, 1);
    this.filed = null;
    this.additions.length = 0;
    this.generation = ++generations;
    return true;
  }

  setConditions(next: Conditions): void {
    this.conditions = next;
    this.additions.length = 0;
    this.generation = ++generations;
  }

  setRootTokens(next: Readonly<Record<string, TokenValue>>): void {
    this.tokensOnRoot = next;
    this.additions.length = 0;
    this.generation = ++generations;
  }

  /**
   * Resolve a node, memoised for the life of one epoch.
   *
   * `epoch` scopes the memo. The engine bumps it once per commit, so within a commit each node
   * resolves at most once however many descendants ask for its inherited values.
   */
  resolve(node: StyleTarget, epoch: number): StyleCache {
    const cached = node.styleCache;
    // Within one commit a node is asked for its inherited map once per descendant, so this is the
    // hot path and it must not walk anywhere.
    if (resolvedIn(epoch, cached, node)) return cached!;

    const parent = node.parent ? this.resolve(node.parent, epoch) : null;
    const parentContext = parent ? parent.context : ROOT_CONTEXT;

    // Across commits: nothing about this node changed and nothing above it moved, so the last
    // answer still holds. Reusing the object, rather than recomputing an equal one, is what lets
    // a descendant tell "unchanged" from "changed" by reference alone.
    if (this.reusable(cached, node, parentContext)) {
      cached.epoch = epoch;
      return cached;
    }
    const kept = this.kept(node, parentContext, epoch);
    // The rules it was just found to match, where they are not the ones it did. Taken here
    // whether or not they are used, so that none is left for the next node resolved.
    const found = this.justMatched;
    this.justMatched = null;
    if (kept) return kept;

    return this.styledAgain(node, epoch, parent, found);
  }

  /** A node styled now, from the rules found for it or from those it kept: see `matchesStand`. */
  private styledAgain(
    node: StyleTarget,
    epoch: number,
    parent: StyleCache | null,
    found: readonly StyleRule[] | null,
  ): StyleCache {
    const cached = node.styleCache;
    const parentContext = parent ? parent.context : ROOT_CONTEXT;
    const parentInherited = parent ? parent.inherited : EMPTY;
    const parentScope = parent ? parent.scope : ROOT_SCOPE;
    const stands = this.matchesStand(cached, node, parentScope);
    // The scope it keeps, or none: it then has a new one, which its new `context` serves as.
    const scope = stands ? cached!.scope : null;

    // A box the engine made around loose text is in no template, so no rule matches it.
    if (node.anonymous || this.hasNoRules(node)) {
      return this.unstyled(node, epoch, parent, parentInherited, scope, parentScope);
    }

    styleStats.nodesResolved++;

    // Its own rules are found again for a change of its own, and not for one above it.
    const rules = stands && !node.ownDirty ? cached!.rules : undefined;
    const matched = found ?? rules ?? this.matchedBy(node);
    const parentTokens = parent ? parent.tokens : this.tokensOnRoot;
    this.heir(node, parent, matched);
    const styled = this.styled(node, matched, parentTokens, parentInherited);

    const cache = this.cached(epoch, parentContext, styled, matched, scope, parentScope);
    node.styleCache = cache;
    node.styleDirty = false;
    node.ownDirty = false;
    node.hasDirty = false;
    node.stateDirty = false;
    return cache;
  }

  /**
   * Whether what an element could match is as it was when it was last styled: nothing that can
   * change it was marked on the element, its parent's `scope` is the one it was styled under,
   * and no sheet that could match it has come since. It is being styled again all the same, for
   * a change of its own that alters nothing under it, or for what it inherits.
   */
  private matchesStand(cached: StyleCache | null, node: StyleTarget, parentScope: object): boolean {
    return (
      cached !== null &&
      !node.styleDirty &&
      !node.hasDirty &&
      !node.stateDirty &&
      cached.scope !== SHARED_SCOPE &&
      parentScope !== SHARED_SCOPE &&
      cached.parentScope === parentScope &&
      this.current(cached, node)
    );
  }

  /**
   * A cache of a node just styled, with a context of its own. It keeps the rules the node
   * matched, for the node to be compared with, once a sheet has a use for them: see `tracksHas`.
   */
  private cached(
    epoch: number,
    parentContext: object,
    styled: Styled,
    matched: readonly StyleRule[],
    scope: object | null,
    parentScope: object,
  ): StyleCache {
    const context = {};
    const cache: StyleCache = {
      epoch,
      generation: this.generation,
      context,
      parentContext,
      scope: scope ?? context,
      parentScope,
      rules: matched,
      ...styled,
    };
    if (this.tracksHas) cache.matched = matched;
    return cache;
  }

  /**
   * Set by the engine once a sheet uses `:has()`, styles a pressed element or asks about a place
   * in a child list. Until then no cache keeps the rules it matched, so an app that never asks
   * pays nothing for it.
   */
  tracksHas = false;

  /**
   * The cache of a node whose subtree changed, and nothing else, when it matches the rules it
   * did: keeping the object is what leaves everything under it alone. Nothing when it has to be
   * resolved, as it does with no record of what it matched, made before any sheet asked.
   */
  private keptBeneath(node: StyleTarget, parentContext: object, epoch: number): StyleCache | null {
    const cached = node.styleCache;
    const stands =
      (node.hasDirty === true || node.stateDirty === true) &&
      cached?.matched !== undefined &&
      !node.styleDirty &&
      !node.ownDirty &&
      cached.parentContext === parentContext &&
      this.current(cached, node);
    if (!stands) return null;
    const now = this.matchedBy(node);
    const before = cached.matched!;
    if (now.length !== before.length || now.some((rule, i) => rule !== before[i])) {
      // It is styled again next, from the rules just found rather than from finding them twice.
      this.justMatched = now;
      return null;
    }
    node.hasDirty = false;
    node.stateDirty = false;
    cached.epoch = epoch;
    return cached;
  }

  /** The rules a node matches now, weakest first. */
  private matchedBy(node: StyleTarget): readonly StyleRule[] {
    const candidates = this.rulesFor(node);
    return this.matched(node, node.styled ? ELEMENT_ENTRIES.concat(candidates) : candidates);
  }

  /**
   * The rules `keptBeneath` found the node being resolved to match, where they are other than
   * it matched before: it is styled from them next, rather than matched a second time.
   */
  private justMatched: readonly StyleRule[] | null = null;

  /** A cache that still stands for a node marked for its subtree or its state alone. */
  private kept(node: StyleTarget, parentContext: object, epoch: number): StyleCache | null {
    return (
      this.keptBeneath(node, parentContext, epoch) ?? this.keptUnmatched(node, parentContext, epoch)
    );
  }

  /**
   * The cache of a node whose pressed state changed and nothing else, where no rule can match
   * it at all: it has no style of its own to change, so it and all under it stay as they are.
   */
  private keptUnmatched(
    node: StyleTarget,
    parentContext: object,
    epoch: number,
  ): StyleCache | null {
    const cached = node.styleCache;
    const stands =
      node.stateDirty === true &&
      cached !== null &&
      !node.styleDirty &&
      !node.ownDirty &&
      !node.hasDirty &&
      cached.parentContext === parentContext &&
      this.current(cached, node) &&
      (node.anonymous === true || this.hasNoRules(node));
    if (!stands) return null;
    node.stateDirty = false;
    cached.epoch = epoch;
    return cached;
  }

  /**
   * Whether a node's last answer still stands under a parent that resolved to `parentContext`,
   * without resolving it. What lets a commit step over a clean child in one comparison.
   */
  holds(node: StyleTarget, parentContext: object): boolean {
    return this.reusable(node.styleCache, node, parentContext);
  }

  /**
   * Whether a node was last styled under a box holding the one cache shared by every box with
   * nothing to style. Such boxes hand the same `context` down, so the node cannot tell one from
   * another by it: moved under another box, it has to be told.
   */
  styledUnderShared(node: StyleTarget): boolean {
    return node.styleCache !== null && node.styleCache.parentContext === ROOT_CONTEXT;
  }

  /**
   * Whether a previous result still stands: nothing about the node changed, nothing above it
   * moved, and the conditions have not.
   */
  private reusable(
    cached: StyleCache | null,
    node: StyleTarget,
    parentContext: object,
  ): cached is StyleCache {
    return (
      cached !== null &&
      !node.styleDirty &&
      !node.ownDirty &&
      !node.hasDirty &&
      !node.stateDirty &&
      cached.parentContext === parentContext &&
      this.current(cached, node)
    );
  }

  /**
   * Nothing anywhere can match this node, and it sets no custom property of its own, so its style
   * is whatever it inherits.
   */
  private hasNoRules(node: StyleTarget): boolean {
    return (
      node.sheet === null &&
      node.hostSheet === null &&
      this.globalSheet === null &&
      this.addedSheets.length === 0 &&
      !node.customProperties &&
      !node.boundStyle &&
      !node.styled
    );
  }

  /**
   * A node with no rules anywhere: it renders with what it inherits and passes the same map on.
   *
   * It still mints a context, because a rule further down may match on one of *its* classes.
   * When there is nothing to inherit either, one shared cache object serves every such node, so
   * an application that writes no CSS allocates nothing per node. Not when there are tokens to
   * carry: the shared object holds none, and the surface root answering with it dropped every
   * token the device had seeded.
   */
  private unstyled(
    node: StyleTarget,
    epoch: number,
    parent: StyleCache | null,
    parentInherited: Record<string, unknown>,
    scope: object | null,
    parentScope: object,
  ): StyleCache {
    const tokens = parent ? parent.tokens : this.tokensOnRoot;
    const parentContext = parent ? parent.context : ROOT_CONTEXT;
    // What inline style sets is inherited too, with no rule to read it against.
    const inline = node.inlineInherits ? inlineInherited(node.props['style']) : null;
    const nothing =
      !inline &&
      parentInherited === EMPTY &&
      parentContext === ROOT_CONTEXT &&
      tokens === NO_TOKENS;
    if (nothing && !node.styleDirty && !node.ownDirty) return this.sharedEmpty(node, epoch);

    const context = {};
    const passthrough: StyleCache = {
      epoch,
      generation: this.generation,
      context,
      parentContext,
      scope: scope ?? context,
      parentScope,
      style: unstyledStyle(parentInherited, inline),
      inherited: inline ? inheritFrom(parentInherited, inline) : parentInherited,
      tokens,
    };
    node.styleCache = passthrough;
    node.styleDirty = false;
    node.ownDirty = false;
    node.stateDirty = false;
    return passthrough;
  }

  /** The one cache of every node with nothing to style and nothing to hand down, given to one more. */
  private sharedEmpty(node: StyleTarget, epoch: number): StyleCache {
    if (this.emptyCache.epoch !== epoch || this.emptyCache.generation !== this.generation) {
      this.emptyCache = emptyCacheFor(epoch, this.generation);
    }
    node.styleCache = this.emptyCache;
    return this.emptyCache;
  }

  /**
   * The rules worth trying against a node, in cascade order.
   *
   * Every sheet is filed once, by key selector: the app's global sheet and each sheet added to it
   * in one index, and a component's own in one of its own. What comes back is only the buckets
   * this node can reach. A global utility sheet is hundreds of rules and a screen is a thousand
   * nodes, and the difference is between a million match attempts and a few thousand. A library
   * adds a sheet for each of its components as the component first renders, dozens on one
   * screen, so one more is added to what is filed and nothing is filed again.
   *
   * Sheets are filed in the order a document holds them, which is the order of two rules of the
   * same weight, and where a layer gets its place: the app's global sheet, the host's own, the
   * creating component's, then each added sheet as it came. The component layers get a small
   * specificity bump, so the encapsulation attribute Angular adds on the web does not have to
   * be written.
   *
   * A sheet added with `addGlobalSheet` comes last, with no bump: a browser adds a None
   * component's CSS when the component first renders, after the styles of the components around
   * it, so it loses to their extra attribute and wins a tie with them.
   */
  private rulesFor(node: StyleTarget): readonly RuleEntry[] {
    if (this.globalSheet) this.placeLayers(this.globalSheet);
    const indexes: RuleIndex[] = [];
    if (node.hostSheet) indexes.push(this.ownIndex(node.hostSheet, HOSTS));
    if (node.sheet) indexes.push(this.ownIndex(node.sheet, CREATED));
    indexes.push(this.sharedIndex());
    return candidateRules(node, indexes, this.cascadeOrder);
  }

  /** Weakest first: by layer where any sheet has one, then by weight, then as they were filed. */
  private readonly cascadeOrder = (a: IndexedEntry, b: IndexedEntry): number => {
    const layers = this.layered
      ? layerOrder(this.layerPlaces.get(a.entry.rule), this.layerPlaces.get(b.entry.rule))
      : 0;
    return layers || a.entry.weight - b.entry.weight || a.at - b.at;
  };

  /** A component's sheet as the rules of a host or of a creator, which differ only in their place. */
  private ownIndex(sheet: StyleSheet, role: typeof HOSTS | typeof CREATED): RuleIndex {
    let roles = this.ownIndexes.get(sheet);
    if (!roles) this.ownIndexes.set(sheet, (roles = []));
    return (roles[role] ??= indexRules(
      this.entries(sheet, COMPONENT_SPECIFICITY_BUMP),
      undefined,
      role * SHEET_ROOM,
    ));
  }

  /** The app's global sheet and every sheet added to it, with any added since the last read. */
  private sharedIndex(): RuleIndex {
    if (!this.filed) {
      this.filed = { buckets: new Map(), universal: [] };
      this.filedAdded = 0;
      if (this.globalSheet) indexRules(this.entries(this.globalSheet, 0), this.filed, 0);
    }
    for (; this.filedAdded < this.addedSheets.length; this.filedAdded++) {
      const from = (ADDED + this.filedAdded) * SHEET_ROOM;
      indexRules(this.entries(this.addedSheets[this.filedAdded]!, 0), this.filed, from);
    }
    return this.filed;
  }

  /** A sheet's rules at their weight here, with its layers given their places. */
  private entries(sheet: StyleSheet, bump: number): RuleEntry[] {
    this.placeLayers(sheet);
    if (sheet.rules.some((rule) => rule.layer !== undefined)) this.layered = true;
    return sheet.rules.map((rule) => ({ rule, sheet, weight: rule.specificity + bump }));
  }

  /**
   * Gives each of a sheet's layers its place among every sheet's, the first time the sheet is
   * merged, and each of its layered rules that place. Sheets are merged in the order a document
   * holds them: the app's global sheet, then each component's as it first renders.
   */
  private placeLayers(sheet: StyleSheet): void {
    if (!sheet.layers || this.layeredSheets.has(sheet)) return;
    this.layeredSheets.add(sheet);
    // A block with no name is a layer of this sheet's alone.
    const unnamed = `\0${this.unnamedLayers++}`;
    const places = sheet.layers.map((path) => {
      const place: number[] = [];
      let names = this.layerNames;
      for (const part of path) {
        const name = part.startsWith('\0') ? unnamed + part : part;
        let nested = names.nested.get(name);
        if (!nested)
          names.nested.set(name, (nested = { place: names.nested.size, nested: new Map() }));
        place.push(nested.place);
        names = nested;
      }
      return place;
    });
    for (const rule of sheet.rules) {
      if (rule.layer !== undefined) this.layerPlaces.set(rule, places[rule.layer]!);
    }
  }

  /**
   * A node's style from the rules it matched, shared with every other node that matched the same
   * rules under the same inherited values and tokens: a list's rows, and what is inside each.
   *
   * Everything past matching depends on those alone, and it is most of the work where a sheet
   * leaves values to the device: settling each `var()`, mixing colours, filling a shadow's slots.
   * A node that sets custom properties of its own is worked out alone. What is shared is never
   * written to after, so sharing it is safe; each node still has a cache and a context of its own.
   */
  private styled(
    node: StyleTarget,
    matched: readonly StyleRule[],
    parentTokens: Readonly<Record<string, TokenValue>>,
    parentInherited: Record<string, unknown>,
  ): Styled {
    // Shared between nodes that match alike, unless the node sets something of its own.
    const inline = node.inlineInherits ? inlineInherited(node.props['style']) : null;
    // Nor one that takes a value from its parent's own style, which two parents differ in.
    if (node.customProperties || inline || node.boundStyle || matched.some(takesParents)) {
      return this.style(node, matched, parentTokens, parentInherited, inline);
    }
    if (this.sharedGeneration !== this.generation) {
      this.shared.clear();
      this.sharedGeneration = this.generation;
    }
    const key = matched.map((rule) => this.ruleId(rule)).join(',');
    let byTokens = this.shared.get(key);
    if (!byTokens) this.shared.set(key, (byTokens = new WeakMap()));
    let byInherited = byTokens.get(parentTokens);
    if (!byInherited) byTokens.set(parentTokens, (byInherited = new WeakMap()));
    let styled = byInherited.get(parentInherited);
    if (!styled) {
      styled = this.style(node, matched, parentTokens, parentInherited);
      byInherited.set(parentInherited, styled);
    }
    return styled;
  }

  private readonly shared = new Map<
    string,
    WeakMap<object, WeakMap<Record<string, unknown>, Styled>>
  >();
  private sharedGeneration = 0;
  private readonly ruleIds = new WeakMap<StyleRule, number>();
  private nextRuleId = 0;

  private ruleId(rule: StyleRule): number {
    let id = this.ruleIds.get(rule);
    if (id === undefined) this.ruleIds.set(rule, (id = this.nextRuleId++));
    return id;
  }

  /** A node's style from the rules it matched, worked out. */
  private style(
    node: StyleTarget,
    matched: readonly StyleRule[],
    parentTokens: Readonly<Record<string, TokenValue>>,
    parentInherited: Record<string, unknown>,
    inline: Record<string, unknown> | null = null,
  ): Styled {
    // Inline style is the last normal declaration, under every important one.
    const bound = node.boundStyle;
    const result = this.cascade(
      inline || bound
        ? [
            ...matched,
            { declarations: inline ?? EMPTY, ...(bound && { deferred: bound }) } as StyleRule,
          ]
        : matched,
      parentInherited,
    );

    // Tokens are in scope for this node's own declarations as well as its descendants', so they
    // are merged before any `var()` here is resolved.
    const tokens = tokensInScope(
      parentTokens,
      result.tokens,
      node.customProperties,
      result.importantTokens,
    );

    const own = result.declarations;
    if (result.deferred) {
      this.applyDeferred(result.deferred, own, tokens, parentInherited, result.important);
    }
    settleBorders(own);
    // `pointer-events: inherit` won the cascade: what the parent hands down stands.
    if (own['pointerEvents'] === 'inherit') delete own['pointerEvents'];
    const style = { ...parentInherited, ...own };
    settleLineHeight(style);
    const inherited = decorate(style, inheritFrom(parentInherited, own), own);
    const rtl = (style['direction'] ?? this.conditions.direction) === 'rtl';
    const important = importantNames(result, () => TWIN[rtl ? 'rtl' : 'ltr']);
    return important ? { style, inherited, tokens, important } : { style, inherited, tokens };
  }

  /** The rules that apply to a node, weakest first. */
  private matched(node: StyleTarget, entries: readonly RuleEntry[]): StyleRule[] {
    const out: StyleRule[] = [];
    // What the node's ancestors are, gathered for the first rule that names one.
    let above: Bits | undefined;
    for (const { rule, sheet } of entries) {
      if (!this.conditionHolds(rule)) continue;
      const named = namedAbove(rule);
      if (named && lacks((above ??= bitsAbove(node)), named)) continue;
      if (matches(node, rule, sheet)) out.push(rule);
    }
    return out;
  }

  /** The declarations of the rules a node matched. The list is sorted, so later simply wins. */
  private cascade(
    matched: readonly StyleRule[],
    parentInherited: Record<string, unknown>,
  ): CascadeResult {
    const normal: Record<string, unknown> = {};
    const important: Record<string, unknown> = {};
    let hasImportant = false;
    let tokens: Record<string, TokenValue> | null = null;
    let importantTokens: Record<string, TokenValue> | null = null;
    let deferred: DeferredDeclaration[] | null = null;
    const forms = new OtherForms(() => this.directionOf(matched, parentInherited));

    for (const rule of this.layered ? byImportance(matched, this.layerPlaces) : matched) {
      deferred = forms.before(rule, normal, important, deferred);
      Object.assign(normal, rule.declarations);
      if (rule.important) {
        Object.assign(important, rule.important);
        hasImportant = true;
      }
      if (rule.tokens) Object.assign((tokens ??= {}), rule.tokens);
      // An important custom property beats every plain one, whatever the rules' order.
      if (rule.importantTokens) {
        Object.assign((importantTokens ??= {}), pick(rule.tokens!, rule.importantTokens));
      }
      deferred = forms.within(rule, normal, important, carryDeferred(deferred, rule));
    }
    if (importantTokens) Object.assign(tokens!, importantTokens);
    deferred = forms.after(normal, deferred);

    return {
      declarations: hasImportant ? { ...normal, ...important } : normal,
      important: hasImportant ? important : null,
      tokens,
      importantTokens,
      deferred,
    };
  }

  /**
   * An inline style over the style the cascade settled, both already in `style`: a corner or an
   * edge the inline style sets takes the other form of it out, as a later rule would.
   */
  overOtherForms(inline: Readonly<Record<string, unknown>>, style: Record<string, unknown>): void {
    let twin: Readonly<Record<string, string>> | null = null;
    const written = Object.keys(inline);
    for (const [at, key] of written.entries()) {
      if (!(key in TWIN.ltr)) continue;
      twin ??= TWIN[(style['direction'] ?? this.conditions.direction) === 'rtl' ? 'rtl' : 'ltr'];
      const other = twin[key]!;
      // Where the inline style sets both, the one it set later stands.
      if (written.indexOf(other) < at) delete style[other];
    }
  }

  /**
   * The direction an element is laid out in: the last `direction` its own rules give it, the one
   * it inherits, or the app's. A logical corner is a different physical one in each.
   */
  private directionOf(
    matched: readonly StyleRule[],
    parentInherited: Record<string, unknown>,
  ): 'ltr' | 'rtl' {
    let plain: unknown;
    let important: unknown;
    for (const rule of matched) {
      plain = rule.declarations['direction'] ?? plain;
      important = rule.important?.['direction'] ?? important;
    }
    const direction =
      important ?? plain ?? parentInherited['direction'] ?? this.conditions.direction;
    return direction === 'rtl' ? 'rtl' : 'ltr';
  }

  /**
   * Whether a rule's media query holds, memoised per rule.
   *
   * Conditions are the same for every node, so this is answered once per rule per change rather
   * than once per rule per node.
   */
  private conditionHolds(rule: StyleRule): boolean {
    if (rule.condition === undefined) return true;
    if (rule.activeAt !== this.generation) {
      rule.activeAt = this.generation;
      rule.active = this.evaluate(rule.condition);
    }
    return rule.active!;
  }

  private evaluate(condition: MediaCondition): boolean {
    if ('all' in condition) return condition.all.every((part) => this.evaluate(part));
    if ('any' in condition) return condition.any.some((part) => this.evaluate(part));

    if (!('op' in condition)) return this.preference(condition.feature) === condition.value;

    const { width, height } = this.conditions;
    const actual = condition.feature === 'width' ? width : height;
    const { op, value } = condition;
    if (op === 'gt') return actual > value;
    if (op === 'gte') return actual >= value;
    if (op === 'lt') return actual < value;
    if (op === 'lte') return actual <= value;
    return actual === value;
  }

  /** What the device answers for a feature that is a keyword rather than a measurement. */
  private preference(
    feature: 'orientation' | 'prefers-color-scheme' | 'prefers-reduced-motion' | 'direction',
  ) {
    const { width, height, colorScheme, reducedMotion, direction } = this.conditions;
    if (feature === 'direction') return direction ?? 'ltr';
    if (feature === 'orientation') return width > height ? 'landscape' : 'portrait';
    if (feature === 'prefers-color-scheme') return colorScheme;
    return reducedMotion ? 'reduce' : 'no-preference';
  }

  /** A length relative to the viewport, in points. */
  private viewportLength(unit: 'vw' | 'vh' | 'vmin' | 'vmax', factor: number): number {
    const { width, height } = this.conditions;
    const basis = {
      vw: width,
      vh: height,
      vmin: Math.min(width, height),
      vmax: Math.max(width, height),
    };
    return (factor * basis[unit]) / 100;
  }

  /**
   * Write the declarations that could not be settled at build time: a `var()` reference, or a
   * length relative to the viewport or to the font size in scope.
   *
   * A declaration with no token and no usable fallback is dropped rather than written as
   * undefined, which is what a browser does with a value it cannot resolve.
   */
  /**
   * What declarations that wait for a node's tokens come to on it, where no rule of the node's
   * carries them: a keyframe's, which is settled against the element that plays it.
   */
  settleFor(
    node: StyleTarget,
    deferred: readonly DeferredDeclaration[],
    epoch: number,
  ): Record<string, unknown> {
    const { tokens } = this.resolve(node, epoch);
    const above = node.parent ? this.resolve(node.parent, epoch).inherited : EMPTY;
    const own: Record<string, unknown> = {};
    this.applyDeferred(deferred, own, tokens, above, null);
    return own;
  }

  private applyDeferred(
    deferred: readonly DeferredDeclaration[],
    own: Record<string, unknown>,
    tokens: Readonly<Record<string, TokenValue>>,
    parentInherited: Record<string, unknown>,
    important: Record<string, unknown> | null,
  ): void {
    for (const declaration of settlingOrder(deferred)) {
      if (declaration.inherit) {
        this.inherit(declaration, own, parentInherited, important);
        continue;
      }
      const settled = this.settled(declaration, own, parentInherited, tokens);
      if (settled === undefined && this.onUndefinedToken) {
        this.reportUndefined(declaration, tokens);
      }
      const outranked = (prop: string) =>
        !declaration.important && important !== null && prop in important;
      // Said only of a display that is written: an important one wins over the token's.
      const unread = settled === undefined && declaration.kind === 'display';
      if (unread && this.onUnreadDisplay && !outranked('display')) {
        this.reportDisplay(declaration, tokens);
      }
      const layers = settled === undefined ? layersOf(declaration, tokens) : undefined;
      for (const prop of declaration.props) {
        if (!outranked(prop)) writeSettled(own, prop, declaration, settled, layers);
      }
    }
  }

  /** Note what the node being resolved takes an `inherit` from, and that its parent has an heir. */
  private heir(node: StyleTarget, parent: StyleCache | null, matched: readonly StyleRule[]): void {
    this.parentOf = parent;
    this.parentInline = node.parent?.props['style'];
    if (parent && matched.some(takesParents)) parent.heirs = true;
  }

  /** What the parent of the node being resolved came to: an `inherit` takes its values from it. */
  private parentOf: StyleCache | null = null;
  /** That parent's inline style, which is over what its rules gave it. */
  private parentInline: unknown;

  /** What the parent's inline style sets, under what its rules marked important, as on the parent. */
  private parentSet(): Readonly<Record<string, unknown>> {
    if (!this.parentInline) return EMPTY;
    const inline = flattenInline(this.parentInline, {});
    for (const prop of this.parentOf?.important ?? []) delete inline[prop];
    return inline;
  }

  /**
   * `inherit`: each prop as the parent has it, handed down or its own, and gone where the parent
   * has none, which is what a weaker rule's value for it gives way to.
   */
  private inherit(
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
    important: Record<string, unknown> | null,
  ): void {
    const inline = this.parentSet();
    for (const prop of declaration.props) {
      if (!declaration.important && important !== null && prop in important) continue;
      const value = inline[prop] ?? parentInherited[prop] ?? this.parentOf?.style[prop];
      if (value === undefined) delete own[prop];
      else own[prop] = value;
    }
  }

  /** One deferred declaration's value, from the tokens in scope and the node's own style. */
  private settled(
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
    tokens: Readonly<Record<string, TokenValue>>,
  ): unknown {
    if (declaration.within !== undefined) {
      return this.settledWithin(declaration.within, declaration, own, parentInherited, tokens);
    }
    if (declaration.compute) return this.computed(declaration, own, parentInherited);
    if (declaration.line) return this.settledLine(declaration, own, parentInherited, tokens);
    const value = referenced(declaration, tokens);
    if (declaration.whenSet !== undefined)
      return value === undefined ? undefined : declaration.whenSet;
    // A token defined in `em` or a viewport unit cannot be settled where it is defined: a
    // browser substitutes it and works it out where it is used, so the same here.
    const pending = (value as { __defer?: DeferredDeclaration['compute'] } | null)?.__defer;
    if (pending) return this.computed({ ...declaration, compute: pending }, own, parentInherited);
    // A token can hold a structured value with markers of its own: a shadow token whose colour
    // is another token, as Tailwind's rings are.
    return typeof value === 'object' && value !== null
      ? this.settledWithin(value, declaration, own, parentInherited, tokens)
      : value;
  }

  /** A line's longhands from its tokens, with a width in `em` worked out against the font size. */
  private settledLine(
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
    tokens: Readonly<Record<string, TokenValue>>,
  ): Record<string, unknown> | undefined {
    const line = declaration.line!;
    const values = lineValues(line, tokens);
    if (!values) return undefined;
    if (line.colour !== undefined) {
      // A colour that cannot be worked out makes the whole line invalid, as an unset token does.
      const colour = this.settledWithin(line.colour, declaration, own, parentInherited, tokens);
      if (colour === undefined) return undefined;
      for (const prop of line.colors) values[prop] = colour;
    }
    // `currentcolor` is the colour in scope, which only the node knows.
    if (values[line.colors[0]!] === 'currentcolor') {
      const colour = own['color'] ?? parentInherited['color'] ?? 'black';
      for (const prop of line.colors) values[prop] = colour;
    }
    const width = values[line.widths[0]!] as { __defer?: DeferredDeclaration['compute'] };
    if (!width?.__defer) return values;
    // No less than zero, as CSS clamps a line's width: `calc(var(--w) - 2px)` with an em token.
    const points = this.computed({ ...declaration, compute: width.__defer }, own, parentInherited);
    for (const prop of line.widths) values[prop] = Math.max(points as number, 0);
    return values;
  }

  /** A reference with nothing defined for it and nothing to fall back to. */
  private reportUndefined(
    declaration: DeferredDeclaration,
    tokens: Readonly<Record<string, TokenValue>>,
  ): void {
    const name = declaration.reference;
    if (name === undefined || name in tokens) return;
    if (declaration.fallback !== undefined || declaration.fallbackToken) return;
    if (declaration.alternatives?.some((alternative) => alternative in tokens)) return;
    this.onUndefinedToken!(name, declaration.props, declaration.on);
  }

  /** A display token set to a value native has no display for. */
  private reportDisplay(
    declaration: DeferredDeclaration,
    tokens: Readonly<Record<string, TokenValue>>,
  ): void {
    const names = [declaration.reference!, ...(declaration.alternatives ?? [])];
    const name = names.find((candidate) => tokens[candidate] !== undefined);
    if (name) this.onUnreadDisplay!(name, formOf(tokens[name], 'display') as string | undefined);
  }

  /**
   * A structured value with every deferred length and colour inside it settled, or undefined when
   * a colour in it cannot be: a shadow with no colour is not a shadow, as CSS reads it.
   */
  private settledWithin(
    value: unknown,
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
    tokens: Readonly<Record<string, TokenValue>>,
  ): unknown {
    const filled = this.filledIn(value, declaration, own, parentInherited, tokens);
    if (filled === UNSETTLED) return undefined;
    // As the compiler drops a shadow nobody can see: Tailwind composes five, four of them nothing.
    return declaration.props.includes('boxShadow') && Array.isArray(filled)
      ? filled.filter((shadow) => !invisible((shadow as { color?: unknown }).color))
      : filled;
  }

  /** A structured value with every deferred length and colour inside it settled. */
  private filledIn(
    value: unknown,
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
    tokens: Readonly<Record<string, TokenValue>>,
  ): unknown {
    if (!needsFilling(value)) return value;
    const fill = (part: unknown) => this.filledIn(part, declaration, own, parentInherited, tokens);
    if (Array.isArray(value)) return this.filledList(value, fill, tokens);
    // `currentcolor` is the colour in scope, which only the node knows: Tailwind's ring default.
    // On `color` itself that is the inherited colour, as CSS reads it.
    const current = (): string => {
      const ownColour = declaration.props.includes('color') ? undefined : own['color'];
      return (ownColour ?? parentInherited['color'] ?? 'black') as string;
    };
    const marked = settledMarker(value, tokens, current);
    if (marked === 'currentcolor') return current();
    if (marked !== NOT_A_MARKER) return marked ?? UNSETTLED;
    const pending = (value as { __defer?: DeferredDeclaration['compute'] }).__defer;
    if (pending) return this.computed({ ...declaration, compute: pending }, own, parentInherited);
    const out: Record<string, unknown> = {};
    for (const [key, part] of Object.entries(value)) {
      const filled = fill(part);
      if (filled === UNSETTLED) return UNSETTLED;
      out[key] = filled;
    }
    return out;
  }

  /**
   * A list's parts filled in, a whole shadow or filter token standing for however many entries it
   * holds: none, for an empty filter slot.
   */
  private filledList(
    value: readonly unknown[],
    fill: (part: unknown) => unknown,
    tokens: Readonly<Record<string, TokenValue>>,
  ): unknown {
    const parts: unknown[] = [];
    for (const part of value) {
      const slot = slotOf(part);
      if (!slot) {
        const filled = fill(part);
        if (filled === UNSETTLED) return UNSETTLED;
        parts.push(filled);
        continue;
      }
      const filled = fill(
        substitute(slot.marker, tokens, (token) => slotEntries(token, slot.kind)),
      );
      if (filled === UNSETTLED || !Array.isArray(filled)) return UNSETTLED;
      parts.push(...filled);
    }
    return parts;
  }

  /** A length relative to the viewport or to the font size in scope. */
  private computed(
    declaration: DeferredDeclaration,
    own: Record<string, unknown>,
    parentInherited: Record<string, unknown>,
  ): unknown {
    const { unit, factor, offset = 0, multiple } = declaration.compute!;
    if (unit !== 'em') return this.viewportLength(unit, factor) + offset;
    if (multiple && !offset) return { multiple: factor } satisfies LineHeightMultiple;
    // The font size in scope. On `font-size` itself that is the inherited size rather than the
    // one being computed, which is what makes a nested `1.5em` compound as on the web.
    const base = declaration.props.includes('fontSize')
      ? parentInherited['fontSize']
      : (own['fontSize'] ?? parentInherited['fontSize']);
    // To a thousandth of a point: a factor rounded at build time, times a font size, is otherwise
    // 19.99998 where the web draws 20.
    const points = factor * (typeof base === 'number' ? base : DEFAULT_FONT_SIZE) + offset;
    return Math.round(points * 1000) / 1000;
  }
}

/**
 * The order a node's deferred declarations are settled in.
 *
 * Plain ones first and important ones after, so an important one wins whatever order they matched
 * in; and a plain one never writes over an important declaration. The font size before everything
 * else, because an em anywhere on the node is measured against it, whichever rule it came from:
 * '.x { padding: 1em } .y { font-size: 2em }'. Then the colour, because a `currentcolor` anywhere
 * on the node is the node's own colour: a ring's default, beside a `color: var(--c)`.
 */
function settlingOrder(deferred: readonly DeferredDeclaration[]): readonly DeferredDeclaration[] {
  const byImportance = deferred.some((one) => one.important)
    ? [...deferred.filter((one) => !one.important), ...deferred.filter((one) => one.important)]
    : deferred;
  const rank = (one: DeferredDeclaration) =>
    one.props.includes('fontSize') ? 0 : one.props.includes('color') ? 1 : 2;
  return byImportance.some((one) => rank(one) < 2)
    ? [0, 1, 2].flatMap((wanted) => byImportance.filter((one) => rank(one) === wanted))
    : byImportance;
}

/**
 * The aliases, hsl() colours and channel colours among a node's own definitions, resolved against everything in
 * scope on it. Done once, where they are defined, so a descendant only ever sees values. A name
 * that resolves to nothing - undefined, part of a cycle, or an hsl() missing a channel - is
 * dropped, as a browser treats it as unset.
 *
 * Aliases first: an hsl() channel that names a plain token reads it whichever order these run in,
 * but an alias that names an hsl() token needs the hsl() already turned into a colour.
 */
/**
 * The tokens in scope at a node: its parent's, overlaid with what its rules define, overlaid with
 * what it sets itself, which wins as inline style does.
 */
function tokensInScope(
  parentTokens: Readonly<Record<string, TokenValue>>,
  ruleTokens: Readonly<Record<string, TokenValue>> | null,
  custom: Readonly<Record<string, TokenValue>> | null | undefined,
  important: Readonly<Record<string, TokenValue>> | null = null,
): Readonly<Record<string, TokenValue>> {
  // What the element sets is over its rules' definitions, but for the ones marked important.
  const own = custom ? { ...ruleTokens, ...custom, ...important } : ruleTokens;
  if (!own || changesNothing(own, parentTokens)) return parentTokens;
  return resolveAliases(own, { ...parentTokens, ...own }, parentTokens);
}

/**
 * Whether a node's own definitions leave every token as its parent has it: each is the value the
 * parent has already, from the same rule, or a CSS-wide keyword that comes to what is in scope.
 * Tailwind writes `--tw-translate-x: 0`, `--tw-blur: initial` and forty more like them on every
 * element, so on nearly every node this is all there is, and the parent's map is handed on as it
 * is where a copy of it, a few hundred tokens, would be made.
 */
function changesNothing(
  own: Readonly<Record<string, TokenValue>>,
  parentTokens: Readonly<Record<string, TokenValue>>,
): boolean {
  for (const name in own) {
    const value = own[name]!;
    // The very value its parent has: the one rule gave it to both, as `*` gives every element.
    if (parentTokens[name] === value) continue;
    const word = value.keyword;
    if (word === undefined || !CSS_WIDE.has(word)) return false;
    // `inherit` and `unset` are the parent's value whatever it is; the rest are no value at all.
    if (word !== 'inherit' && word !== 'unset' && parentTokens[name] !== undefined) return false;
  }
  return true;
}

function resolveAliases(
  own: Readonly<Record<string, TokenValue>>,
  merged: Record<string, TokenValue>,
  parentTokens: Readonly<Record<string, TokenValue>>,
): Record<string, TokenValue> {
  const names = Object.keys(own);
  for (const name of names) {
    const word = own[name]!.keyword;
    if (word !== undefined && CSS_WIDE.has(word)) cssWide(merged, name, word, parentTokens);
  }
  const aliases = names.filter((name) => own[name]!.alias);
  followAliases(aliases, merged);
  // Left to work out: each token made of others and each alias that came to one, by a link or a
  // fallback, `var(--missing, calc(var(--gap) * 2))`, which is worked out here as well.
  const pending = new Set(names.filter((name) => isDerived(merged[name])));
  if (pending.size) settleDerived(own, merged, pending);
  return merged;
}

const CSS_WIDE: ReadonlySet<string> = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
]);

/**
 * A token set to a CSS-wide keyword, as CSS has one: its parent's value for `inherit` and `unset`,
 * since a custom property inherits, and otherwise its initial value, which is to be unset. Tailwind
 * writes `--tw-blur: initial` for each filter slot a node has not filled.
 */
function cssWide(
  merged: Record<string, TokenValue>,
  name: string,
  word: string,
  parentTokens: Readonly<Record<string, TokenValue>>,
): void {
  const inherited = word === 'inherit' || word === 'unset' ? parentTokens[name] : undefined;
  if (inherited) merged[name] = inherited;
  else delete merged[name];
}

/** What a token not yet worked out reads as while another is: set, with no form of any kind. */
const PENDING: TokenValue = Object.freeze({});

/**
 * The tokens left to work out, each settled once none it reads is still to be, whatever order they
 * are defined in. One that reads another still to be waits, rather than taking a fallback: a
 * fallback is for a token that is unset or invalid. When every one left waits for another, those
 * in a cycle, counting only the references read, are invalid, and the rest go on without them,
 * taking their fallbacks, as CSS has it.
 */
function settleDerived(
  own: Readonly<Record<string, TokenValue>>,
  merged: Record<string, TokenValue>,
  pending: Set<string>,
): void {
  const waitingOn = new Map<string, ReadonlySet<string>>();
  let read = new Set<string>();
  const view = new Proxy(merged, {
    get: (tokens, name: string) => {
      if (!pending.has(name)) return tokens[name];
      read.add(name);
      return PENDING;
    },
  });
  while (pending.size) {
    let settled = false;
    for (const name of pending) {
      read = new Set();
      const token = own[name]!;
      const value = token.alias ? substitutedIn(token, view) : workedOut(token, view);
      if (read.size) {
        waitingOn.set(name, read);
        continue;
      }
      pending.delete(name);
      settle(merged, name, value);
      settled = true;
    }
    if (settled) continue;
    for (const name of inCycles(pending, waitingOn)) {
      pending.delete(name);
      delete merged[name];
    }
  }
}

/** An alias's target, or the first of its fallbacks that is set, with one made of others worked out. */
function substitutedIn(
  token: TokenValue,
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  let link: TokenValue | undefined = token;
  while (link?.alias) {
    const target = tokens[link.alias];
    if (target !== undefined) return target;
    link = link.fallback;
  }
  return link && isDerived(link) ? workedOut(link, tokens) : link;
}

/**
 * A token that is set but makes no valid value. A use site finds it set, so takes no fallback, and
 * in no form, so its property is unset, as CSS substitutes such a token and then unsets it.
 */
const INVALID: TokenValue = Object.freeze({});

/**
 * A token made of others, worked out: invalid when it makes nothing valid, as `hsl()` of a
 * percentage hue does, and unset only when a `var()` in it has nothing to be substituted with.
 */
function workedOut(
  token: TokenValue,
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  return derived(token, tokens) ?? (substitutable(token, tokens) ? INVALID : undefined);
}

/** Whether each `var()` in a token made of others names a token that is set, or has a fallback. */
function substitutable(token: TokenValue, tokens: Readonly<Record<string, TokenValue>>): boolean {
  if (token.hsl) return hslSubstitutable(token.hsl, tokens);
  if (token.deferredColour) return colourSubstitutable(token.deferredColour, tokens);
  if (token.deferredLengths) {
    return token.deferredLengths.every(
      (part) => typeof part !== 'object' || substitutedIn(part, tokens) !== undefined,
    );
  }
  // Each marker is one reading of the same text, and a fallback one cannot read is dropped from it.
  return token.deferredCalc!.some((marker) => calcSubstitutable(marker.expression, tokens));
}

function hslSubstitutable(
  hsl: NonNullable<TokenValue['hsl']>,
  tokens: Readonly<Record<string, TokenValue>>,
): boolean {
  return [hsl.h, hsl.s, hsl.l, hsl.alpha].every(
    (channel) =>
      typeof channel !== 'object' ||
      tokens[channel.reference] !== undefined ||
      channel.fallback !== undefined,
  );
}

function calcSubstitutable(
  expression: CalcExpression,
  tokens: Readonly<Record<string, TokenValue>>,
): boolean {
  if (Array.isArray(expression)) {
    return expression.slice(1).every((side) => calcSubstitutable(side, tokens));
  }
  if (typeof expression !== 'object' || 'percentage' in expression) return true;
  const leaf = expression as Extract<CalcLeaf, { reference: string }>;
  if (tokens[leaf.reference] !== undefined) return true;
  return leaf.fallback !== undefined && calcSubstitutable(leaf.fallback, tokens);
}

function colourSubstitutable(
  expression: ColourExpression,
  tokens: Readonly<Record<string, TokenValue>>,
): boolean {
  if ('color' in expression) return true;
  if ('hsl' in expression) return hslSubstitutable(expression.hsl, tokens);
  if ('relative' in expression) return colourSubstitutable(expression.relative.from, tokens);
  if ('mix' in expression) {
    const { a, b } = expression.mix;
    return colourSubstitutable(a, tokens) && colourSubstitutable(b, tokens);
  }
  if ('channels' in expression) {
    const { channels, alpha } = expression;
    const set = (one: { reference: string; fallback?: unknown }) =>
      tokens[one.reference] !== undefined || one.fallback !== undefined;
    return set(channels) && (typeof alpha !== 'object' || set(alpha));
  }
  return referenceSubstitutable(expression, tokens);
}

/** A colour's `var()`: a token or alternative that is set, or a fallback that can be worked out. */
function referenceSubstitutable(
  expression: Extract<ColourExpression, { reference: string }>,
  tokens: Readonly<Record<string, TokenValue>>,
): boolean {
  const names = [expression.reference, ...(expression.alternatives ?? [])];
  if (names.some((name) => tokens[name] !== undefined)) return true;
  if (expression.fallback !== undefined) return true;
  const token = expression.fallbackToken;
  return token !== undefined && (!isDerived(token) || substitutable(token, tokens));
}

/**
 * A reference read from its token when that is set, in whatever form `read` finds, and its
 * fallback only when it is not.
 */
function substitute(
  marker: { readonly reference: string; readonly fallback?: unknown },
  tokens: Readonly<Record<string, TokenValue>>,
  read: (token: TokenValue) => unknown,
): unknown {
  const token = tokens[marker.reference];
  return token === undefined ? marker.fallback : read(token);
}

/** The first of the names that is set: the one a `var()` and its `var()` fallbacks substitute. */
function firstSet(
  names: readonly string[],
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  for (const name of names) if (tokens[name] !== undefined) return tokens[name];
  return undefined;
}

/** The names among `names` that reach themselves by what each waits on. */
function inCycles(
  names: ReadonlySet<string>,
  waitingOn: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const reaches = (from: string, to: string, seen: Set<string>): boolean => {
    for (const next of waitingOn.get(from) ?? []) {
      if (next === to) return true;
      if (names.has(next) && !seen.has(next) && seen.add(next) && reaches(next, to, seen)) {
        return true;
      }
    }
    return false;
  };
  return [...names].filter((name) => reaches(name, name, new Set()));
}

/** Whether a token is made of others, and so worked out where it is defined. */
function isDerived(token: TokenValue | undefined): boolean {
  return Boolean(
    token?.hsl || token?.deferredColour || token?.deferredCalc || token?.deferredLengths,
  );
}

/** A token made of others, worked out from the tokens in scope. */
function derived(
  token: TokenValue,
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  if (token.hsl) return colourToken(resolveHsl(token.hsl, tokens));
  if (token.deferredColour) return colourToken(resolveColour(token.deferredColour, tokens));
  if (token.deferredLengths) return lengthsToken(token, tokens);
  return calcToken(token.deferredCalc!, tokens);
}

/**
 * A token of several lengths with each part that is a `var()` followed. Where a part comes to
 * no length the token is what else it reads as, a shadow whose colour is a token being several
 * lengths and a `var()` too, or nothing where it reads as nothing else.
 */
function lengthsToken(
  token: TokenValue,
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  const { deferredLengths, ...rest } = token;
  const lengths = deferredLengths!.map((part) =>
    typeof part === 'object' ? substitutedIn(part, tokens)?.length : part,
  );
  if (lengths.every((length) => length !== undefined)) {
    return { ...rest, lengths: lengths as (number | string)[] };
  }
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * Each alias settled to what it names. `follow` writes back every one that resolves; one in a
 * cycle is removed only once all are followed, as removed any sooner, the next one round the
 * cycle would find it unset and take its own fallback.
 */
function followAliases(aliases: readonly string[], merged: Record<string, TokenValue>): void {
  const cyclic = aliases.filter((name) => typeof follow(name, merged, []) === 'number');
  for (const name of cyclic) delete merged[name];
}

/** A token set to what it resolved to, or removed when it resolved to nothing, as CSS unsets it. */
function settle(
  merged: Record<string, TokenValue>,
  name: string,
  value: TokenValue | undefined,
): void {
  if (value) merged[name] = value;
  else delete merged[name];
}

const colourToken = (color: string | undefined): TokenValue | undefined =>
  color === undefined ? undefined : { color };

/** A `calc()` token's forms, from the tokens in scope: undefined when it makes neither. */
function calcToken(
  markers: readonly CalcMarker[],
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | undefined {
  let token: TokenValue | undefined;
  for (const marker of markers) {
    const value = resolveCalc(marker, tokens);
    if (value === undefined) continue;
    if (marker.kind === 'length') token = { ...token, length: value };
    else if (typeof value === 'number') token = { ...token, number: value };
    // Arithmetic of a percentage, `calc(var(--half) * 2)`, is a percentage, as a token written
    // `100%` is, so an hsl() does not read it as a bare number of percent.
    const percentage = marker.kind === 'number' && calcType(marker.expression, tokens) === '%';
    if (percentage && typeof value === 'number' && token?.length === undefined) {
      token = { ...token, length: `${Math.round(value * 100000) / 1000}%` };
    }
  }
  return token;
}

/**
 * What a calc() of numbers and percentage tokens makes, as CSS types it: a number, `''`, a
 * percentage, `'%'`, or neither, as a percentage added to a number is, or one percentage
 * multiplied by another.
 */
function calcType(
  expression: CalcExpression,
  tokens: Readonly<Record<string, TokenValue>>,
): '' | '%' | undefined {
  if (typeof expression === 'number') return '';
  if (!Array.isArray(expression)) return leafType(expression as CalcLeaf, tokens);
  const [op, a, b] = expression as readonly [string, CalcExpression, CalcExpression];
  const left = calcType(a, tokens);
  const right = calcType(b, tokens);
  if (left === undefined || right === undefined) return undefined;
  if (op === '*') return left && right ? undefined : left || right;
  if (op === '/') return right ? undefined : left;
  return left === right ? left : undefined;
}

/** What one token in a calc() is, as `calcType` reads it: its fallback's type when it is unset. */
function leafType(
  leaf: CalcLeaf,
  tokens: Readonly<Record<string, TokenValue>>,
): '' | '%' | undefined {
  if ('percentage' in leaf) return '%';
  const token = tokens[leaf.reference];
  if (!token) return leaf.fallback === undefined ? undefined : calcType(leaf.fallback, tokens);
  return typeof token.length === 'string' && token.length.endsWith('%') ? '%' : '';
}

/** An `hsl()` token's channels, read from the tokens in scope, as the colour they make. */
function resolveHsl(
  hsl: NonNullable<TokenValue['hsl']>,
  tokens: Readonly<Record<string, TokenValue>>,
): string | undefined {
  const h = hslChannel(hsl.h, tokens, 'hue');
  const s = hslChannel(hsl.s, tokens, hsl.legacy ? 'legacy' : 'percentage');
  const l = hslChannel(hsl.l, tokens, hsl.legacy ? 'legacy' : 'percentage');
  const alpha = hsl.alpha === undefined ? 1 : hslChannel(hsl.alpha, tokens, 'alpha');
  if (h === undefined || s === undefined || l === undefined || alpha === undefined) {
    return undefined;
  }
  return hslToRgb(h, s, l, alpha);
}

/**
 * A channel's number, or undefined when its token is the wrong kind for the slot, as the token's
 * text substituted into the hsl() would read: a hue is a number or an angle, read in degrees, as
 * `0.5turn` is 180 and not 0.5, and never a percentage; a saturation or a lightness is a
 * percentage, or a bare number of percent, `--s: 100`, though not in the legacy comma syntax; an
 * alpha is a number or a percentage. The fallback is only for a token that is not set, as a set
 * one is substituted, whatever it holds.
 */
function hslChannel(
  channel: HslChannel,
  tokens: Readonly<Record<string, TokenValue>>,
  slot: 'hue' | 'percentage' | 'legacy' | 'alpha',
): number | undefined {
  if (typeof channel === 'number') return channel;
  const token = tokens[channel.reference];
  if (!token) return channel.fallback;
  const percentage = typeof token.length === 'string' && token.length.endsWith('%');
  if (slot === 'hue') return percentage ? undefined : (token.angle ?? token.number);
  if (token.angle !== undefined || token.number === undefined) return undefined;
  if (percentage || slot === 'alpha') return token.number;
  return slot === 'legacy' ? undefined : token.number / 100;
}

/**
 * `hsl(h, s, l)` converted to sRGB, printed the same way `fromChannels` prints an rgba() built
 * from tokens: a use site never has to know which of the two ever built a colour.
 *
 * `h` is degrees; `s` and `l` are fractions, which is what a percentage token already reads as
 * (see `formOf`), so nothing here rescales them.
 */
function hslToRgb(h: number, saturation: number, l: number, opacity: number): string {
  // Out of range as CSS Color 4 takes it: a saturation below 0 is 0, an alpha is clamped, and
  // anything else is converted as it is, each channel it makes then clamped into sRGB.
  const s = Math.max(0, saturation);
  const alpha = Math.min(1, Math.max(0, opacity));
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r1, g1, b1] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const [r, g, b] = [r1, g1, b1].map((c) => Math.round(Math.min(1, Math.max(0, c + m)) * 255));
  return alpha >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

/**
 * A token with its `var()` substituted, through as many aliases and fallbacks as it takes.
 *
 * `path` is the aliases being followed on the way here. A number is a cycle, and the index in
 * `path` where it starts: every property from there on is in it and invalid at computed-value
 * time, so none of them takes its fallback, while one before it names an invalid property and
 * does. Anything else is final wherever the chain started, so it is written back to `tokens`, and
 * no alias is followed twice.
 */
function follow(
  name: string,
  tokens: Record<string, TokenValue>,
  path: string[],
): TokenValue | undefined | number {
  const value = tokens[name];
  if (!value?.alias) return value;
  const start = path.indexOf(name);
  if (start >= 0) return start;
  const depth = path.push(name) - 1;
  const result = substituted(value, tokens, path, depth);
  path.pop();
  if (typeof result !== 'number') settle(tokens, name, result);
  return result;
}

/** An alias's target, or its fallback, which may be another `var()`, when the target is unset. */
function substituted(
  value: TokenValue,
  tokens: Record<string, TokenValue>,
  path: string[],
  depth: number,
): TokenValue | undefined | number {
  const target = follow(value.alias!, tokens, path);
  if (typeof target === 'object' || (typeof target === 'number' && target <= depth)) return target;
  const { fallback } = value;
  return fallback?.alias ? substituted(fallback, tokens, path, depth) : fallback;
}

/** What a `var()` resolves to: a gradient's stops, or one value with its arithmetic applied. */
function referenced(
  declaration: DeferredDeclaration,
  tokens: Readonly<Record<string, TokenValue>>,
): unknown {
  if (declaration.gradient) return paintLayers(declaration.gradient, tokens);
  // The first token set is substituted, whatever it holds: one of the wrong kind leaves the
  // property unset rather than trying the next, or the fallback.
  const names = [declaration.reference!, ...(declaration.alternatives ?? [])];
  const token = firstSet(names, tokens);
  let value = token ? formFor(token, declaration) : fallbackOf(declaration, tokens);
  // `calc(var(--n) * 1px)`: the arithmetic gives a unitless token its unit, which is the usual
  // way to turn a count into a length. So it reads the bare number, and a length is no such thing.
  if (token && declaration.adjust?.number && declaration.kind === 'length') {
    value = token.number;
  }
  if (declaration.kind === 'display') return displayOf(value);
  const base = CHANNEL_KINDS.has(declaration.kind!)
    ? fromChannels(value, declaration.alpha, tokens, declaration.space)
    : value;
  return declaration.adjust ? adjusted(base, declaration.adjust) : base;
}

/**
 * What native displays for a keyword: flex, none or contents. A block, inline, inline-block,
 * flow-root or inline-flex box is flex, as the compiler reads one written out, and so is `flow`,
 * which is a block. Anything else, a grid or a table, is no display native has, so the property
 * is unset.
 */
const DISPLAYS: ReadonlyMap<string, string> = new Map([
  ...['flex', 'block', 'inline', 'inline-block', 'flow-root', 'inline-flex', 'flow'].map(
    (word) => [word, 'flex'] as const,
  ),
  ['none', 'none'],
  ['contents', 'contents'],
]);

/**
 * The two-keyword form, an outer display and an inner one in either order: `inline flex` is
 * `inline-flex` and `block flow` is `block`, as Chrome computes them, so each is flex here.
 */
const OUTER = new Set(['block', 'inline']);
const INNER = new Set(['flow', 'flow-root', 'flex']);

function displayOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const words = value.toLowerCase().split(CSS_SPACE);
  if (words.length === 1) return DISPLAYS.get(words[0]!);
  const [first, second] = words as [string, string];
  const pair = (OUTER.has(first) && INNER.has(second)) || (INNER.has(first) && OUTER.has(second));
  return words.length === 2 && pair ? 'flex' : undefined;
}

/**
 * A set token's value in the form wanted. A token of `currentColor` is the colour in scope where
 * it is used, not where it is set, so it is the marker the node fills in.
 */
function tokenForm(token: TokenValue, kind: TokenKind): unknown {
  const value = formOf(token, kind);
  return value === undefined && kind === 'color' && isCurrentColour(token) ? CURRENT_COLOUR : value;
}

/** A corner's place among four as CSS writes them, before a side's: `borderTopLeftRadius`. */
const PLACES: readonly (readonly [RegExp, number])[] = [
  [/TopLeft|TopStart|StartStart/, 0],
  [/TopRight|TopEnd|StartEnd/, 1],
  [/BottomRight|BottomEnd|EndEnd/, 2],
  [/BottomLeft|BottomStart|EndStart/, 3],
  [/Top/, 0],
  [/Right|End/, 1],
  [/Bottom/, 2],
  [/Left|Start/, 3],
];

/** Where a side or a corner comes in a shorthand of four, whatever order its props are kept in. */
const placeOf = (prop: string): number => PLACES.find(([named]) => named.test(prop))?.[1] ?? 0;

/** The lengths of a token that holds several, for the props of a shorthand to take one each. */
class EachSide {
  readonly lengths: readonly (number | string)[];
  constructor(lengths: readonly (number | string)[]) {
    this.lengths = lengths;
  }

  /**
   * The length for one of a shorthand's four props, as CSS gives them: two are a pair repeated,
   * and of three the left takes the right's. Nothing for a property that is not such a
   * shorthand: a token of several lengths is no value for it, and it is unset.
   */
  at(props: readonly string[], prop: string): number | string | undefined {
    if (props.length !== 4) return undefined;
    const index = placeOf(prop);
    return this.lengths[index] ?? this.lengths[index - 2] ?? this.lengths[0];
  }
}

/**
 * A set token's value in the form a declaration wants, or its several lengths where it wants a
 * length and the token has no one: for a shorthand that takes one a side, see `writeSettled`.
 * Not with arithmetic on it, which is of one length.
 */
function formFor(token: TokenValue, declaration: DeferredDeclaration): unknown {
  const value = tokenForm(token, declaration.kind!);
  if (value !== undefined || !token.lengths || declaration.kind !== 'length') return value;
  return declaration.adjust ? undefined : new EachSide(token.lengths);
}

/** What a deferred declaration settled to, written to one of its props. */
function writeSettled(
  own: Record<string, unknown>,
  prop: string,
  declaration: DeferredDeclaration,
  settled: unknown,
  layers: BackgroundLayers | undefined,
): void {
  const one = settled instanceof EachSide ? settled.at(declaration.props, prop) : settled;
  const value = one ?? declaration.unset;
  if (declaration.layers) writeLayer(own, prop, value, layers);
  else write(own, prop, value, declaration.line !== undefined);
}

/**
 * One prop of a `background: var()`, whose token may hold the images as well as the colour. The
 * image is written only where the token holds one: a token that is a colour leaves an image
 * another rule declared as it is. Each prop is ranked in the cascade by itself, so an image a
 * later rule declares, or an important one, is not written over by the token's.
 */
function writeLayer(
  own: Record<string, unknown>,
  prop: string,
  value: unknown,
  layers: BackgroundLayers | undefined,
): void {
  if (prop !== BACKGROUND_IMAGE) write(own, prop, layers?.color ?? value, false);
  else if (layers) own[prop] = layers.images;
}

const BACKGROUND_IMAGE = 'experimental_backgroundImage';

/**
 * The gradients a `background: var()` reads where its token is no colour: see `backgroundLayers`.
 * Only the shorthand, which the compiler marks: `background-color: var()` is a colour or nothing.
 * And only where the token is set as text on an element, which is where a library sets one as the
 * app runs; a stylesheet's is refused where it is written. The token is the one the declaration
 * settles on, the first that is set.
 */
function layersOf(
  declaration: DeferredDeclaration,
  tokens: Readonly<Record<string, TokenValue>>,
): BackgroundLayers | undefined {
  if (!declaration.layers) return undefined;
  const names = [declaration.reference!, ...(declaration.alternatives ?? [])];
  const text = firstSet(names, tokens)?.keyword;
  return text && /gradient\(/i.test(text) ? backgroundLayers(text) : undefined;
}

const BOUND_NUMBERS = new Set([
  'opacity',
  'flex',
  'flexGrow',
  'flexShrink',
  'zIndex',
  'aspectRatio',
  'elevation',
]);
const BOUND_LENGTH =
  /^(?:(?:min|max)?(?:width|height)|top|right|bottom|left|start|end|gap|fontSize|letterSpacing)$|(?:margin|padding|inset|Width|Radius|Gap|Basis)/i;

/** The properties whose token is read in a form of its own. */
const BOUND_KINDS: Readonly<Record<string, TokenKind>> = {
  display: 'display',
  transform: 'transform',
  boxShadow: 'shadow',
  filter: 'filter',
};

/** What a token is read as for a bound declaration of `prop`, as the compiler says for a rule. */
function boundKind(prop: string): TokenKind {
  // `fill` and `stroke` are a shape's paint, which is a colour.
  if (/color$/i.test(prop) || prop === 'fill' || prop === 'stroke') return 'color';
  if (prop === 'fontWeight') return 'weight';
  if (prop === 'fontFamily') return 'family';
  if (prop === 'lineHeight') return 'lineHeight';
  if (prop in BOUND_KINDS) return BOUND_KINDS[prop]!;
  if (BOUND_NUMBERS.has(prop)) return 'number';
  return BOUND_LENGTH.test(prop) ? 'length' : 'keyword';
}

/**
 * A bound declaration whose value is one `var()`, `var(--brand, red)`, as the deferred declaration
 * the compiler writes for the same value in a rule. `token` is the value as a token, which is an
 * alias when it is a `var()`; null for any other.
 *
 * ponytail: the whole value has to be the `var()`. One inside a longer value, `calc()` included,
 * is what the compiler parses at build time and nothing here does; write the sum in a custom
 * property, `[style.--gap]`, and read that in the stylesheet.
 */
export function boundDeclaration(
  prop: string,
  token: TokenValue | undefined,
  on?: string,
): DeferredDeclaration | null {
  if (!token?.alias) return null;
  const kind = boundKind(prop);
  const [reference, ...alternatives] = aliasesOf(token);
  for (; token?.alias; token = token.fallback);
  // `tokenForm`, so a fallback of `currentColor` is the colour of the element, as in a rule.
  const fallback = token && !isDerived(token) ? tokenForm(token, kind) : undefined;
  return {
    props: [prop],
    ...(on === undefined ? {} : { on }),
    kind,
    reference: reference!,
    ...(alternatives.length ? { alternatives } : {}),
    ...(fallback !== undefined ? { fallback } : {}),
    ...(token && isDerived(token) ? { fallbackToken: token } : {}),
  };
}

/** The names a `var()` tries in turn: its own, then each `var()` nested as its fallback. */
function aliasesOf(token: TokenValue | undefined): string[] {
  const names: string[] = [];
  for (; token?.alias; token = token.fallback) names.push(token.alias);
  return names;
}

/** The fallback written, or one made of other tokens, worked out from the tokens where it is used. */
function fallbackOf(
  declaration: DeferredDeclaration,
  tokens: Readonly<Record<string, TokenValue>>,
): unknown {
  const token = declaration.fallbackToken;
  return declaration.fallback ?? (token && formOf(derived(token, tokens), declaration.kind!));
}

/**
 * One longhand of a deferred declaration written to the node's own style. Unset when the value is
 * nothing, as CSS has a declaration invalid once its tokens are known: it still wins the cascade,
 * so what a weaker rule set goes, and the property inherits or starts over. A line's value is one
 * per longhand, and leaves the ones it was written with alone.
 */
function write(own: Record<string, unknown>, prop: string, value: unknown, perProp: boolean): void {
  if (value === undefined) delete own[prop];
  else if (!perProp) own[prop] = value;
  else if (prop in (value as Record<string, unknown>)) {
    own[prop] = (value as Record<string, unknown>)[prop];
  }
}

/** The styles a line's token can be, as the compiler reads a written one. */
const LINE_STYLES: ReadonlySet<string> = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'none',
  'hidden',
]);
const LINE_WIDTHS: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5 };

/** What a line's token substitutes to: a token, or nothing at all, `var(--x,)` or `--x: ;`. */
const NOTHING = Symbol('nothing');

/**
 * A line's longhands, each token given the one role its form says and the written parts did not
 * take. Undefined when a token is unset with nothing to fall back to, fits no role left, or would
 * take a role twice: CSS makes the whole shorthand invalid then.
 */
function lineValues(
  line: LineTemplate,
  tokens: Readonly<Record<string, TokenValue>>,
): Record<string, unknown> | undefined {
  const open = new Set(line.roles);
  const values: Record<string, unknown> = {};
  for (const reference of line.references) {
    const token = lineToken(reference, tokens);
    if (token === undefined) return undefined;
    if (token === NOTHING) continue;
    const found = reference.adjust
      ? computedWidth(token, open, reference.adjust)
      : lineRole(token, open);
    if (!found) return undefined;
    open.delete(found.role);
    fillRole(line, values, found.role, found.value);
  }
  // A part no token filled takes its initial value, as one left out of a written line does.
  for (const role of open) fillRole(line, values, role, LINE_INITIAL[role]);
  return values;
}

/** A token of `currentColor`, in any case. */
const isCurrentColour = (token: TokenValue | undefined): boolean =>
  token?.keyword?.toLowerCase() === 'currentcolor';

/** The marker the compiler writes for `currentColor`, which the node fills in. */
const CURRENT_COLOUR = { __colour: { color: 'currentcolor' } };

/** What a line's width, style and colour are when it leaves them out. */
const LINE_INITIAL = {
  width: LINE_WIDTHS['medium'],
  style: 'none',
  color: 'currentcolor',
} as const;

function fillRole(
  line: LineTemplate,
  values: Record<string, unknown>,
  role: LineTemplate['roles'][number],
  value: unknown,
): void {
  const styles = [line.style!, ...(line.marks ?? [])];
  const props = { width: line.widths, color: line.colors, style: styles }[role];
  for (const prop of props) values[prop] = value;
}

function lineToken(
  reference: LineTemplate['references'][number],
  tokens: Readonly<Record<string, TokenValue>>,
): TokenValue | typeof NOTHING | undefined {
  const set = firstSet([reference.reference, ...(reference.alternatives ?? [])], tokens);
  if (set) return set.keyword?.trim() === '' ? NOTHING : set;
  if (reference.empty) return NOTHING;
  const { fallback } = reference;
  return fallback && isDerived(fallback) ? derived(fallback, tokens) : fallback;
}

/** The role a token's form says it has, among those still open. */
function lineRole(
  token: TokenValue,
  open: ReadonlySet<LineTemplate['roles'][number]>,
): { role: LineTemplate['roles'][number]; value: unknown } | undefined {
  const word = token.keyword;
  const width = word && word in LINE_WIDTHS ? LINE_WIDTHS[word] : token.length;
  if (open.has('width') && (typeof width === 'number' || isDeferredLength(width))) {
    return { role: 'width', value: width };
  }
  if (open.has('style') && word && LINE_STYLES.has(word)) return { role: 'style', value: word };
  const color = isCurrentColour(token) ? 'currentcolor' : formOf(token, 'color');
  return open.has('color') && color !== undefined ? { role: 'color', value: color } : undefined;
}

/** A `calc()` of a token, which is a width, and no less than zero, as CSS clamps one. */
function computedWidth(
  token: TokenValue,
  open: ReadonlySet<LineTemplate['roles'][number]>,
  adjust: NonNullable<DeferredDeclaration['adjust']>,
): { role: 'width'; value: unknown } | undefined {
  // A bare number only when the calc() gives it its unit: `calc(var(--n) * 1px)`.
  const length = adjust.number ? token.number : token.length;
  if (!open.has('width') || (typeof length !== 'number' && !isDeferredLength(length))) {
    return undefined;
  }
  const value = adjusted(length, adjust);
  return { role: 'width', value: typeof value === 'number' ? Math.max(value, 0) : value };
}

const isDeferredLength = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && '__defer' in value;

const CHANNEL_KINDS: ReadonlySet<TokenKind> = new Set(['channels', 'hslChannels']);

/** `hsl()` reads a channels token as hue, saturation and lightness; `rgb()` as sRGB. */
type ChannelSpace = 'rgb' | 'hsl';

/**
 * `13, 110, 253` as the colour it is, at the alpha the token beside it says, if one does: the
 * channels form for `rgb()`, the hslChannels form for `hsl()`.
 */
function fromChannels(
  value: unknown,
  alpha: DeferredDeclaration['alpha'],
  tokens: Readonly<Record<string, TokenValue>>,
  space?: ChannelSpace,
): string | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  // An alpha naming a token nothing set, with no fallback, is no colour: CSS drops it.
  const opacity = alpha ? substitute(alpha, tokens, (token) => token.number) : 1;
  if (typeof opacity !== 'number') return undefined;
  if (space === 'hsl') return hslToRgb(value[0], value[1], value[2], opacity);
  const [r, g, b] = value as number[];
  return opacity >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(opacity * 1000) / 1000})`;
}

/** One template, or a layered background of several: every layer painted, or, as CSS would, none. */
function paintLayers(
  gradient: GradientTemplate | readonly GradientTemplate[],
  tokens: Readonly<Record<string, TokenValue>>,
): unknown {
  if (!Array.isArray(gradient)) return paintGradient(gradient as GradientTemplate, tokens);
  const painted: unknown[] = [];
  for (const layer of gradient as readonly GradientTemplate[]) {
    const one = paintGradient(layer, tokens) as unknown[] | undefined;
    if (!one) return undefined;
    painted.push(...one);
  }
  return painted;
}

/**
 * A gradient template with its stops filled in from the cascade.
 *
 * A stop whose colour is not defined anywhere is dropped rather than painted transparent: that is
 * what makes an optional middle colour optional, and it is what a browser does with the same
 * stylesheet. Fewer than two colours is not a gradient, and paints nothing at all.
 */
function paintGradient(
  template: GradientTemplate,
  tokens: Readonly<Record<string, TokenValue>>,
): unknown {
  const colorStops = paintedStops(template, tokens);
  if (!colorStops || colorStops.length < 2) return undefined;
  const position = template.position && placed(template.position, tokens);
  if (position === null) return undefined;
  return [{ ...template, colorStops, ...(position ? { position } : {}) }];
}

/**
 * A template's stops with their tokens read, leaving out any whose colour is not set. Undefined
 * when a stop's colour or position token is set but no such thing, which makes the gradient
 * invalid, as CSS substitutes a set token rather than falling back.
 */
function paintedStops(
  template: GradientTemplate,
  tokens: Readonly<Record<string, TokenValue>>,
): { color: string; position: string | number | null }[] | undefined {
  const colorStops = [];
  for (const stop of template.colorStops) {
    const token = stop.colour ? undefined : tokens[stop.reference!];
    const color = stop.colour ? resolveColour(stop.colour, tokens) : token?.color;
    // `none` is how the Tailwind flattening writes `via-none`: the stop left out, not invalid.
    if (color === undefined && token && token.keyword !== 'none') return undefined;
    if (color === undefined) continue;
    const position = stopPosition(stop, tokens);
    if (position === INVALID_POSITION) return undefined;
    // Written even when there is none: Fabric looks the key up before it looks at the value, and
    // silently skips a stop that has not got one.
    colorStops.push({ color, position: (position as string | number | undefined) ?? null });
  }
  return colorStops;
}

const INVALID_POSITION = Symbol('invalid position');

/** A stop's position: its token's when that is set, the one written otherwise. */
function stopPosition(
  stop: GradientTemplate['colorStops'][number],
  tokens: Readonly<Record<string, TokenValue>>,
): unknown {
  if (!stop.positionReference) return stop.position;
  const token = tokens[stop.positionReference];
  if (!token) return stop.position;
  return token.length ?? INVALID_POSITION;
}

/**
 * A radial gradient's centre with any token in it read, or null when a token it needs is not set
 * and has nothing written beside it: CSS would not paint the gradient then, and neither does this.
 */
function placed(
  position: NonNullable<GradientTemplate['position']>,
  tokens: Readonly<Record<string, TokenValue>>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [edge, offset] of Object.entries(position)) {
    if (offset === null || typeof offset !== 'object') {
      out[edge] = offset;
      continue;
    }
    const marker = offset as { reference: string; fallback?: string | number };
    const value = substitute(marker, tokens, (token) => token.length);
    if (value === undefined || typeof value === 'object') return null;
    out[edge] = value;
  }
  return out;
}

/**
 * A colour expression with its tokens looked up and any mix in it worked out. Undefined when a
 * token it needs is not defined anywhere and has nothing to fall back to.
 *
 * `current` is the node's colour, for a `currentColor` inside a mix or a relative colour. One that
 * is the whole expression is answered as `currentcolor`, for the caller to fill in.
 */
function resolveColour(
  expression: ColourExpression,
  tokens: Readonly<Record<string, TokenValue>>,
  current?: CurrentColour,
): string | undefined {
  if ('color' in expression) return expression.color;
  if ('channels' in expression) return channelsColour(expression, tokens);
  if ('hsl' in expression) return resolveHsl(expression.hsl, tokens);
  if ('reference' in expression) return tokenColour(expression, tokens);
  if ('relative' in expression) {
    const { space, from, channels, alpha } = expression.relative;
    const origin = innerColour(from, tokens, current);
    return origin === undefined ? undefined : relativeColour(space, origin, channels, alpha);
  }
  const sides = mixSides(expression.mix, tokens, current);
  return sides && mixColours(expression.mix.space, ...sides, expression.mix.hue);
}

/** The colour of the node a value is settled for, worked out only when something asks. */
type CurrentColour = () => string;

/** A colour inside another: `currentColor` there, written or in a token, is the node's colour. */
function innerColour(
  expression: ColourExpression,
  tokens: Readonly<Record<string, TokenValue>>,
  current: CurrentColour | undefined,
): string | undefined {
  if (!current) return resolveColour(expression, tokens);
  if ('reference' in expression) {
    const names = [expression.reference, ...(expression.alternatives ?? [])];
    if (isCurrentColour(firstSet(names, tokens))) return current();
  }
  const colour = resolveColour(expression, tokens, current);
  return colour?.toLowerCase() === 'currentcolor' ? current() : colour;
}

type Mix = Extract<ColourExpression, { mix: unknown }>['mix'];

/** A mix's two sides, a mix inside it unrounded, as CSS rounds only the colour at the end. */
function mixSides(
  mix: Mix,
  tokens: Readonly<Record<string, TokenValue>>,
  current?: CurrentColour,
): [MixSide, MixSide] | undefined {
  const colour = (side: ColourExpression) =>
    'mix' in side ? unroundedMix(side.mix, tokens, current) : innerColour(side, tokens, current);
  const first = colour(mix.a);
  const second = colour(mix.b);
  const shares = [mix.aPercentage, mix.bPercentage].map((share) => shareOf(share, tokens));
  // A share that is a token nothing sets: no mix, as CSS has no colour for one.
  if (first === undefined || second === undefined || shares.includes(null)) return undefined;
  return [
    { colour: first, percentage: shares[0] ?? undefined },
    { colour: second, percentage: shares[1] ?? undefined },
  ];
}

function unroundedMix(
  mix: Mix,
  tokens: Readonly<Record<string, TokenValue>>,
  current?: CurrentColour,
): Rgba | undefined {
  const sides = mixSides(mix, tokens, current);
  return sides && mixChannels(mix.space, ...sides, mix.hue);
}

/** A share as the percentage it comes to: undefined for none written, null for a token unset. */
function shareOf(
  share: MixShare | undefined,
  tokens: Readonly<Record<string, TokenValue>>,
): number | null | undefined {
  if (share === undefined || typeof share === 'number') return share;
  const factor = tokens[share.reference]?.number ?? share.fallback;
  return factor === undefined ? null : factor * share.scale;
}

/** A length in a structured value that is a token, with the arithmetic around it. */
interface LengthMarker {
  readonly reference: string;
  readonly adjust?: DeferredDeclaration['adjust'];
  readonly fallback?: number;
}

/**
 * Arithmetic with tokens in it, as the compiler leaves it: numbers, token references and
 * `[op, a, b]`, in points, degrees or plain numbers as the slot it fills counts. A percentage
 * written where a number is wanted is its fraction, kept apart from a bare number so that what
 * the arithmetic makes is still a percentage (see `calcType`).
 */
type CalcExpression =
  | number
  | { readonly percentage: number }
  | { readonly reference: string; readonly fallback?: CalcExpression }
  | readonly ['+' | '-' | '*' | '/' | 'max' | 'min', CalcExpression, CalcExpression];

/** A calc() tree's leaf that is not a bare number. */
type CalcLeaf = Exclude<CalcExpression, number | readonly unknown[]>;

interface CalcMarker {
  readonly expression: CalcExpression;
  readonly kind: 'length' | 'angle' | 'time' | 'number';
}

/** A calc marker worked out, as its slot takes it; undefined when a token in it is not set. */
function resolveCalc(
  marker: CalcMarker,
  tokens: Readonly<Record<string, TokenValue>>,
): number | string | undefined {
  const percentage = wholePercentage(marker, tokens);
  if (percentage !== undefined) return percentage;
  if (bareNumberAsLength(marker, tokens) || notAnAngle(marker, tokens)) return undefined;
  // A percentage and a number added together, `calc(var(--n) + 10%)`, are neither, and invalid.
  if (marker.kind === 'number' && calcType(marker.expression, tokens) === undefined)
    return undefined;
  const value = calculated(marker.expression, marker.kind, tokens);
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 1000) / 1000;
  return marker.kind === 'angle' ? `${rounded}deg` : rounded;
}

/**
 * Whether a length is one token holding a bare number other than 0: `--tw-translate-x: 3`, from
 * `translate-x-[3]`, which a browser drops. Inside arithmetic a bare number is a factor, and fine.
 */
function bareNumberAsLength(
  marker: CalcMarker,
  tokens: Readonly<Record<string, TokenValue>>,
): boolean {
  if (marker.kind !== 'length' || typeof marker.expression !== 'object') return false;
  if (Array.isArray(marker.expression)) return false;
  const token = tokens[(marker.expression as { reference: string }).reference];
  return (
    token !== undefined &&
    token.length === undefined &&
    token.number !== undefined &&
    token.number !== 0
  );
}

/**
 * Whether an angle is one token that holds no angle: `--tw-rotate: 3` or `37%`, from
 * `rotate-[3]`, which a browser drops, taking the whole transform with it. A bare 0 is an angle;
 * `0%` is not.
 */
function notAnAngle(marker: CalcMarker, tokens: Readonly<Record<string, TokenValue>>): boolean {
  if (marker.kind !== 'angle' || typeof marker.expression !== 'object') return false;
  if (Array.isArray(marker.expression)) return false;
  const token = tokens[(marker.expression as { reference: string }).reference];
  if (token === undefined || token.angle !== undefined) return false;
  // `0%` has a number 0 as well, and is still a percentage, which no angle is.
  return token.number !== 0 || typeof token.length === 'string';
}

/**
 * A length that is one token holding a percentage, `translate-x-1/2`'s 50%, passed on as it is:
 * a share of a box nobody has laid out yet can be used, but not added to or scaled here.
 */
function wholePercentage(
  marker: CalcMarker,
  tokens: Readonly<Record<string, TokenValue>>,
): string | undefined {
  if (marker.kind !== 'length' || typeof marker.expression !== 'object') return undefined;
  if (Array.isArray(marker.expression)) return undefined;
  const leaf = marker.expression as { reference: string };
  const value = formOf(tokens[leaf.reference], 'length');
  return typeof value === 'string' && value.endsWith('%') ? value : undefined;
}

function calculated(
  expression: CalcExpression,
  kind: CalcMarker['kind'],
  tokens: Readonly<Record<string, TokenValue>>,
): number | undefined {
  if (typeof expression === 'number') return expression;
  if (!Array.isArray(expression)) return leafValue(expression as CalcLeaf, kind, tokens);
  const [op, a, b] = expression as readonly [string, CalcExpression, CalcExpression];
  const left = calculated(a, kind, tokens);
  const right = calculated(b, kind, tokens);
  if (left === undefined || right === undefined) return undefined;
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '*') return left * right;
  if (op === 'max') return Math.max(left, right);
  if (op === 'min') return Math.min(left, right);
  return left / right;
}

/** A written percentage, or a token, as `calculated` reads it: its fallback when it is unset. */
function leafValue(
  leaf: CalcLeaf,
  kind: CalcMarker['kind'],
  tokens: Readonly<Record<string, TokenValue>>,
): number | undefined {
  if ('percentage' in leaf) return leaf.percentage;
  const token = tokens[leaf.reference];
  if (token) return tokenNumber(token, kind);
  return leaf.fallback === undefined ? undefined : calculated(leaf.fallback, kind, tokens);
}

/** Where each kind of slot reads a token from, before its bare number. */
const FORM_OF_KIND: Record<
  Exclude<CalcMarker['kind'], 'number'>,
  (token: TokenValue) => unknown
> = {
  length: (token) => token.length,
  angle: (token) => token.angle,
  time: (token) => token.time,
};

/**
 * A token as a number in a slot of this kind: its length in points or its angle in degrees, or
 * a bare number, which multiplies (`calc(var(--n) * 1px)`). A length that is not points, a
 * percentage, is not one, and is not read as the bare number it also is.
 */
function tokenNumber(token: TokenValue | undefined, kind: CalcMarker['kind']): number | undefined {
  if (!token) return undefined;
  const own = kind === 'number' ? undefined : FORM_OF_KIND[kind](token);
  if (own !== undefined) return typeof own === 'number' ? own : undefined;
  // An angle is a number of degrees to a hue, and neither a length nor a factor: `30deg` as a
  // translate moved a box thirty points, and as a scale made it thirty times the size, where a
  // browser drops the declaration.
  if (token.angle !== undefined) return undefined;
  return token.number;
}

/** A whole shadow, filter or transform token in a list, and the entries to use when it is unset. */
interface ShadowsMarker {
  readonly reference: string;
  readonly fallback?: readonly unknown[];
}

/** What a token set in a slot stands for: its entries, or none for one set to nothing, `--tw-blur: ;`. */
function slotEntries(token: TokenValue, kind: TokenKind): unknown {
  return formOf(token, kind) ?? (token.keyword?.trim() === '' ? [] : undefined);
}

/** The slot a list entry can be instead of an entry: one per list property that has them. */
const SLOT_KINDS = {
  __shadows: 'shadow',
  __filters: 'filter',
  __transforms: 'transform',
  __variants: 'fontVariant',
} as const satisfies Record<string, TokenKind>;

const SLOT_ENTRIES = Object.entries(SLOT_KINDS);

/** The slot a list entry is, and the form of token that fills it; undefined for an entry. */
function slotOf(part: unknown): { marker: ShadowsMarker; kind: TokenKind } | undefined {
  if (part === null || typeof part !== 'object') return undefined;
  for (const [key, kind] of SLOT_ENTRIES) {
    const marker = (part as Record<string, ShadowsMarker | undefined>)[key];
    if (marker) return { marker, kind };
  }
  return undefined;
}

function resolveLength(
  marker: LengthMarker,
  tokens: Readonly<Record<string, TokenValue>>,
): number | undefined {
  // A number when the arithmetic gives it its unit, as `referenced` reads one.
  const form = marker.adjust?.number ? 'number' : 'length';
  const value = substitute(marker, tokens, (token) => formOf(token, form));
  if (typeof value !== 'number') return undefined;
  return marker.adjust ? (adjusted(value, marker.adjust) as number) : value;
}

/** A colour at no opacity at all. */
function invisible(colour: unknown): boolean {
  if (colour === 'transparent') return true;
  const parts = typeof colour === 'string' ? RGB.exec(colour) : null;
  return parts?.[4] !== undefined && Number(parts[4]) === 0;
}

/**
 * Whether a compiled value has something in it to settle: a marker, slot or deferred length at
 * any depth. One with none is used as it is. Asked of values from the sheet, which never change,
 * so the answer is kept: Tailwind's reset fills three of a shadow's five slots with one on every
 * node.
 */
function needsFilling(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  let answer = NEEDS_FILLING.get(value);
  if (answer === undefined) {
    answer = Object.entries(value).some(
      ([key, part]) => key.startsWith('__') || needsFilling(part),
    );
    NEEDS_FILLING.set(value, answer);
  }
  return answer;
}
const NEEDS_FILLING = new WeakMap<object, boolean>();

/** What `settledMarker` says of a part that is not a token's marker at all. */
const NOT_A_MARKER = Symbol('not a marker');

/** A colour, length or calc marker settled from the tokens, or undefined when one cannot be. */
function settledMarker(
  value: object,
  tokens: Readonly<Record<string, TokenValue>>,
  current?: CurrentColour,
): unknown {
  const colour = colourMarker(value);
  if (colour) return resolveColour(colour, tokens, current);
  // Whether a shadow is inset, from a token that is the word or nothing: `ring-inset`.
  const inset = (value as { __inset?: { reference: string } }).__inset;
  if (inset) return formOf(tokens[inset.reference], 'keyword') === 'inset';
  const token = (value as { __length?: LengthMarker }).__length;
  if (token) return resolveLength(token, tokens);
  const sum = (value as { __calc?: CalcMarker }).__calc;
  if (sum) return resolveCalc(sum, tokens);
  const shadow = (value as { __dropShadow?: { reference: string } }).__dropShadow;
  if (shadow) return dropShadowOf(tokens[shadow.reference]?.shadow);
  return NOT_A_MARKER;
}

/**
 * A shadow token as the drop shadow a filter draws: `drop-shadow(var(--drop-shadow-xs))`. One
 * shadow, never inset and with no spread, which is all a drop shadow can be; nothing otherwise.
 */
function dropShadowOf(shadow: unknown): unknown {
  if (!Array.isArray(shadow) || shadow.length !== 1) return undefined;
  const [{ offsetX, offsetY, blurRadius, spreadDistance, color, inset }] = shadow as {
    offsetX: number;
    offsetY: number;
    blurRadius: number;
    spreadDistance: number;
    color: unknown;
    inset: boolean;
  }[];
  if (spreadDistance !== 0 || inset || typeof color !== 'string') return undefined;
  return { offsetX, offsetY, standardDeviation: blurRadius, color };
}

/** What a colour that cannot be settled makes of the whole value it is in. */
const UNSETTLED = Symbol('unsettled');

/** `rgba(var(--channels), <alpha>)`: the token's channels, at the alpha written or tokened. */
function channelsColour(
  expression: Extract<ColourExpression, { channels: unknown }>,
  tokens: Readonly<Record<string, TokenValue>>,
): string | undefined {
  const { space } = expression.channels;
  const kind = space === 'hsl' ? 'hslChannels' : 'channels';
  const value = substitute(expression.channels, tokens, (token) => formOf(token, kind));
  const { alpha } = expression;
  if (typeof alpha !== 'number') return fromChannels(value, alpha, tokens, space);
  const opaque = fromChannels(value, undefined, tokens, space);
  return opaque === undefined ? undefined : (faded(opaque, alpha) as string);
}

/** A token's colour, or the first of its alternatives that is defined, or its fallback. */
function tokenColour(
  expression: Extract<ColourExpression, { reference: string }>,
  tokens: Readonly<Record<string, TokenValue>>,
): string | undefined {
  // The first token set is substituted, whatever it holds, as `referenced` reads one.
  const set = firstSet([expression.reference, ...(expression.alternatives ?? [])], tokens);
  if (expression.orInset) return insetOrColour(set);
  if (set) return formOf(set, 'color') as string | undefined;
  const token = expression.fallbackToken;
  return expression.fallback ?? (token && (formOf(derived(token, tokens), 'color') as string));
}

/**
 * A shadow's colour from a token that is the colour or the word `inset`: currentcolor, which the
 * node fills in, when it is `inset` or unset, and nothing, so no shadow, when it is anything else.
 */
function insetOrColour(token: TokenValue | undefined): string | undefined {
  if (!token || token.keyword === 'inset') return 'currentcolor';
  return formOf(token, 'color') as string | undefined;
}

/** A marker the compiler leaves in a structured value for a colour only the device can settle. */
function colourMarker(value: unknown): ColourExpression | undefined {
  return (value as { __colour?: ColourExpression } | null)?.__colour;
}

/**
 * A resolved length, moved by the arithmetic that surrounded its `var()`.
 *
 * A non-numeric value is left alone rather than coerced: the token was a keyword or a percentage
 * the app meant, and turning it into NaN would be a silent layout rather than a visible one.
 */
function adjusted(value: unknown, adjust: NonNullable<DeferredDeclaration['adjust']>): unknown {
  if (adjust.alpha !== undefined) return faded(value, adjust.alpha);
  const em = (value as { __defer?: DeferredEm } | null)?.__defer;
  if (em && adjust.floor === undefined) return adjustedEm(em, adjust);
  if (typeof value !== 'number') return value;
  const scaled = value * (adjust.scale ?? 1) + (adjust.offset ?? 0);
  return adjust.floor === undefined ? scaled : Math.max(scaled, adjust.floor);
}

interface DeferredEm {
  readonly unit: string;
  readonly factor: number;
  readonly offset?: number;
}

/** A length in em, worked out against the font size later, with the arithmetic moved inside it. */
function adjustedEm(
  em: DeferredEm,
  adjust: NonNullable<DeferredDeclaration['adjust']>,
): { __defer: DeferredEm } {
  const scale = adjust.scale ?? 1;
  const offset = (em.offset ?? 0) * scale + (adjust.offset ?? 0);
  return { __defer: { ...em, factor: em.factor * scale, ...(offset ? { offset } : {}) } };
}

/** `rgb(r, g, b)` and `rgba(r, g, b, a)`, which is every colour the compiler emits. */
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

/**
 * A colour at a fraction of its opacity.
 *
 * Multiplied rather than replaced, so a token that was already translucent stays relatively so -
 * `rgba(0, 0, 0, 0.5)` faded to 90% is 45% opaque, which is what a browser computes for the same
 * mix. A value that is not one of ours is returned untouched: it may be a platform colour, and a
 * colour nobody can parse is better painted as it stands than dropped.
 */
export function faded(value: unknown, fraction: number): unknown {
  if (typeof value !== 'string') return value;
  const parts = RGB.exec(value);
  if (!parts) return value;
  const alpha = (parts[4] === undefined ? 1 : Number(parts[4])) * fraction;
  return `rgba(${parts[1]}, ${parts[2]}, ${parts[3]}, ${Math.round(alpha * 1000) / 1000})`;
}

/**
 * Where a component's compiled sheet lives: a static on the component class, written by the
 * Metro transformer at build time.
 *
 * `RendererFactory2.createRenderer(host, type)` receives the component definition, and a
 * definition references its class, so a renderer can find its own sheet with no registry and no
 * generated id. That is also how encapsulation is scoped for free: a component's renderer only
 * ever matches that component's rules, so its elements cannot be styled by anyone else's CSS.
 */
export const NATIVE_STYLES = 'ɵnativeStyles';

export function styleSheetOf(type: unknown): StyleSheet | null {
  const sheet = (type as Record<string, unknown> | null)?.[NATIVE_STYLES];
  return (sheet as StyleSheet | undefined) ?? null;
}
