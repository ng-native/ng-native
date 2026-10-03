/**
 * Cases for the browser differential suite, shared by the generator and the test so both build
 * exactly the same tree.
 *
 * Colours are the probe. `getComputedStyle` returns them as `rgb(r, g, b)`, which is the very
 * format our own compiler emits, so a comparison is about *which declaration won* rather than
 * about how a value was converted. Every rule uses a distinct sentinel colour, so the winner is
 * identifiable on sight.
 *
 * Element names are `view` and `text`. A browser treats an unknown element as an ordinary inline
 * box and still matches type selectors against it, so the same markup serves both sides.
 */

export interface CaseNode {
  name: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  children?: CaseNode[];
  /**
   * `'none'` for a node a `ViewEncapsulation.None` component's template created: no sheet of its
   * own, and in the browser none of the emulated component's attributes. Any other node was created
   * by the component `css` belongs to.
   */
  scope?: 'none';
}

export interface OracleCase {
  name: string;
  css: string;
  tree: CaseNode;
  /**
   * An app's global sheet, applied to every node before any component's, as an app's `styles`
   * entry is linked in a browser's head before Angular adds a component's styles.
   */
  global?: string;
  /**
   * A `ViewEncapsulation.None` component's sheet, which Angular adds to the document unscoped when
   * the component first renders. With this or `global`, `css` is the sheet of the emulated
   * component that created the tree, and the browser is given it shimmed as Angular shims it.
   */
  none?: string;
  /** Properties measured on this case beside `PROPERTIES`, which must match exactly. */
  extra?: readonly ExtraProperty[];
  /**
   * Custom properties set on the probe as `[style.--t]` sets them: `style.setProperty` in the
   * browser, and the engine's reading of a bound value here.
   */
  bound?: Readonly<Record<string, string>>;
  /** The compiler refuses part of `css` with a warning, for a value native has no form for. */
  warns?: boolean;
}

/** The properties a case can measure beyond `PROPERTIES`, and the style key each lands in. */
export const EXTRA_KEYS = {
  'border-top-color': 'borderTopColor',
  'border-left-color': 'borderLeftColor',
  'border-top-width': 'borderTopWidth',
  'outline-color': 'outlineColor',
  'padding-top': 'paddingTop',
  opacity: 'opacity',
  'text-decoration-color': 'textDecorationColor',
  display: 'display',
  'font-family': 'fontFamily',
  'pointer-events': 'pointerEvents',
} as const;

export type ExtraProperty = keyof typeof EXTRA_KEYS;

export const PROPERTIES = ['color', 'background-color'] as const;

/** What a browser reports when no rule set the property. Ours reports nothing at all. */
export const INITIAL: Record<string, string> = {
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
};

const probe = (extra: Partial<CaseNode> = {}): CaseNode => ({
  name: 'text',
  id: 'probe',
  ...extra,
});

/**
 * `property: var(--t)` over a weaker rule, with the token written in the stylesheet and, as a
 * second case, bound on the probe.
 */
function tokenCases(
  name: string,
  property: string,
  value: string,
  weaker: string,
  extra?: ExtraProperty,
  { use = 'var(--t)', warns = false } = {},
): OracleCase[] {
  const tree = probe({ name: 'view', classes: ['c'] });
  const base = { tree, ...(extra ? { extra: [extra] } : {}) };
  const weakerRule = weaker ? `#probe { ${property}: ${weaker} } ` : '';
  return [
    {
      name: `${name}, in the stylesheet`,
      css: `${weakerRule}#probe.c { --t: ${value}; ${property}: ${use} }`,
      ...(warns ? { warns } : {}),
      ...base,
    },
    {
      name: `${name}, bound on the element`,
      css: `${weakerRule}#probe.c { ${property}: ${use} }`,
      bound: { '--t': value },
      ...base,
    },
  ];
}

/**
 * CSS whitespace is a space, a tab, a newline, a carriage return and a form feed, and only that
 * is trimmed from a token's value. A no-break space or an em space is part of it, so the value is
 * no colour, length, number or display, and the declaration is unset. In a stylesheet the
 * compiler refuses such a colour or number token outright, with a warning; a length or display
 * one is kept as a word.
 */
const TOKEN_KINDS: readonly [string, string, string, string, ExtraProperty | undefined][] = [
  ['a colour token', 'color', 'rgb(1, 0, 0)', 'rgb(2, 0, 0)', undefined],
  ['a length token', 'padding-top', '4px', '9px', 'padding-top'],
  ['a number token', 'opacity', '0.5', '0.25', 'opacity'],
  ['a display token', 'display', 'none', '', 'display'],
];
const PADDING: readonly [string, string, string][] = [
  ['padded with CSS whitespace, which is trimmed', ' \t\n\r\f', '\f\r\n\t '],
  ['after a no-break space, which is kept', '\u00a0', ''],
  ['before a no-break space, which is kept', '', '\u00a0'],
  ['after an em space, which is kept', '\u2003', ''],
];
const WHITESPACE_CASES = TOKEN_KINDS.flatMap(([kind, property, value, weaker, extra]) =>
  PADDING.flatMap(([how, before, after]) => {
    const warns = how.endsWith('kept') && ['color', 'opacity'].includes(property);
    const padded = before + value + after;
    return tokenCases(`whitespace: ${kind} ${how}`, property, padded, weaker, extra, { warns });
  }),
);

