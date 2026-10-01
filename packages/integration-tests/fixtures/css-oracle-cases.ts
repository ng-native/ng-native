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
}

export interface OracleCase {
  name: string;
  css: string;
  tree: CaseNode;
  /** Properties measured on this case beside `PROPERTIES`, which must match exactly. */
  extra?: readonly ExtraProperty[];
}

/** The properties a case can measure beyond `PROPERTIES`, and the style key each lands in. */
export const EXTRA_KEYS = {
  'border-top-color': 'borderTopColor',
  'border-left-color': 'borderLeftColor',
  'border-top-width': 'borderTopWidth',
  'outline-color': 'outlineColor',
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
];
