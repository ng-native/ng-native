import { defineGrammars } from './css-grammar.ts';

/**
 * The CSS properties a declaration block knows (https://drafts.csswg.org/cssom/#supported-css-property):
 * each longhand, with what it takes where that is checked; each shorthand, with the longhands
 * it sets; and the older names some have. A name that is none of them is no property, and a
 * block does not declare it.
 *
 * ponytail: the properties Chrome has, and a grammar for those a script commonly sets. Any
 * other longhand takes any value.
 */

/** Grammars a property's refers to by name, `<line-width>`. */
defineGrammars({
  'line-style':
    'none | hidden | dotted | dashed | solid | double | groove | ridge | inset | outset',
  'line-width': '<nn-length> | thin | medium | thick',
  'size-keyword':
    'min-content | max-content | fit-content | fit-content() | stretch | -webkit-fill-available | -webkit-min-content | -webkit-max-content | -webkit-fit-content | -moz-available | -moz-fit-content | -moz-min-content | -moz-max-content | -webkit-stretch | anchor-size() | calc-size() | contain',
  size: 'auto | <nn-length-percentage> | <size-keyword>',
  'max-size': 'none | <nn-length-percentage> | <size-keyword>',
  'margin-width': '<length-percentage> | auto | anchor-size()',
  'inset-width': '<length-percentage> | auto | anchor() | anchor-size()',
  radius: '<nn-length-percentage>{1,2}',
  easing:
    'linear | linear() | ease | ease-in | ease-out | ease-in-out | step-start | step-end | steps() | cubic-bezier()',
  'self-position':
    'center | start | end | self-start | self-end | flex-start | flex-end | left | right | anchor-center',
  'content-position': 'center | start | end | flex-start | flex-end | left | right',
  'content-distribution': 'space-between | space-around | space-evenly | stretch',
  'baseline-position': '[ first | last ]? baseline',
  'overflow-position': 'unsafe | safe',
  'align-content-value':
    'normal | <baseline-position> | <content-distribution> | <overflow-position>? <content-position>',
  'justify-content-value':
    'normal | <content-distribution> | <overflow-position>? <content-position> | left | right',
  'align-items-value':
    'normal | stretch | <baseline-position> | <overflow-position>? <self-position> | anchor-center',
  'align-self-value':
    'auto | normal | stretch | <baseline-position> | <overflow-position>? <self-position> | anchor-center',
  'justify-items-value':
    'normal | stretch | <baseline-position> | <overflow-position>? <self-position> | legacy | legacy left | legacy right | legacy center | left legacy | right legacy | center legacy | anchor-center',
  'position-x':
    '[ center | left | right | x-start | x-end | <length-percentage> | [ left | right | x-start | x-end ] <length-percentage> ]',
  'position-y':
    '[ center | top | bottom | y-start | y-end | <length-percentage> | [ top | bottom | y-start | y-end ] <length-percentage> ]',
  'bg-position':
    '[ left | center | right | top | bottom | <length-percentage> ] | [ left | center | right | <length-percentage> ] [ top | center | bottom | <length-percentage> ] | [ center | [ left | right ] <length-percentage>? ] && [ center | [ top | bottom ] <length-percentage>? ]',
  'bg-size': '[ <nn-length-percentage> | auto ]{1,2} | cover | contain',
  'repeat-style': 'repeat-x | repeat-y | [ repeat | space | round | no-repeat ]{1,2}',
  box: 'border-box | padding-box | content-box',
  'bg-clip': '<box> | border | text | border-area',
  paint: 'none | <color> | <url> [ none | <color> ]? | context-fill | context-stroke',
  'counter-style-name': '<custom-ident>',
  'list-style-type-value': '<counter-style-name> | <string> | symbols() | none',
  'font-weight-value': 'normal | bold | bolder | lighter | <number>',
  'font-style-value': 'normal | italic | oblique <angle>{0,2}',
  'font-stretch-value':
    'normal | <nn-percentage> | ultra-condensed | extra-condensed | condensed | semi-condensed | semi-expanded | expanded | extra-expanded | ultra-expanded',
  'font-size-value':
    'xx-small | x-small | small | medium | large | x-large | xx-large | xxx-large | larger | smaller | <nn-length-percentage> | math | -webkit-xxx-large',
  'line-height-value': 'normal | <nn-number> | <nn-length-percentage>',
  'family-name': '<string> | <custom-ident>+',
  'generic-family':
    'serif | sans-serif | cursive | fantasy | monospace | system-ui | emoji | math | fangsong | ui-serif | ui-sans-serif | ui-monospace | ui-rounded | -webkit-body | -webkit-pictograph | -webkit-standard',
  'font-family-value': '[ <generic-family> | <family-name> ]#',
  'nn-percentage': '<percentage>',
  'text-decoration-line-value':
    'none | [ underline || overline || line-through || blink || spelling-error || grammar-error ]',
  'text-decoration-style-value': 'solid | double | dotted | dashed | wavy',
  'text-decoration-thickness-value': 'auto | from-font | <length-percentage>',
  'transition-property-value': 'none | [ all | <custom-ident> ]#',
  'single-animation-iteration-count': 'infinite | <nn-number>',
  'single-animation-direction': 'normal | reverse | alternate | alternate-reverse',
  'single-animation-fill-mode': 'none | forwards | backwards | both',
  'single-animation-play-state': 'running | paused',
  'animation-name-value': '[ none | <custom-ident> | <string> ]#',
  'display-value':
    '[ block | inline | run-in ] || [ flow | flow-root | table | flex | grid | ruby | math ] || list-item | contents | none | inline-block | inline-table | inline-flex | inline-grid | table-row-group | table-header-group | table-footer-group | table-row | table-cell | table-column-group | table-column | table-caption | ruby-base | ruby-text | ruby-base-container | ruby-text-container | -webkit-box | -webkit-inline-box | -webkit-flex | -webkit-inline-flex | flow-root | list-item block | list-item inline | block list-item | inline list-item | list-item flow | list-item flow-root | grid-lanes | inline-grid-lanes',
  'overflow-value':
    'visible | hidden | clip | scroll | auto | overlay | -webkit-paged-x | -webkit-paged-y',
  'cursor-value':
    '[ <url> <number>{0,2} , ]* [ auto | default | none | context-menu | help | pointer | progress | wait | cell | crosshair | text | vertical-text | alias | copy | move | no-drop | not-allowed | grab | grabbing | e-resize | n-resize | ne-resize | nw-resize | s-resize | se-resize | sw-resize | w-resize | ew-resize | ns-resize | nesw-resize | nwse-resize | col-resize | row-resize | all-scroll | zoom-in | zoom-out | -webkit-grab | -webkit-grabbing | -webkit-zoom-in | -webkit-zoom-out ]',
  'shadow-value': 'none | [ <color>? && <length>{2,4} && inset? ]#',
  'text-shadow-value': 'none | [ <color>? && <length>{2,3} ]#',
  ratio: '<nn-number> [ / <nn-number> ]?',
  'aspect-ratio-value': 'auto || <ratio>',
  'page-size':
    '<nn-length>{1,2} | auto | [ A5 | A4 | A3 | B5 | B4 | JIS-B5 | JIS-B4 | letter | legal | ledger ] || [ portrait | landscape ]',
  'filter-value': 'none | [ <url> | <any-function> ]+',
  'transform-value': 'none | <any-function>+',
});