/** A family token, which native takes as the first family of the stack, unquoted. */
const FAMILY_CASES = (
  [
    ['a quoted family', "'Inter-Bold'"],
    ['a double-quoted family', '"Inter-Bold"'],
    ['a quoted family containing a comma', '"A,B", monospace'],
    ['a stack', "'Inter Display', sans-serif"],
    ['a family of two words', 'Segoe UI'],
    ['a family with an escaped quote', "'D\\'Angelo', serif"],
    ['a family with a hex escape', "'\\66 oo'"],
    ['a family with an escaped newline, which joins it', "'Foo\\\nBar'"],
  ] as const
).flatMap(([kind, value]) =>
  tokenCases(`font-family: ${kind}`, 'font-family', value, 'monospace', 'font-family'),
);
/**
 * A no-break space is no CSS whitespace inside a value worked out where it is used either: beside a
 * token it is part of a word, so a `calc()` of tokens, or a fallback in one, holding one is invalid,
 * and the declaration that reads it is unset.
 */
const DERIVED_SPACE_CASES = (
  [
    ['after a calc() of tokens', 'calc(var(--two) * 2)\u00a0', true],
    ['before a token in a calc()', 'calc(\u00a0var(--two) * 2)', true],
    ['between a token and an operator in a calc()', 'calc(var(--two)\u00a0* 2)', true],
    // Bound only: lightningcss refuses a stylesheet with a no-break space in a var()'s name.
    ['before the name in a var()', 'var(\u00a0--two)', null],
    ['after the name in a var()', 'var(--two\u00a0)', null],
    // The compiler drops such a fallback without a warning, and the token is unset as in Chrome.
    ['before a fallback in a calc()', 'calc(var(--missing,\u00a02px) * 2)', false],
    ['after a fallback in a calc()', 'calc(var(--missing, 2px\u00a0) * 2)', false],
  ] as const
).flatMap(([where, value, warns]): OracleCase[] => {
  const tree = probe({ name: 'view', classes: ['c'] });
  const name = `no-break space ${where}`;
  const sheet: OracleCase = {
    name: `${name}, in the stylesheet`,
    css: `#probe { --two: 2px; padding-top: 9px } #probe.c { --t: ${value}; padding-top: var(--t) }`,
    ...(warns ? { warns } : {}),
    tree,
    extra: ['padding-top'],
  };
  return [
    ...(warns === null ? [] : [sheet]),
    {
      name: `${name}, bound on the element`,
      css: '#probe { --two: 2px; padding-top: 9px } #probe.c { padding-top: var(--t) }',
      bound: { '--t': value },
      tree,
      extra: ['padding-top'],
    },
  ];
});

/** Colour channels, `rgb(var(--t))`, are split at CSS whitespace and no other. */
const CHANNEL_CASES = (
  [
    ['separated by tabs and newlines', '1\t0\n0', false],
    ['separated by no-break spaces', '1\u00a00\u00a00', false],
    ['with a no-break space after a comma', '1,\u00a00, 0', true],
  ] as const
).flatMap(([how, value, warns]) =>
  tokenCases(`whitespace: channels ${how}`, 'color', value, 'rgb(2, 0, 0)', undefined, {
    use: 'rgb(var(--t))',
    warns,
  }),
);

/**
 * A display token in the two-keyword form, or one native has no layout for. Chrome computes
 * `inline flex` as `inline-flex` and `block flow` as `block`, which native reads as flex; a grid,
 * a table, a list item and the old flexbox keep their own value, and native has none of them.
 */
const DISPLAY_CASES = [
  'block flex',
  'inline flex',
  'flex inline',
  'block flow',
  'inline flow',
  'flow',
  'block flow-root',
  'inline flow-root',
  'grid',
  'inline-grid',
  'block grid',
  'table',
  'table-cell',
  'list-item',
  '-webkit-box',
].flatMap((value) => tokenCases(`display: var() of ${value}`, 'display', value, 'none', 'display'));