/**
 * Each longhand, and what it takes where that is checked. A grammar of `''` takes any value.
 * Kept in the order Chrome lists them, which is the order `getComputedStyle` reads them in.
 */
const GRAMMARS: Readonly<Record<string, string>> = {
  'accent-color': 'auto | <color>',
  'align-content': '<align-content-value>',
  'align-items': '<align-items-value>',
  'align-self': '<align-self-value>',
  'aspect-ratio': '<aspect-ratio-value>',
  'backface-visibility': 'visible | hidden',
  'background-attachment': '[ scroll | fixed | local ]#',
  'background-blend-mode':
    '[ normal | multiply | screen | overlay | darken | lighten | color-dodge | color-burn | hard-light | soft-light | difference | exclusion | hue | saturation | color | luminosity ]#',
  'background-clip': '<bg-clip>#',
  'background-color': '<color>',
  'background-image': '[ none | <image> ]#',
  'background-origin': '<box>#',
  'background-position-x': '<position-x>#',
  'background-position-y': '<position-y>#',
  'background-repeat': '<repeat-style>#',
  'background-size': '<bg-size>#',
  'block-size': '<size>',
  'border-block-end-color': '<color>',
  'border-block-end-style': '<line-style>',
  'border-block-end-width': '<line-width>',
  'border-block-start-color': '<color>',
  'border-block-start-style': '<line-style>',
  'border-block-start-width': '<line-width>',
  'border-bottom-color': '<color>',
  'border-bottom-left-radius': '<radius>',
  'border-bottom-right-radius': '<radius>',
  'border-bottom-style': '<line-style>',
  'border-bottom-width': '<line-width>',
  'border-collapse': 'separate | collapse',
  'border-end-end-radius': '<radius>',
  'border-end-start-radius': '<radius>',
  'border-image-outset': '[ <nn-length> | <nn-number> ]{1,4}',
  'border-image-repeat': '[ stretch | repeat | round | space ]{1,2}',
  'border-image-slice': '<nn-number-percentage>{1,4} && fill?',
  'border-image-source': 'none | <image>',
  'border-image-width': '[ <nn-length-percentage> | <nn-number> | auto ]{1,4}',
  'border-inline-end-color': '<color>',
  'border-inline-end-style': '<line-style>',
  'border-inline-end-width': '<line-width>',
  'border-inline-start-color': '<color>',
  'border-inline-start-style': '<line-style>',
  'border-inline-start-width': '<line-width>',
  'border-left-color': '<color>',
  'border-left-style': '<line-style>',
  'border-left-width': '<line-width>',
  'border-right-color': '<color>',
  'border-right-style': '<line-style>',
  'border-right-width': '<line-width>',
  'border-spacing': '<nn-length>{1,2}',
  'border-start-end-radius': '<radius>',
  'border-start-start-radius': '<radius>',
  'border-top-color': '<color>',
  'border-top-left-radius': '<radius>',
  'border-top-right-radius': '<radius>',
  'border-top-style': '<line-style>',
  'border-top-width': '<line-width>',
  bottom: '<inset-width>',
  'box-shadow': '<shadow-value>',
  'box-sizing': 'content-box | border-box',
  'break-after':
    'auto | avoid | always | all | avoid-page | page | left | right | recto | verso | avoid-column | column | avoid-region | region',
  'break-before':
    'auto | avoid | always | all | avoid-page | page | left | right | recto | verso | avoid-column | column | avoid-region | region',
  'break-inside': 'auto | avoid | avoid-page | avoid-column | avoid-region',
  'caption-side': 'top | bottom',
  'caret-color': 'auto | <color>',
  clear: 'none | left | right | both | inline-start | inline-end',
  color: '<color>',
  'column-count': 'auto | <positive-integer>',
  'column-gap': 'normal | <nn-length-percentage>',
  'column-rule-color': '<color>',
  'column-rule-style': '<line-style>',
  'column-rule-width': '<line-width>',
  'column-span': 'none | all',
  'column-width': 'auto | <nn-length>',
  direction: 'ltr | rtl',
  display: '<display-value>',
  'empty-cells': 'show | hide',
  fill: '<paint>',
  'fill-opacity': '<number-percentage>',
  'fill-rule': 'nonzero | evenodd',
  filter: '<filter-value>',
  'flex-basis': 'auto | content | <nn-length-percentage> | <size-keyword>',
  'flex-direction': 'row | row-reverse | column | column-reverse',
  'flex-grow': '<nn-number>',
  'flex-shrink': '<nn-number>',
  'flex-wrap': 'nowrap | wrap | wrap-reverse',
  float: 'none | left | right | inline-start | inline-end',
  'flood-color': '<color>',
  'font-family': '<font-family-value>',
  'font-kerning': 'auto | normal | none',
  'font-size': '<font-size-value>',
  'font-stretch': '<font-stretch-value>',
  'font-style': '<font-style-value>',
  'font-variant-caps':
    'normal | small-caps | all-small-caps | petite-caps | all-petite-caps | unicase | titling-caps',
  'font-weight': '<font-weight-value>',
  height: '<size>',
  'image-rendering':
    'auto | smooth | high-quality | crisp-edges | pixelated | -webkit-optimize-contrast',
  'inline-size': '<size>',
  'inset-block-end': '<inset-width>',
  'inset-block-start': '<inset-width>',
  'inset-inline-end': '<inset-width>',
  'inset-inline-start': '<inset-width>',
  isolation: 'auto | isolate',
  'justify-content': '<justify-content-value>',
  'justify-items': '<justify-items-value>',
  'justify-self': '<align-self-value> | left | right',
  left: '<inset-width>',
  'letter-spacing': 'normal | <length-percentage>',
  'lighting-color': '<color>',
  'line-height': '<line-height-value>',
  'list-style-image': 'none | <image>',
  'list-style-position': 'inside | outside',
  'list-style-type': '<list-style-type-value>',
  'margin-block-end': '<margin-width>',
  'margin-block-start': '<margin-width>',
  'margin-bottom': '<margin-width>',
  'margin-inline-end': '<margin-width>',
  'margin-inline-start': '<margin-width>',
  'margin-left': '<margin-width>',
  'margin-right': '<margin-width>',
  'margin-top': '<margin-width>',
  'max-block-size': '<max-size>',
  'max-height': '<max-size>',
  'max-inline-size': '<max-size>',
  'max-width': '<max-size>',
  'min-block-size': '<size>',
  'min-height': '<size>',
  'min-inline-size': '<size>',
  'min-width': '<size>',
  'mix-blend-mode':
    'normal | multiply | screen | overlay | darken | lighten | color-dodge | color-burn | hard-light | soft-light | difference | exclusion | hue | saturation | color | luminosity | plus-lighter',
  'object-fit': 'fill | contain | cover | none | scale-down',
  opacity: '<number-percentage>',
  order: '<integer>',
  orphans: '<positive-integer>',
  'outline-color': 'auto | invert | <color>',
  'outline-offset': '<length>',
  'outline-style': 'auto | <line-style>',
  'outline-width': '<line-width>',
  'overflow-wrap': 'normal | break-word | anywhere',
  'overflow-x': '<overflow-value>',
  'overflow-y': '<overflow-value>',
  'overscroll-behavior-x': 'contain | none | auto',
  'overscroll-behavior-y': 'contain | none | auto',
  'padding-block-end': '<nn-length-percentage>',
  'padding-block-start': '<nn-length-percentage>',
  'padding-bottom': '<nn-length-percentage>',
  'padding-inline-end': '<nn-length-percentage>',
  'padding-inline-start': '<nn-length-percentage>',
  'padding-left': '<nn-length-percentage>',
  'padding-right': '<nn-length-percentage>',
  'padding-top': '<nn-length-percentage>',
  'pointer-events':
    'auto | none | visiblepainted | visiblefill | visiblestroke | visible | painted | fill | stroke | all | bounding-box',
  position: 'static | relative | absolute | fixed | sticky | -webkit-sticky',
  resize: 'none | both | horizontal | vertical | block | inline',
  right: '<inset-width>',
  'row-gap': 'normal | <nn-length-percentage>',
  'scroll-behavior': 'auto | smooth',
  'stop-color': '<color>',
  stroke: '<paint>',
  'stroke-opacity': '<number-percentage>',
  'stroke-width': '<nn-length-percentage> | <nn-number>',
  'tab-size': '<nn-number> | <nn-length>',
  'table-layout': 'auto | fixed',
  'text-align':
    'start | end | left | right | center | justify | match-parent | -webkit-left | -webkit-right | -webkit-center | -webkit-match-parent | -internal-center',
  'text-decoration-color': '<color>',
  'text-decoration-line': '<text-decoration-line-value>',
  'text-decoration-style': '<text-decoration-style-value>',
  'text-decoration-thickness': '<text-decoration-thickness-value>',
  'text-emphasis-color': '<color>',
  'text-overflow': 'clip | ellipsis',
  'text-shadow': '<text-shadow-value>',
  'text-transform':
    'none | [ capitalize | uppercase | lowercase ] || full-width || full-size-kana | math-auto',
  top: '<inset-width>',
  transform: '<transform-value>',
  'transition-delay': '<time>#',
  'transition-duration': '<nn-time>#',
  'transition-property': '<transition-property-value>',
  'transition-timing-function': '<easing>#',
  'animation-delay': '<time>#',
  'animation-direction': '<single-animation-direction>#',
  'animation-duration': '[ auto | <nn-time> ]#',
  'animation-fill-mode': '<single-animation-fill-mode>#',
  'animation-iteration-count': '<single-animation-iteration-count>#',
  'animation-name': '<animation-name-value>',
  'animation-play-state': '<single-animation-play-state>#',
  'animation-timing-function': '<easing>#',
  'unicode-bidi':
    'normal | embed | isolate | bidi-override | isolate-override | plaintext | -webkit-isolate | -webkit-isolate-override | -webkit-plaintext',
  'user-select': 'auto | text | none | contain | all',
  'vertical-align':
    'baseline | sub | super | text-top | text-bottom | middle | top | bottom | <length-percentage>',
  visibility: 'visible | hidden | collapse',
  widows: '<positive-integer>',
  width: '<size>',
  'will-change': 'auto | <custom-ident>#',
  'word-break': 'normal | break-all | keep-all | break-word | auto-phrase',
  'word-spacing': 'normal | <length-percentage>',
  'writing-mode':
    'horizontal-tb | vertical-rl | vertical-lr | sideways-rl | sideways-lr | lr | lr-tb | rl | rl-tb | tb | tb-rl',
  'z-index': 'auto | <integer>',
  'page-orientation': 'upright | rotate-left | rotate-right',
  size: '<page-size>',
};