export const CASES: OracleCase[] = [
  {
    name: 'specificity: a class beats a type',
    css: 'text { color: rgb(1, 0, 0) } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: 'specificity: an id beats two classes',
    css: '.a.b { color: rgb(1, 0, 0) } #probe { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a', 'b'] }),
  },
  {
    name: 'specificity: two classes beat one',
    css: '.a { color: rgb(1, 0, 0) } .a.b { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a', 'b'] }),
  },
  {
    name: 'source order decides at equal specificity',
    css: '.a { color: rgb(1, 0, 0) } .b { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a', 'b'] }),
  },
  {
    name: 'source order is by rule, not by which class is listed first',
    css: '.b { color: rgb(2, 0, 0) } .a { color: rgb(1, 0, 0) }',
    tree: probe({ classes: ['a', 'b'] }),
  },
  {
    name: 'important beats a later, more specific rule',
    css: '.a { color: rgb(1, 0, 0) !important } #probe.a { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a'] }),
  },
  {
    name: 'an attribute selector weighs the same as a class',
    css: '[data-k] { color: rgb(1, 0, 0) } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'], attrs: { 'data-k': 'v' } }),
  },
  {
    name: 'attribute equality',
    css: '[data-k="yes"] { color: rgb(1, 0, 0) }',
    tree: probe({ attrs: { 'data-k': 'yes' } }),
  },
  {
    name: 'attribute prefix, suffix and substring',
    css: '[data-k^="ab"] { color: rgb(1, 0, 0) } [data-k$="cd"] { background-color: rgb(2, 0, 0) }',
    tree: probe({ attrs: { 'data-k': 'abxcd' } }),
  },
  {
    name: 'attribute word match with a tilde',
    css: '[data-k~="two"] { color: rgb(1, 0, 0) }',
    tree: probe({ attrs: { 'data-k': 'one two three' } }),
  },
  {
    name: 'attribute dash match',
    css: '[data-k|="en"] { color: rgb(1, 0, 0) }',
    tree: probe({ attrs: { 'data-k': 'en-GB' } }),
  },
  {
    name: 'where contributes no specificity',
    css: 'text:where(.a) { color: rgb(1, 0, 0) } text { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a'] }),
  },
  {
    name: 'is takes its most specific argument',
    css: ':is(.a, #probe) { color: rgb(1, 0, 0) } .x.y { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a', 'x', 'y'] }),
  },
  {
    name: 'not takes its argument specificity and excludes',
    css: '.a:not(.b) { color: rgb(1, 0, 0) } .a { background-color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['a'] }),
  },
  {
    name: 'not with several arguments excludes if any matches',
    css: '.a:not(.b, .c) { color: rgb(1, 0, 0) }',
    tree: probe({ classes: ['a', 'c'] }),
  },
  {
    name: 'inheritance: the nearest ancestor wins',
    css: '.outer { color: rgb(1, 0, 0) } .inner { color: rgb(2, 0, 0) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['inner'], children: [probe()] }],
    },
  },
  {
    name: 'inheritance: a value of its own beats anything inherited',
    css: '.outer { color: rgb(1, 0, 0) } #probe { color: rgb(2, 0, 0) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'pointer-events is inherited',
    css: '.outer { pointer-events: none }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
    extra: ['pointer-events'],
  },
  {
    name: 'pointer-events: auto inside none is its own',
    css: '.outer { pointer-events: none } #probe { pointer-events: auto }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
    extra: ['pointer-events'],
  },
  {
    name: "pointer-events: inherit takes the parent's over a weaker rule's auto",
    css: '.outer { pointer-events: none } #probe { pointer-events: auto } #probe.c { pointer-events: inherit }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
    extra: ['pointer-events'],
  },
  {
    name: 'pointer-events: unset is inherit, as the property inherits',
    css: '.outer { pointer-events: none } #probe { pointer-events: auto } #probe.c { pointer-events: unset }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
    extra: ['pointer-events'],
  },
  {
    name: 'pointer-events: initial is auto inside none',
    css: '.outer { pointer-events: none } #probe { pointer-events: initial }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
    extra: ['pointer-events'],
  },
  {
    name: 'pointer-events: an important auto beats a more specific none',
    css: '.outer { pointer-events: none } .c { pointer-events: auto !important } #probe.c { pointer-events: none }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
    extra: ['pointer-events'],
  },
  {
    name: 'pointer-events: none through an ancestor that sets nothing',
    css: '.outer { pointer-events: none }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['inner'], children: [probe()] }],
    },
    extra: ['pointer-events'],
    name: '@layer: an unlayered rule beats a layered one of higher specificity',
    css: '@layer base { #probe.c { color: rgb(1, 0, 0) } } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: an unlayered rule beats a layered one written after it',
    css: '.c { color: rgb(2, 0, 0) } @layer base { #probe.c { color: rgb(1, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a later layer beats an earlier one of higher specificity',
    css: '@layer a { #probe.c { color: rgb(1, 0, 0) } } @layer b { .c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: within a layer, specificity decides',
    css: '@layer a { #probe { color: rgb(1, 0, 0) } .c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a statement sets the order before the blocks',
    css: '@layer b, a; @layer a { .c { color: rgb(1, 0, 0) } } @layer b { #probe { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a layer opened again keeps its first place',
    css: '@layer a { .c { color: rgb(1, 0, 0) } } @layer b { .c { color: rgb(2, 0, 0) } } @layer a { #probe { color: rgb(3, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a layer's own rules beat its nested layers",
    css: '@layer a { @layer x { #probe { color: rgb(1, 0, 0) } } .c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a dotted name is the nested layer',
    css: '@layer a.x { #probe { color: rgb(1, 0, 0) } } @layer a { .c { color: rgb(2, 0, 0) } } @layer b { .c { background-color: rgb(3, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: an anonymous layer is a layer of its own, in order',
    css: '@layer { #probe { color: rgb(1, 0, 0) } } @layer { .c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: !important in a layer beats !important outside one',
    css: '@layer a { .c { color: rgb(1, 0, 0) !important } } #probe { color: rgb(2, 0, 0) !important }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: !important in an earlier layer beats a later layer's",
    css: '@layer a { .c { color: rgb(1, 0, 0) !important } } @layer b { #probe { color: rgb(2, 0, 0) !important } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a layered !important beats an unlayered plain rule',
    css: '@layer a { .c { color: rgb(1, 0, 0) !important } } #probe { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a media query inside a layer keeps the layer',
    css: '@layer a { @media (min-width: 1px) { #probe { color: rgb(1, 0, 0) } } } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a layer inside a media query',
    css: '@media (min-width: 1px) { @layer a { #probe { color: rgb(1, 0, 0) } } } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: '@layer: a property only the layer sets still applies',
    css: '@layer a { .c { background-color: rgb(1, 0, 0) } } .c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: an unlayered rule in the app's sheet beats a component's layered one",
    global: '.c { color: rgb(2, 0, 0) }',
    css: '@layer a { #probe.c { color: rgb(1, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a component's unlayered rule beats a layered one in the app's sheet",
    global: '@layer a { #probe.c { color: rgb(1, 0, 0) } }',
    css: '.c { color: rgb(2, 0, 0) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a layer named later in the app's sheet beats a component's earlier one",
    global: '@layer a, b; @layer b { .c { color: rgb(1, 0, 0) } }',
    css: '@layer a { #probe.c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a component's new layer is named after every layer of the app's sheet",
    global: '@layer x, y, z; @layer y { #probe.c { color: rgb(1, 0, 0) } }',
    css: '@layer mine { .c { color: rgb(2, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a component's layer keeps the place the app's sheet gave that name",
    global: '@layer x, y; @layer y { .c { color: rgb(2, 0, 0) } }',
    css: '@layer x { #probe.c { color: rgb(1, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: "@layer: a component nests a layer in one the app's sheet named",
    global: '@layer base { .c { color: rgb(2, 0, 0) } }',
    css: '@layer base.extra { #probe.c { color: rgb(1, 0, 0) } }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: 'background-color does not inherit',
    css: '.outer { background-color: rgb(1, 0, 0) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'descendant matches any depth, child only one',
    css: '.outer .deep { color: rgb(1, 0, 0) } .outer > .deep { background-color: rgb(2, 0, 0) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', children: [probe({ classes: ['deep'] })] }],
    },
  },
  {
    // The matcher walks right to left and takes the first ancestor that fits. Here the nearest
    // `.b` fails the child combinator while a further one satisfies it, so a matcher that cannot
    // reconsider its choice misses the rule entirely.
    name: 'a combinator that only matches on a further ancestor',
    css: '.a > .b .c { color: rgb(1, 0, 0) }',
    tree: {
      name: 'view',
      classes: ['a'],
      children: [
        {
          name: 'view',
          classes: ['b'],
          children: [
            {
              name: 'view',
              children: [{ name: 'view', classes: ['b'], children: [probe({ classes: ['c'] })] }],
            },
          ],
        },
      ],
    },
  },
  {
    name: 'a custom property resolves to the nearest definition',
    css: '.outer { --c: rgb(1, 0, 0) } .inner { --c: rgb(2, 0, 0) } #probe { color: var(--c) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['inner'], children: [probe()] }],
    },
  },
  {
    name: 'a custom property crosses elements that define nothing',
    css: '.outer { --c: rgb(1, 0, 0) } #probe { color: var(--c) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', children: [{ name: 'view', children: [probe()] }] }],
    },
  },
  {
    name: 'a custom property falls back when undefined',
    css: '#probe { color: var(--missing, rgb(1, 0, 0)) }',
    tree: probe(),
  },
  {
    name: 'a defined custom property beats the fallback',
    css: '.outer { --c: rgb(1, 0, 0) } #probe { color: var(--c, rgb(2, 0, 0)) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    // lightningcss keeps alpha in eight bits, so `.5` arrives as 128/255. A browser prints the
    // shortest decimal that comes back to the same eight bits, and so has to we.
    name: 'a translucent colour reads back as the browser prints it',
    css: '#probe { color: rgba(1, 0, 0, .5); background-color: rgb(2 0 0 / 30%) }',
    tree: probe(),
  },
  {
    name: 'a custom property is itself subject to the cascade',
    css: '.a { --c: rgb(1, 0, 0) } .a.b { --c: rgb(2, 0, 0) } #probe { color: var(--c) }',
    tree: probe({ classes: ['a', 'b'] }),
  },
  {
    name: 'an hsl() of tokens reads a bare saturation and lightness as percentages',
    css:
      ':root { --h: 200; --c: hsl(var(--h) 100 50); --d: hsl(var(--h) 150 25 / 2) } ' +
      '#probe { color: var(--c); background-color: var(--d) }',
    tree: probe(),
  },
  {
    name: 'a var() falls back to a value made of other tokens',
    css:
      ':root { --h: 120; --c: var(--missing, hsl(var(--h) 100% 50%)) } ' +
      '#probe { color: var(--c); background-color: var(--m1, var(--m2, hsl(var(--h) 100% 25%))) }',
    tree: probe(),
  },
  {
    name: 'a cycle through a var() fallback is invalid',
    css:
      ':root { --h: 120; --a: var(--missing, hsl(var(--b) 100% 50%)); --b: var(--a) } ' +
      '#probe { color: var(--a, rgb(1, 0, 0)) }',
    tree: probe(),
  },
  {
    name: 'an hsl() of tokens reads a token holding a bare saturation or lightness as a percentage',
    css:
      ':root { --h: 200; --s: 100; --l: 50; --half: 50%; --x: calc(var(--half) * 2); ' +
      '--c: hsl(var(--h) var(--s) var(--l)); --d: hsla(var(--h) var(--x) var(--l) / 0.5) } ' +
      '#probe { color: var(--c); background-color: var(--d) }',
    tree: probe(),
  },
  {
    name: 'a set token that is invalid where it is used unsets the property, and takes no fallback',
    css:
      ':root { --h: 50%; --c: hsl(var(--h) 50% 50%) } .outer { color: rgb(9, 0, 0) } ' +
      '#probe { color: var(--c, rgb(1, 0, 0)); background-color: var(--c, rgb(2, 0, 0)) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a set token of the wrong kind unsets the property, before any alternative',
    css:
      ':root { --x: 10px; --b: rgb(4, 0, 0) } .outer { color: rgb(9, 0, 0) } ' +
      '#probe { color: var(--x, var(--b, rgb(1, 0, 0))); background-color: var(--x, rgb(2, 0, 0)) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a token set to initial is unset, and one set to inherit takes its parent value',
    css:
      '.outer { --c: rgb(3, 0, 0); --d: rgb(4, 0, 0) } .inner { --c: initial; --d: inherit } ' +
      '#probe { color: var(--c, rgb(1, 0, 0)); background-color: var(--d, rgb(2, 0, 0)) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['inner'], children: [probe()] }],
    },
  },
  {
    name: 'a token made of an invalid token, or naming one, is invalid where it is used',
    css:
      ':root { --h: 50%; --c: hsl(var(--h) 50% 50%); --d: var(--c); ' +
      '--m: color-mix(in srgb, var(--c) 50%, white) } .outer { color: rgb(9, 0, 0) } ' +
      '#probe { color: var(--d, rgb(1, 0, 0)); background-color: var(--m, rgb(2, 0, 0)) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a token whose var() cannot be substituted is unset, and neither inherited nor used',
    css:
      '.outer { --c: rgb(3, 0, 0); color: rgb(9, 0, 0) } ' +
      '.inner { --c: hsl(var(--missing) 50% 50%) } ' +
      '#probe { color: var(--c, rgb(1, 0, 0)); background-color: var(--c, rgb(2, 0, 0)) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['inner'], children: [probe()] }],
    },
  },
  {
    name: 'a color-mix() of a set token of the wrong kind takes no fallback for it',
    css:
      ':root { --c: 10px; --m: color-mix(in srgb, var(--c, red) 50%, white) } ' +
      '.outer { color: rgb(9, 0, 0) } ' +
      '#probe { color: var(--m, rgb(1, 0, 0)); ' +
      'background-color: color-mix(in srgb, var(--c, red) 50%, white) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a declaration invalid once its tokens are known still beats a weaker rule',
    css:
      ':root { --x: 10px } .outer { color: rgb(9, 0, 0) } ' +
      'text { color: rgb(5, 0, 0); background-color: rgb(6, 0, 0) } ' +
      '#probe { color: var(--x, rgb(1, 0, 0)); background-color: var(--missing) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a border with no colour is drawn in the colour of the text',
    css: '#probe { color: rgb(7, 0, 0); border: 2px solid }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a border with no colour is drawn in the colour the element inherits',
    css: '.outer { color: rgb(8, 0, 0) } #probe { border-top: 2px solid }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color'],
  },
  {
    name: "a border with no colour resets a weaker rule's colour to the colour of the text",
    css:
      '.outer { color: rgb(9, 0, 0) } view { border: 2px solid rgb(1, 0, 0) } ' +
      '#probe { border: 3px solid }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a stronger border colour beats a weaker border with none',
    css: '#probe { color: rgb(9, 0, 0); border: 2px solid } #probe.c { border-color: rgb(2, 0, 0) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'border-color: currentColor is the colour of the text',
    css: '.outer { color: rgb(6, 0, 0) } #probe { border-width: 2px; border-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a border of tokens with no colour is drawn in the colour of the text',
    css: '.outer { color: rgb(5, 0, 0) } #probe { --w: 2px; border: var(--w) solid }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a border colour falling back to currentColor is the colour of the text',
    css: '.outer { color: rgb(4, 0, 0) } #probe { border: 2px solid; border-color: var(--c, currentColor) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a currentColor token is the colour of the text where it is used, not where it is set',
    css:
      '.outer { color: rgb(1, 0, 0); --c: currentColor } ' +
      '#probe { color: rgb(3, 0, 0); border: 2px solid rgb(9, 9, 9); border-color: var(--c) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-color', 'border-left-color'],
  },
  {
    name: 'a border of a calc() of a token is as wide as the token works out to',
    css:
      '.outer { color: rgb(2, 0, 0) } ' +
      '#probe { --w: 1px; border-top: calc(var(--w) * 2) solid currentcolor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['border-top-width', 'border-top-color'],
  },
  {
    name: 'an outline with no colour is drawn in the colour of the text',
    css: '#probe { color: rgb(7, 1, 0); outline: 2px solid }',
    tree: probe({ name: 'view' }),
    extra: ['outline-color'],
  },
  {
    name: 'outline-color: currentColor is the colour the element inherits',
    css: '.outer { color: rgb(8, 1, 0) } #probe { outline-style: solid; outline-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['outline-color'],
  },
  {
    name: 'an outline of a token and currentColor is drawn in the colour of the text',
    css: '.outer { color: rgb(9, 1, 0) } #probe { --w: 2px; outline: var(--w) solid currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['outline-color'],
  },
  {
    name: 'an outline colour falling back to currentColor is the colour of the text',
    css: '.outer { color: rgb(6, 1, 0) } #probe { outline: 2px solid; outline-color: var(--c, currentColor) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['outline-color'],
  },
  {
    name: 'background-color: currentColor is the colour of the text',
    css: '#probe { color: rgb(7, 2, 0); background-color: currentColor }',
    tree: probe({ name: 'view' }),
  },
  {
    name: 'background-color: currentColor is the colour the element inherits',
    css: '.outer { color: rgb(8, 2, 0) } #probe { background-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a background of currentColor is the colour of the text',
    css: '.outer { color: rgb(9, 2, 0) } #probe { background: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a background colour falling back to currentColor is the colour of the text',
    css: '.outer { color: rgb(6, 2, 0) } #probe { background-color: var(--c, currentColor) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a background of a currentColor token is the colour of the text where it is used',
    css:
      '.outer { color: rgb(1, 2, 0); --c: currentColor } ' +
      '#probe { color: rgb(5, 2, 0); background-color: var(--c) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a text colour falling back to currentColor is the colour the element inherits',
    css: '.outer { color: rgb(4, 2, 0) } #probe { color: rgb(9, 9, 9); color: var(--c, currentColor) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a border of a calc() of a token below zero is no width at all',
    css: '#probe { --w: 1px; border-top: calc(var(--w) - 2px) solid rgb(3, 3, 0) }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-width'],
  },
  {
    name: 'a border of a calc() that gives a number token its unit is that many pixels wide',
    css: '#probe { --n: 3; border-top: calc(var(--n) * 1px) solid rgb(4, 3, 0) }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-width'],
  },
  {
    name: 'a border of a calc() that leaves a number token without a unit draws no line',
    css: '#probe { --n: 2; border-top: calc(var(--n) * 2) solid rgb(5, 3, 0) }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-width'],
  },
  {
    name: 'a border of a calc() that gives a length token a second unit draws no line',
    css: '#probe { --n: 2px; border-top: calc(var(--n) * 1px) solid rgb(6, 3, 0) }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-width'],
  },
  {
    name: 'a border of a calc() that gives a number token its unit inside a nested calc()',
    css: '#probe { --n: 3; border-top: calc(var(--n) * calc(2 * 1px)) solid rgb(7, 3, 0) }',
    tree: probe({ name: 'view' }),
    extra: ['border-top-width'],
  },
  {
    name: 'color: currentColor is the colour the element inherits',
    css: '.outer { color: rgb(1, 4, 0) } #probe { color: rgb(9, 9, 9); color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'color: currentColor beats a weaker rule and inherits the colour',
    css: '.outer { color: rgb(2, 4, 0) } .c { color: currentColor } text { color: rgb(9, 9, 9) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
  },
  {
    name: 'a background in currentColor beside color: currentColor is the inherited colour',
    css: '.outer { color: rgb(3, 4, 0) } #probe { color: currentColor; background-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: 'a text colour of a currentColor token set on the element is the colour it inherits',
    css: '.outer { color: rgb(4, 4, 0) } #probe { --c: currentColor; color: rgb(9, 9, 9); color: var(--c) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a text colour of a currentColor token is inherited where it is used, not where it is set',
    css:
      '.outer { color: rgb(9, 9, 9); --c: currentColor } .middle { color: rgb(5, 4, 0) } ' +
      '#probe { color: var(--c) }',
    tree: {
      name: 'view',
      classes: ['outer'],
      children: [{ name: 'view', classes: ['middle'], children: [probe()] }],
    },
  },
  {
    name: 'display: var() of a none token hides the element',
    css: '#probe { --d: none; display: var(--d) }',
    tree: probe({ name: 'view' }),
    extra: ['display'],
  },
  {
    name: 'display: var() of a token set on the parent',
    css: '.outer { --d: none } #probe { display: var(--d) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
    extra: ['display'],
  },
  {
    name: 'display: var() of a block token shows an element a weaker rule hid',
    css: '#probe { display: none } #probe.c { --d: block; display: var(--d) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: var() of an inline-block token is shown',
    css: '#probe { display: none } #probe.c { --d: inline-block; display: var(--d) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: var() of a flow-root token is shown',
    css: '#probe { display: none } #probe.c { --d: flow-root; display: var(--d) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: var() of a token in capitals is read as the keyword',
    css: '#probe { --d: NONE; display: var(--d) }',
    tree: probe({ name: 'view' }),
    extra: ['display'],
  },
  {
    name: 'display: var() falls back to a written value when the token is unset',
    css: '#probe { display: var(--missing, none) }',
    tree: probe({ name: 'view' }),
    extra: ['display'],
  },
  {
    name: 'display: var() of a token that is no display value unsets display',
    css: '#probe { display: none } #probe.c { --d: red; display: var(--d) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: var() of an unset token with no fallback unsets display',
    css: '#probe { display: none } #probe.c { display: var(--missing) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: var() of a contents token',
    css: '#probe { --d: contents; display: var(--d) }',
    tree: { name: 'view', children: [probe({ name: 'view' })] },
    extra: ['display'],
  },
  ...DISPLAY_CASES,
  ...WHITESPACE_CASES,
  ...FAMILY_CASES,
  ...tokenCases('a quoted colour token is no colour', 'color', '"rgb(1, 0, 0)"', 'rgb(2, 0, 0)'),
  ...tokenCases('a quoted colour name is no colour', 'color', '"red"', 'rgb(2, 0, 0)'),
  {
    name: 'display: a quoted none token in the stylesheet is no display',
    css: '#probe.c { --t: "none"; display: var(--t) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    name: 'display: a single-quoted none token in the stylesheet is no display',
    css: "#probe.c { --t: 'none'; display: var(--t) }",
    tree: probe({ name: 'view', classes: ['c'] }),
    extra: ['display'],
  },
  {
    // A string is no display, though a family token's quotes come off where a family is read.
    name: 'display: a quoted none token bound on the element is no display',
    css: '#probe.c { display: var(--t) }',
    tree: probe({ name: 'view', classes: ['c'] }),
    bound: { '--t': '"none"' },
    extra: ['display'],
  },
  ...DERIVED_SPACE_CASES,
  ...CHANNEL_CASES,
  {
    name: 'background: var() of a colour token is the background colour',
    css: '#probe { --bg: rgb(1, 0, 0); background: var(--bg) }',
    tree: probe(),
  },
  {
    name: 'background: var() of a token set on the parent',
    css: '.outer { --bg: rgb(2, 0, 0) } #probe { background: var(--bg) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'background: var() beats a weaker background-color',
    css: '#probe { background-color: rgb(3, 0, 0) } #probe.c { --bg: rgb(4, 0, 0); background: var(--bg) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: 'background: var() falls back to a written colour when the token is unset',
    css: '#probe { background: var(--missing, rgb(5, 0, 0)) }',
    tree: probe(),
  },
  {
    name: 'background: var() of a token that is no colour unsets a weaker background-color',
    css: '#probe { background-color: rgb(6, 0, 0) } #probe.c { --bg: 2px; background: var(--bg) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: 'background: var() of an unset token with no fallback unsets a weaker background-color',
    css: '#probe { background-color: rgb(7, 0, 0) } #probe.c { background: var(--missing) }',
    tree: probe({ classes: ['c'] }),
  },
  {
    name: 'background: rgba() of a channel token is the background colour',
    css: '#probe { --rgb: 8, 0, 0; background: rgba(var(--rgb), 0.5) }',
    tree: probe(),
  },
  {
    name: 'background: light-dark() of two tokens is the light one in a light scheme',
    css: '#probe { --l: rgb(9, 0, 0); --d: rgb(10, 0, 0); background: light-dark(var(--l), var(--d)) }',
    tree: probe(),
  },
  {
    name: "background: var() of a currentColor token from the parent is the element's own colour",
    css: '.outer { color: rgb(11, 0, 0); --bg: currentColor } #probe { color: rgb(12, 0, 0); background: var(--bg) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  // A ViewEncapsulation.None component's sheet, which Angular adds to the document unscoped: an
  // app's component (`css`) renders the None component's host, `.none-chip`, which renders
  // `.inner`; `.outside` is the app's own.
  {
    name: 'None: a rule on the host class styles the host',
    css: '',
    none: '.none-chip { background-color: rgb(1, 1, 0) }',
    tree: { name: 'view', children: [probe({ name: 'view', classes: ['none-chip'] })] },
  },
  {
    name: "None: a rule reaches the elements of the None component's own template",
    css: '',
    none: '.inner { color: rgb(2, 1, 0) }',
    tree: {
      name: 'view',
      classes: ['none-chip'],
      children: [probe({ scope: 'none', classes: ['inner'] })],
    },
  },
  {
    name: "None: a rule reaches the app's elements, outside the component",
    css: '',
    none: '.outside { color: rgb(3, 1, 0) }',
    tree: { name: 'view', children: [probe({ classes: ['outside'] })] },
  },
  {
    name: 'None: a type selector reaches every element of that name',
    css: '',
    none: 'text { color: rgb(4, 1, 0) }',
    tree: { name: 'view', children: [probe()] },
  },
  {
    name: 'None: :host and :host-context match nothing',
    css: '',
    none: ':host { color: rgb(5, 1, 0) } :host-context(.dark) { background-color: rgb(5, 2, 0) }',
    tree: {
      name: 'view',
      classes: ['dark'],
      children: [probe({ name: 'view', classes: ['none-chip'] })],
    },
  },
  {
    name: "None: a rule comes after the app's global sheet and wins a tie",
    css: '',
    global: '.k { color: rgb(6, 1, 0) }',
    none: '.k { color: rgb(6, 2, 0) }',
    tree: { name: 'view', children: [probe({ classes: ['k'] })] },
  },
  {
    name: 'None: a more specific global rule still wins',
    css: '',
    global: 'view .k { color: rgb(7, 1, 0) }',
    none: '.k { color: rgb(7, 2, 0) }',
    tree: { name: 'view', children: [probe({ classes: ['k'] })] },
  },
  {
    name: "None: an emulated component's rule of the same selector wins, by its attribute",
    css: '.k { color: rgb(8, 1, 0) }',
    none: '.k { color: rgb(8, 2, 0) }',
    tree: { name: 'view', children: [probe({ classes: ['k'] })] },
  },
  {
    name: "None: a rule as specific as an emulated component's wins the tie, added later",
    css: '.k { color: rgb(9, 1, 0) }',
    none: '.j.k { color: rgb(9, 2, 0) }',
    tree: { name: 'view', children: [probe({ classes: ['j', 'k'] })] },
  },
  {
    name: "None: the app's emulated rule on the host beats the None sheet's",
    css: '.none-chip { background-color: rgb(10, 1, 0) }',
    none: '.none-chip { background-color: rgb(10, 2, 0) }',
    tree: { name: 'view', children: [probe({ name: 'view', classes: ['none-chip'] })] },
  },
  {
    name: "None: the app's emulated sheet does not reach the None component's own elements",
    css: '.inner { color: rgb(11, 1, 0) }',
    none: '.inner { background-color: rgb(11, 2, 0) }',
    tree: {
      name: 'view',
      classes: ['none-chip'],
      children: [probe({ scope: 'none', classes: ['inner'] })],
    },
  },
  {
    name: 'None: a token set on the host by the None sheet cascades to its elements',
    css: '',
    none: '.none-chip { --t: rgb(12, 1, 0) } .inner { color: var(--t) }',
    tree: {
      name: 'view',
      classes: ['none-chip'],
      children: [probe({ scope: 'none', classes: ['inner'] })],
    },
  },
  {
    name: 'color: inherit is the colour the element inherits',
    css: '.outer { color: rgb(1, 5, 0) } #probe { color: rgb(9, 9, 9); color: inherit }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'color: inherit beats a weaker rule and inherits the colour',
    css: '.outer { color: rgb(2, 5, 0) } .c { color: inherit } text { color: rgb(9, 9, 9) }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ classes: ['c'] })] },
  },
  {
    name: 'color: unset is the colour the element inherits, as color is inherited',
    css: '.outer { color: rgb(3, 5, 0) } #probe { color: rgb(9, 9, 9); color: unset }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'a background in currentColor beside color: inherit is the inherited colour',
    css: '.outer { color: rgb(4, 5, 0) } #probe { color: inherit; background-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe({ name: 'view' })] },
  },
  {
    name: "a token of inherit set on the element is the parent's token, not the parent's colour",
    css:
      '.outer { color: rgb(9, 9, 9); --c: rgb(5, 5, 0) } ' +
      '#probe { --c: inherit; color: rgb(9, 9, 8); color: var(--c) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
  },
  {
    name: 'text-decoration-color: currentColor is the colour of the text',
    css:
      '.c { text-decoration-color: rgb(9, 9, 9) } ' +
      '#probe { color: rgb(6, 5, 0); text-decoration-color: currentColor }',
    tree: probe({ classes: ['c'] }),
    extra: ['text-decoration-color'],
  },
  {
    name: 'text-decoration-color: currentColor is the colour the text inherits',
    css: '.outer { color: rgb(7, 5, 0) } #probe { text-decoration-color: currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
    extra: ['text-decoration-color'],
  },
  {
    name: 'text-decoration: underline currentColor is the colour of the text',
    css:
      '.c { text-decoration-color: rgb(9, 9, 9) } ' +
      '#probe { color: rgb(6, 6, 0); text-decoration: underline currentColor }',
    tree: probe({ classes: ['c'] }),
    extra: ['text-decoration-color'],
  },
  {
    name: 'text-decoration: underline currentColor is the colour the text inherits',
    css: '.outer { color: rgb(7, 6, 0) } #probe { text-decoration: underline currentColor }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
    extra: ['text-decoration-color'],
  },
  {
    name: 'a text decoration of a currentColor token set on the element is the colour of the text',
    css: '#probe { color: rgb(8, 5, 0); --c: currentColor; text-decoration-color: var(--c) }',
    tree: probe(),
    extra: ['text-decoration-color'],
  },
  {
    name: 'a text decoration of a currentColor token is the colour where it is used',
    css:
      '.outer { color: rgb(9, 9, 9); --c: currentColor } ' +
      '#probe { color: rgb(9, 5, 0); text-decoration-color: var(--c) }',
    tree: { name: 'view', classes: ['outer'], children: [probe()] },
    extra: ['text-decoration-color'],
  },
];