/** The longhands that take any value, as they are not checked here. */
const UNCHECKED = `
  alignment-baseline anchor-name anchor-scope animation-composition animation-range-end
  animation-range-start animation-timeline app-region appearance backdrop-filter baseline-shift
  baseline-source box-decoration-break buffered-rendering caret-animation caret-shape clip
  clip-path clip-rule color-interpolation color-interpolation-filters color-rendering
  color-scheme column-fill column-height column-wrap contain contain-intrinsic-block-size
  contain-intrinsic-height contain-intrinsic-inline-size contain-intrinsic-width container-name
  container-type content content-visibility corner-bottom-left-shape corner-bottom-right-shape
  corner-end-end-shape corner-end-start-shape corner-start-end-shape corner-start-start-shape
  corner-top-left-shape corner-top-right-shape counter-increment counter-reset counter-set
  cursor cx cy d dominant-baseline dynamic-range-limit field-sizing flood-opacity
  font-feature-settings font-language-override font-optical-sizing font-palette font-size-adjust
  font-synthesis-small-caps font-synthesis-style font-synthesis-weight font-variant-alternates
  font-variant-east-asian font-variant-emoji font-variant-ligatures font-variant-numeric
  font-variant-position font-variation-settings forced-color-adjust grid-auto-columns
  grid-auto-flow grid-auto-rows grid-column-end grid-column-start grid-row-end grid-row-start
  grid-template-areas grid-template-columns grid-template-rows hyphenate-character
  hyphenate-limit-chars hyphens image-orientation initial-letter interactivity interest-delay-end
  interest-delay-start interpolate-size line-break line-clamp marker-end marker-mid marker-start
  mask-clip mask-composite mask-image mask-mode mask-origin mask-position mask-repeat mask-size
  mask-type math-depth math-shift math-style object-position object-view-box offset-anchor
  offset-distance offset-path offset-position offset-rotate overflow-anchor overflow-block
  overflow-clip-margin overflow-inline overlay overscroll-behavior-block
  overscroll-behavior-inline page paint-order perspective perspective-origin position-anchor
  position-area position-try-fallbacks position-try-order position-visibility print-color-adjust
  quotes r reading-flow reading-order rotate ruby-align ruby-overhang ruby-position rx ry scale
  scroll-initial-target scroll-margin-block-end scroll-margin-block-start scroll-margin-bottom
  scroll-margin-inline-end scroll-margin-inline-start scroll-margin-left scroll-margin-right
  scroll-margin-top scroll-marker-group scroll-padding-block-end scroll-padding-block-start
  scroll-padding-bottom scroll-padding-inline-end scroll-padding-inline-start
  scroll-padding-left scroll-padding-right scroll-padding-top scroll-snap-align
  scroll-snap-stop scroll-snap-type scroll-target-group scroll-timeline-axis scroll-timeline-name
  scrollbar-color scrollbar-gutter scrollbar-width shape-image-threshold shape-margin
  shape-outside shape-rendering speak stop-opacity stroke-dasharray stroke-dashoffset
  stroke-linecap stroke-linejoin stroke-miterlimit text-align-last text-anchor text-autospace
  text-box-edge text-box-trim text-combine-upright text-decoration-skip-ink
  text-emphasis-position text-emphasis-style text-indent text-orientation text-rendering
  text-size-adjust text-spacing-trim text-underline-offset text-underline-position
  text-wrap-mode text-wrap-style timeline-scope touch-action transform-box transform-origin
  transform-style transition-behavior translate vector-effect view-timeline-axis
  view-timeline-inset view-timeline-name view-transition-class view-transition-group
  view-transition-name white-space-collapse x y zoom
  -webkit-border-horizontal-spacing -webkit-border-image -webkit-border-vertical-spacing
  -webkit-box-align -webkit-box-decoration-break -webkit-box-direction -webkit-box-flex
  -webkit-box-ordinal-group -webkit-box-orient -webkit-box-pack -webkit-box-reflect
  -webkit-font-smoothing -webkit-line-break -webkit-line-clamp -webkit-locale
  -webkit-mask-box-image-outset -webkit-mask-box-image-repeat -webkit-mask-box-image-slice
  -webkit-mask-box-image-source -webkit-mask-box-image-width -webkit-mask-position-x
  -webkit-mask-position-y -webkit-rtl-ordering -webkit-tap-highlight-color -webkit-text-combine
  -webkit-text-decorations-in-effect -webkit-text-fill-color -webkit-text-security
  -webkit-text-stroke-color -webkit-text-stroke-width -webkit-user-drag -webkit-user-modify
  -webkit-writing-mode -webkit-perspective-origin-x -webkit-perspective-origin-y
  -webkit-transform-origin-x -webkit-transform-origin-y -webkit-transform-origin-z
`;

/** Every longhand, by name: what it takes, `''` for anything. */
export const LONGHANDS: ReadonlyMap<string, string> = new Map([
  ...Object.entries(GRAMMARS),
  ...UNCHECKED.split(/\s+/)
    .filter(Boolean)
    .map((name): [string, string] => [name, '']),
]);

/** How a shorthand's value is read into its longhands, and written back from them. */
export type ShorthandKind =
  /** One to four values, a side each: `margin`. */
  | 'box'
  /** One or two values, the second the first where it is left out: `overflow`. */
  | 'pair'
  /** Each longhand's value in any order, and each one left out its initial value: `outline`. */
  | 'any-order'
  /** Its longhands' values are not set from it, and it is declared as itself. */
  | 'opaque';

export interface Shorthand {
  readonly longhands: readonly string[];
  readonly kind: ShorthandKind | 'custom';
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const sided = (pattern: string): string[] => SIDES.map((side) => pattern.replace('*', side));
const ends = (pattern: string): string[] =>
  ['start', 'end'].map((end) => pattern.replace('*', end));

const BORDER_IMAGE = ['source', 'slice', 'width', 'outset', 'repeat'].map(
  (part) => `border-image-${part}`,
);
const BORDER = [
  ...sided('border-*-width'),
  ...sided('border-*-style'),
  ...sided('border-*-color'),
  ...BORDER_IMAGE,
];
const FONT = [
  ...['font-style', 'font-variant-ligatures', 'font-variant-caps', 'font-variant-alternates'],
  ...['font-variant-numeric', 'font-variant-east-asian', 'font-variant-position'],
  ...['font-variant-emoji', 'font-weight', 'font-stretch', 'font-size', 'line-height'],
  ...['font-family', 'font-optical-sizing', 'font-size-adjust', 'font-kerning'],
  ...['font-feature-settings', 'font-variation-settings', 'font-language-override'],
];
const BACKGROUND = [
  ...['background-image', 'background-position-x', 'background-position-y', 'background-size'],
  ...['background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  'background-color',
];
const TRANSITION = ['property', 'duration', 'timing-function', 'delay', 'behavior'].map(
  (part) => `transition-${part}`,
);
const ANIMATION = [
  ...['duration', 'timing-function', 'delay', 'iteration-count', 'direction', 'fill-mode'],
  ...['play-state', 'name', 'timeline', 'range-start', 'range-end'],
].map((part) => `animation-${part}`);

/** Each shorthand, by name, with its longhands in the order it sets them. */
export const SHORTHANDS: ReadonlyMap<string, Shorthand> = new Map<string, Shorthand>([
  ['margin', { longhands: sided('margin-*'), kind: 'box' }],
  ['padding', { longhands: sided('padding-*'), kind: 'box' }],
  ['inset', { longhands: SIDES, kind: 'box' }],
  ['border-width', { longhands: sided('border-*-width'), kind: 'box' }],
  ['border-style', { longhands: sided('border-*-style'), kind: 'box' }],
  ['border-color', { longhands: sided('border-*-color'), kind: 'box' }],
  ['scroll-margin', { longhands: sided('scroll-margin-*'), kind: 'box' }],
  ['scroll-padding', { longhands: sided('scroll-padding-*'), kind: 'box' }],
  ['overflow', { longhands: ['overflow-x', 'overflow-y'], kind: 'pair' }],
  ['gap', { longhands: ['row-gap', 'column-gap'], kind: 'pair' }],
  [
    'overscroll-behavior',
    { longhands: ['overscroll-behavior-x', 'overscroll-behavior-y'], kind: 'pair' },
  ],
  ['margin-block', { longhands: ends('margin-block-*'), kind: 'pair' }],
  ['margin-inline', { longhands: ends('margin-inline-*'), kind: 'pair' }],
  ['padding-block', { longhands: ends('padding-block-*'), kind: 'pair' }],
  ['padding-inline', { longhands: ends('padding-inline-*'), kind: 'pair' }],
  ['inset-block', { longhands: ends('inset-block-*'), kind: 'pair' }],
  ['inset-inline', { longhands: ends('inset-inline-*'), kind: 'pair' }],
  ['scroll-margin-block', { longhands: ends('scroll-margin-block-*'), kind: 'pair' }],
  ['scroll-margin-inline', { longhands: ends('scroll-margin-inline-*'), kind: 'pair' }],
  ['scroll-padding-block', { longhands: ends('scroll-padding-block-*'), kind: 'pair' }],
  ['scroll-padding-inline', { longhands: ends('scroll-padding-inline-*'), kind: 'pair' }],
  ['border-block-width', { longhands: ends('border-block-*-width'), kind: 'pair' }],
  ['border-block-style', { longhands: ends('border-block-*-style'), kind: 'pair' }],
  ['border-block-color', { longhands: ends('border-block-*-color'), kind: 'pair' }],
  ['border-inline-width', { longhands: ends('border-inline-*-width'), kind: 'pair' }],
  ['border-inline-style', { longhands: ends('border-inline-*-style'), kind: 'pair' }],
  ['border-inline-color', { longhands: ends('border-inline-*-color'), kind: 'pair' }],
  ['place-content', { longhands: ['align-content', 'justify-content'], kind: 'pair' }],
  ['place-items', { longhands: ['align-items', 'justify-items'], kind: 'pair' }],
  ['place-self', { longhands: ['align-self', 'justify-self'], kind: 'pair' }],
  [
    'contain-intrinsic-size',
    { longhands: ['contain-intrinsic-width', 'contain-intrinsic-height'], kind: 'opaque' },
  ],
  [
    'border-radius',
    {
      longhands: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
        (corner) => `border-${corner}-radius`,
      ),
      kind: 'custom',
    },
  ],
  ...SIDES.map((side): [string, Shorthand] => [
    `border-${side}`,
    {
      longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
      kind: 'any-order',
    },
  ]),
  ...['block-start', 'block-end', 'inline-start', 'inline-end'].map((side): [string, Shorthand] => [
    `border-${side}`,
    {
      longhands: [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`],
      kind: 'any-order',
    },
  ]),
  [
    'border-block',
    {
      longhands: ['width', 'style', 'color'].flatMap((part) => ends(`border-block-*-${part}`)),
      kind: 'custom',
    },
  ],
  [
    'border-inline',
    {
      longhands: ['width', 'style', 'color'].flatMap((part) => ends(`border-inline-*-${part}`)),
      kind: 'custom',
    },
  ],
  ['border', { longhands: BORDER, kind: 'custom' }],
  ['border-image', { longhands: BORDER_IMAGE, kind: 'custom' }],
  [
    'outline',
    { longhands: ['outline-color', 'outline-style', 'outline-width'], kind: 'any-order' },
  ],
  [
    'column-rule',
    {
      longhands: ['column-rule-width', 'column-rule-style', 'column-rule-color'],
      kind: 'any-order',
    },
  ],
  ['columns', { longhands: ['column-width', 'column-count'], kind: 'any-order' }],
  [
    'list-style',
    { longhands: ['list-style-position', 'list-style-image', 'list-style-type'], kind: 'custom' },
  ],
  [
    'text-decoration',
    {
      longhands: [
        'text-decoration-line',
        'text-decoration-thickness',
        'text-decoration-style',
        'text-decoration-color',
      ],
      kind: 'any-order',
    },
  ],
  ['text-emphasis', { longhands: ['text-emphasis-style', 'text-emphasis-color'], kind: 'opaque' }],
  ['flex-flow', { longhands: ['flex-direction', 'flex-wrap'], kind: 'any-order' }],
  ['flex', { longhands: ['flex-grow', 'flex-shrink', 'flex-basis'], kind: 'custom' }],
  [
    'background-position',
    { longhands: ['background-position-x', 'background-position-y'], kind: 'custom' },
  ],
  ['background', { longhands: BACKGROUND, kind: 'custom' }],
  ...['after', 'before', 'inside'].flatMap((at): [string, Shorthand][] => [
    [`page-break-${at}`, { longhands: [`break-${at}`], kind: 'custom' }],
    [`-webkit-column-break-${at}`, { longhands: [`break-${at}`], kind: 'custom' }],
  ]),
  ['font', { longhands: FONT, kind: 'custom' }],
  [
    'font-variant',
    { longhands: FONT.filter((name) => name.startsWith('font-variant-')), kind: 'opaque' },
  ],
  [
    'font-synthesis',
    {
      longhands: ['weight', 'style', 'small-caps'].map((part) => `font-synthesis-${part}`),
      kind: 'opaque',
    },
  ],
  ['transition', { longhands: TRANSITION, kind: 'opaque' }],
  ['animation', { longhands: ANIMATION, kind: 'opaque' }],
  [
    'animation-range',
    { longhands: ['animation-range-start', 'animation-range-end'], kind: 'opaque' },
  ],
  [
    'grid-area',
    {
      longhands: ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
      kind: 'opaque',
    },
  ],
  ['grid-row', { longhands: ['grid-row-start', 'grid-row-end'], kind: 'opaque' }],
  ['grid-column', { longhands: ['grid-column-start', 'grid-column-end'], kind: 'opaque' }],
  [
    'grid-template',
    {
      longhands: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
      kind: 'opaque',
    },
  ],
  [
    'grid',
    {
      longhands: [
        'grid-template-rows',
        'grid-template-columns',
        'grid-template-areas',
        'grid-auto-rows',
        'grid-auto-columns',
        'grid-auto-flow',
      ],
      kind: 'opaque',
    },
  ],
  [
    'mask',
    {
      longhands: [
        'mask-image',
        'mask-position',
        'mask-size',
        'mask-repeat',
        'mask-origin',
        'mask-clip',
        'mask-composite',
        'mask-mode',
      ],
      kind: 'opaque',
    },
  ],
  ['marker', { longhands: ['marker-start', 'marker-mid', 'marker-end'], kind: 'opaque' }],
  [
    'offset',
    {
      longhands: [
        'offset-position',
        'offset-path',
        'offset-distance',
        'offset-rotate',
        'offset-anchor',
      ],
      kind: 'opaque',
    },
  ],
  ['container', { longhands: ['container-name', 'container-type'], kind: 'opaque' }],
  [
    'scroll-timeline',
    { longhands: ['scroll-timeline-name', 'scroll-timeline-axis'], kind: 'opaque' },
  ],
  [
    'view-timeline',
    {
      longhands: ['view-timeline-name', 'view-timeline-axis', 'view-timeline-inset'],
      kind: 'opaque',
    },
  ],
  ['white-space', { longhands: ['white-space-collapse', 'text-wrap-mode'], kind: 'opaque' }],
  ['text-wrap', { longhands: ['text-wrap-mode', 'text-wrap-style'], kind: 'opaque' }],
  ['position-try', { longhands: ['position-try-order', 'position-try-fallbacks'], kind: 'opaque' }],
  [
    '-webkit-text-stroke',
    { longhands: ['-webkit-text-stroke-width', '-webkit-text-stroke-color'], kind: 'any-order' },
  ],
  [
    '-webkit-mask-box-image',
    {
      longhands: [
        '-webkit-mask-box-image-source',
        '-webkit-mask-box-image-slice',
        '-webkit-mask-box-image-width',
        '-webkit-mask-box-image-outset',
        '-webkit-mask-box-image-repeat',
      ],
      kind: 'opaque',
    },
  ],
  [
    'corner-shape',
    {
      longhands: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
        (corner) => `corner-${corner}-shape`,
      ),
      kind: 'box',
    },
  ],
  ['all', { longhands: [], kind: 'custom' }],
]);

/** What `all` sets: every longhand but `direction` and `unicode-bidi`. */
export const ALL_LONGHANDS: readonly string[] = [...LONGHANDS.keys()].filter(
  (name) => name !== 'direction' && name !== 'unicode-bidi',
);

/** The older names of properties, each by the property it is another name for. */
export const ALIASES: ReadonlyMap<string, string> = new Map([
  ['word-wrap', 'overflow-wrap'],
  ['grid-gap', 'gap'],
  ['grid-row-gap', 'row-gap'],
  ['grid-column-gap', 'column-gap'],
  ['-webkit-print-color-adjust', 'print-color-adjust'],
  ['-webkit-border-start', 'border-inline-start'],
  ['-webkit-border-end', 'border-inline-end'],
  ['-webkit-border-before', 'border-block-start'],
  ['-webkit-border-after', 'border-block-end'],
  ['-webkit-margin-start', 'margin-inline-start'],
  ['-webkit-margin-end', 'margin-inline-end'],
  ['-webkit-margin-before', 'margin-block-start'],
  ['-webkit-margin-after', 'margin-block-end'],
  ['-webkit-padding-start', 'padding-inline-start'],
  ['-webkit-padding-end', 'padding-inline-end'],
  ['-webkit-padding-before', 'padding-block-start'],
  ['-webkit-padding-after', 'padding-block-end'],
  ['-webkit-logical-width', 'inline-size'],
  ['-webkit-logical-height', 'block-size'],
  ['-webkit-min-logical-width', 'min-inline-size'],
  ['-webkit-min-logical-height', 'min-block-size'],
  ['-webkit-max-logical-width', 'max-inline-size'],
  ['-webkit-max-logical-height', 'max-block-size'],
  ['-webkit-opacity', 'opacity'],
  ['-webkit-shape-outside', 'shape-outside'],
  ['-webkit-shape-margin', 'shape-margin'],
  ['-webkit-shape-image-threshold', 'shape-image-threshold'],
  ['-webkit-text-orientation', 'text-orientation'],
  ...[
    ...['align-content', 'align-items', 'align-self', 'animation', 'animation-delay'],
    ...['animation-direction', 'animation-duration', 'animation-fill-mode'],
    ...['animation-iteration-count', 'animation-name', 'animation-play-state'],
    ...['animation-timing-function', 'appearance', 'backface-visibility', 'background-clip'],
    ...['background-origin', 'background-size', 'border-bottom-left-radius'],
    ...['border-bottom-right-radius', 'border-radius', 'border-top-left-radius'],
    ...['border-top-right-radius', 'box-shadow', 'box-sizing', 'clip-path', 'column-count'],
    ...['column-gap', 'column-rule', 'column-rule-color', 'column-rule-style'],
    ...['column-rule-width', 'column-span', 'column-width', 'columns', 'filter', 'flex'],
    ...['flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap'],
    ...['font-feature-settings', 'hyphenate-character', 'justify-content', 'mask'],
    ...['mask-clip', 'mask-composite', 'mask-image', 'mask-origin', 'mask-position'],
    ...['mask-repeat', 'mask-size', 'order', 'perspective', 'perspective-origin'],
    ...['text-emphasis', 'text-emphasis-color', 'text-emphasis-position'],
    ...['text-emphasis-style', 'text-size-adjust', 'transform', 'transform-origin'],
    ...['transform-style', 'transition', 'transition-delay', 'transition-duration'],
    ...['transition-property', 'transition-timing-function', 'user-select', 'font-smoothing'],
  ]
    .filter((name) => name !== 'font-smoothing')
    .map((name): [string, string] => [`-webkit-${name}`, name]),
]);

/** The longhands' initial values, where a shorthand that leaves one out sets it to that. */
export const INITIAL: Readonly<Record<string, string>> = {
  ...Object.fromEntries(sided('border-*-width').map((name) => [name, 'medium'])),
  ...Object.fromEntries(sided('border-*-style').map((name) => [name, 'none'])),
  ...Object.fromEntries(sided('border-*-color').map((name) => [name, 'currentcolor'])),
  ...Object.fromEntries(
    ['block-start', 'block-end', 'inline-start', 'inline-end'].flatMap((side) => [
      [`border-${side}-width`, 'medium'],
      [`border-${side}-style`, 'none'],
      [`border-${side}-color`, 'currentcolor'],
    ]),
  ),
  'border-image-source': 'none',
  'border-image-slice': '100%',
  'border-image-width': '1',
  'border-image-outset': '0',
  'border-image-repeat': 'stretch',
  'outline-color': 'auto',
  'outline-style': 'none',
  'outline-width': 'medium',
  'column-rule-width': 'medium',
  'column-rule-style': 'none',
  'column-rule-color': 'currentcolor',
  'column-width': 'auto',
  'column-count': 'auto',
  'list-style-position': 'outside',
  'list-style-image': 'none',
  'list-style-type': 'disc',
  'text-decoration-line': 'none',
  'text-decoration-thickness': 'auto',
  'text-decoration-style': 'solid',
  'text-decoration-color': 'currentcolor',
  'flex-direction': 'row',
  'flex-wrap': 'nowrap',
  'flex-grow': '0',
  'flex-shrink': '1',
  'flex-basis': 'auto',
  'font-style': 'normal',
  'font-variant-ligatures': 'normal',
  'font-variant-caps': 'normal',
  'font-variant-alternates': 'normal',
  'font-variant-numeric': 'normal',
  'font-variant-east-asian': 'normal',
  'font-variant-position': 'normal',
  'font-variant-emoji': 'normal',
  'font-weight': 'normal',
  'font-stretch': 'normal',
  'line-height': 'normal',
  'font-optical-sizing': 'auto',
  'font-size-adjust': 'none',
  'font-kerning': 'auto',
  'font-feature-settings': 'normal',
  'font-variation-settings': 'normal',
  'font-language-override': 'normal',
  '-webkit-text-stroke-width': '0px',
  '-webkit-text-stroke-color': 'currentcolor',
};

/** The descriptors of `@page`, by name: what each takes. */
export const PAGE_DESCRIPTORS: ReadonlyMap<string, string> = new Map([
  ...sided('margin-*').map((name): [string, string] => [name, '<margin-width>']),
  ['size', '<page-size>'],
  ['page-orientation', 'upright | rotate-left | rotate-right'],
  ['marks', 'none | [ crop || cross ]'],
  ['bleed', 'auto | <length>'],
]);

/** The descriptors of `@font-face`, by name: what each takes. */
export const FONT_FACE_DESCRIPTORS: ReadonlyMap<string, string> = new Map(
  [
    ...['font-family', 'src', 'unicode-range', 'font-style', 'font-weight', 'font-stretch'],
    ...['font-display', 'font-feature-settings', 'font-variation-settings', 'ascent-override'],
    ...['descent-override', 'line-gap-override', 'size-adjust', 'font-named-instance'],
    'font-language-override',
  ].map((name): [string, string] => [name, '']),
);
