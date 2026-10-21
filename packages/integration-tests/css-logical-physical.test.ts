/**
 * A logical property and the physical one for the same corner or edge, on one element.
 *
 * `border-start-end-radius` and `border-top-right-radius` name one corner in a left-to-right
 * layout, and CSS settles them as it does any two declarations of a property: the later wins.
 * Both reach a native view as props of their own, and it does not ask which came later: React
 * Native takes the physical corner where it has both, and Yoga the logical edge. So the cascade
 * hands on the winner alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const BASE = { width: 400, height: 800, colorScheme: 'light' as const };

/** One view with `classes`, inside a view with `outer`, under `css`. */
function scene(css: string, classes: string, direction?: 'ltr' | 'rtl', outer = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    conditions: { ...BASE, ...(direction && { direction }) },
  });
  const parent = engine.createElement('view');
  engine.setClasses(parent, outer);
  engine.appendChild(engine.root, parent);
  const node: EngineNode = engine.createElement('view');
  engine.setClasses(node, classes);
  engine.appendChild(parent, node);
  const props = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.children[0]!.props;
  };
  return { engine, node, props };
}

const has = (props: Record<string, unknown>, key: string) => props[key] != null;

const ROUND = '.round { border-radius: 8px }';
const SQUARE_END = '.square-end { border-start-end-radius: 0; border-end-end-radius: 0 }';

describe('a logical corner and a physical one', () => {
  it('is the logical one where it is set later, and the other corners are left', () => {
    const props = scene(`${ROUND} ${SQUARE_END}`, 'round square-end').props();
    assert.equal(props['borderStartEndRadius'], 0);
    assert.equal(props['borderEndEndRadius'], 0);
    assert.equal(has(props, 'borderTopRightRadius'), false);
    assert.equal(has(props, 'borderBottomRightRadius'), false);
    assert.equal(props['borderTopLeftRadius'], 8);
    assert.equal(props['borderBottomLeftRadius'], 8);
  });

  it('is the physical one where that is set later', () => {
    const props = scene(`${SQUARE_END} ${ROUND}`, 'round square-end').props();
    assert.equal(props['borderTopRightRadius'], 8);
    assert.equal(has(props, 'borderStartEndRadius'), false);
    assert.equal(has(props, 'borderEndEndRadius'), false);
  });

  it('pairs the end with the left in a right-to-left layout', () => {
    const props = scene(`${ROUND} ${SQUARE_END}`, 'round square-end', 'rtl').props();
    assert.equal(props['borderStartEndRadius'], 0);
    assert.equal(has(props, 'borderTopLeftRadius'), false);
    assert.equal(has(props, 'borderBottomLeftRadius'), false);
    assert.equal(props['borderTopRightRadius'], 8);
  });

  it('pairs them by the direction the element has, from its own rule or one above it', () => {
    const own = `${ROUND} ${SQUARE_END} .rtl { direction: rtl }`;
    assert.equal(has(scene(own, 'round square-end rtl').props(), 'borderTopLeftRadius'), false);
    const above = scene(own, 'round square-end', undefined, 'rtl').props();
    assert.equal(has(above, 'borderTopLeftRadius'), false);
    assert.equal(above['borderTopRightRadius'], 8);
    // And an element that says left-to-right inside a right-to-left app is left-to-right.
    const back = scene(`${own} .ltr { direction: ltr }`, 'round square-end ltr', 'rtl').props();
    assert.equal(has(back, 'borderTopRightRadius'), false);
    assert.equal(back['borderTopLeftRadius'], 8);
  });

  it('keeps a radius from a token out of the way of a later logical one', () => {
    const css = `:root { --r: 8px } .round { border-radius: var(--r) } ${SQUARE_END}`;
    const props = scene(css, 'round square-end').props();
    assert.equal(props['borderStartEndRadius'], 0);
    assert.equal(has(props, 'borderTopRightRadius'), false);
    assert.equal(props['borderTopLeftRadius'], 8);
  });

  it('keeps a later radius from a token over an earlier logical one', () => {
    const css = `:root { --r: 8px } ${SQUARE_END} .round { border-radius: var(--r) }`;
    const props = scene(css, 'round square-end').props();
    assert.equal(props['borderTopRightRadius'], 8);
    assert.equal(has(props, 'borderStartEndRadius'), false);
  });

  it('keeps an important one whichever is later', () => {
    const css = `.round { border-top-right-radius: 8px !important } ${SQUARE_END}`;
    const props = scene(css, 'round square-end').props();
    assert.equal(props['borderTopRightRadius'], 8);
    assert.equal(has(props, 'borderStartEndRadius'), false);
    assert.equal(props['borderEndEndRadius'], 0, 'the corner the important one does not name');
  });

  it('is the one written later where a rule has both', () => {
    const logical = '.c { border-radius: 8px; border-start-end-radius: 0 }';
    const first = scene(logical, 'c').props();
    assert.equal(first['borderStartEndRadius'], 0);
    assert.equal(has(first, 'borderTopRightRadius'), false);
    const physical = '.c { border-start-end-radius: 0; border-top-right-radius: 8px }';
    const second = scene(physical, 'c').props();
    assert.equal(second['borderTopRightRadius'], 8);
    assert.equal(has(second, 'borderStartEndRadius'), false);
  });

  it('is the one written later where a rule has one from a token and one written out', () => {
    // The token is settled on the device and the literal at build time: two lists, one order.
    const token = ':root { --r: 8px }';
    const later = scene(
      `${token} .c { border-top-right-radius: var(--r); border-start-end-radius: 0 }`,
      'c',
    ).props();
    assert.equal(later['borderStartEndRadius'], 0);
    assert.equal(has(later, 'borderTopRightRadius'), false);
    const earlier = scene(
      `${token} .c { border-start-end-radius: 0; border-top-right-radius: var(--r) }`,
      'c',
    ).props();
    assert.equal(earlier['borderTopRightRadius'], 8);
    assert.equal(has(earlier, 'borderStartEndRadius'), false);
    const both = scene(
      `${token} :root { --s: 2px } .c { border-top-right-radius: var(--r); border-start-end-radius: var(--s) }`,
      'c',
    ).props();
    assert.equal(both['borderStartEndRadius'], 2);
    assert.equal(has(both, 'borderTopRightRadius'), false);
  });

  it('is the important one written later where a rule has both, important', () => {
    const css =
      '.c { border-top-right-radius: 8px !important; border-start-end-radius: 0 !important }';
    const props = scene(css, 'c').props();
    assert.equal(props['borderStartEndRadius'], 0);
    assert.equal(has(props, 'borderTopRightRadius'), false);
    const mixed = scene(
      '.c { border-top-right-radius: 8px !important; border-start-end-radius: 0 }',
      'c',
    ).props();
    assert.equal(mixed['borderTopRightRadius'], 8, 'an important one over a plain one after it');
    assert.equal(has(mixed, 'borderStartEndRadius'), false);
  });

  it('is the one an inline style sets later where it sets both', () => {
    const s = scene('', '');
    s.engine.setProp(s.node, 'style', { borderTopRightRadius: 4, borderStartEndRadius: 0 });
    const logical = s.props();
    assert.equal(logical['borderStartEndRadius'], 0);
    assert.equal(has(logical, 'borderTopRightRadius'), false);
    s.engine.setProp(s.node, 'style', { borderStartEndRadius: 0, borderTopRightRadius: 4 });
    const physical = s.props();
    assert.equal(physical['borderTopRightRadius'], 4);
    assert.equal(has(physical, 'borderStartEndRadius'), false);
  });

  it('takes an inline one over a rule', () => {
    const s = scene(SQUARE_END, 'square-end');
    s.engine.setProp(s.node, 'style', { borderTopRightRadius: 4 });
    const props = s.props();
    assert.equal(props['borderTopRightRadius'], 4);
    assert.equal(has(props, 'borderStartEndRadius'), false);
    assert.equal(props['borderEndEndRadius'], 0);
  });
});

describe('a logical edge and a physical one', () => {
  const edges: [css: string, logical: string, physical: string][] = [
    ['margin-inline-start: 4px | margin-left: 10px', 'marginStart', 'marginLeft'],
    ['padding-inline-end: 4px | padding-right: 10px', 'paddingEnd', 'paddingRight'],
    [
      'border-inline-start-width: 4px | border-left-width: 10px',
      'borderStartWidth',
      'borderLeftWidth',
    ],
    [
      'border-inline-end-color: red | border-right-color: blue',
      'borderEndColor',
      'borderRightColor',
    ],
    ['inset-inline-start: 4px | left: 10px', 'start', 'left'],
  ];

  for (const [css, logical, physical] of edges) {
    const [first, second] = css.split(' | ');
    it(`is the later of ${logical} and ${physical}`, () => {
      const later = scene(`.a { ${first} } .b { ${second} }`, 'a b').props();
      assert.equal(has(later, physical), true);
      assert.equal(has(later, logical), false);
      const earlier = scene(`.b { ${second} } .a { ${first} }`, 'a b').props();
      assert.equal(has(earlier, logical), true);
      assert.equal(has(earlier, physical), false);
    });
  }

  it('pairs the start with the right in a right-to-left layout', () => {
    const css = '.a { margin-inline-start: 4px } .b { margin-right: 10px; margin-left: 2px }';
    const props = scene(css, 'a b', 'rtl').props();
    assert.equal(props['marginRight'], 10);
    assert.equal(has(props, 'marginStart'), false);
    assert.equal(props['marginLeft'], 2);
  });

  it('leaves an edge and the one opposite it both standing', () => {
    const props = scene('.a { margin-inline-start: 4px } .b { margin-right: 10px }', 'a b').props();
    assert.equal(props['marginStart'], 4);
    assert.equal(props['marginRight'], 10);
  });
});

/**
 * A sheet with nesting in it is printed again by lightningcss before it is compiled, to lower the
 * nesting, and its printer folds an equal start and end into the shorthand: `padding-inline: 4px`,
 * which is left and right. A sheet whose only blocks inside blocks are `@media` rules has no
 * nesting to lower, and compiles as it would without them.
 */
describe('a sheet with an @media rule in it', () => {
  const rules = (css: string) => compileCss(css, 'app.css').rules;
  const ruleOf = (css: string, name = 'a') =>
    rules(css).find((rule) => rule.compounds.at(-1)?.classes?.includes(name));
  const MEDIA = '@media (width > 1px) { .b { opacity: 1 } }';

  const pairs: [string, string[]][] = [
    ['padding-inline-start: 4px; padding-inline-end: 4px', ['paddingStart', 'paddingEnd']],
    ['margin-inline-start: 4px; margin-inline-end: 4px', ['marginStart', 'marginEnd']],
    ['inset-inline-start: 4px; inset-inline-end: 4px', ['start', 'end']],
    [
      'border-inline-start-width: 2px; border-inline-end-width: 2px',
      ['borderStartWidth', 'borderEndWidth'],
    ],
    [
      'border-inline-start-color: red; border-inline-end-color: red',
      ['borderStartColor', 'borderEndColor'],
    ],
  ];
  for (const [pair, logical] of pairs) {
    it(`keeps an equal ${logical.join(' and ')} logical`, () => {
      const rule = ruleOf(`.a { ${pair} } ${MEDIA}`)!;
      assert.deepEqual(rule, ruleOf(`.a { ${pair} }`));
      for (const key of logical) assert.equal(has(rule.declarations, key), true, key);
      for (const key of Object.keys(rule.declarations)) {
        assert.doesNotMatch(key, /Left|Right|^left$|^right$/);
      }
    });
  }

  // The order a logical and a physical side were written in is kept, as the later one wins.
  const mixed = [
    'padding: 2px; padding-inline-start: 6px',
    'padding-inline: 2px; padding-inline-end: 6px',
    'margin-right: 2px; margin-inline-start: 6px',
    'inset-inline-start: 6px; left: 2px',
    'border-width: 2px; border-inline-start-width: 6px',
  ];
  for (const css of mixed) {
    it(`compiles ${css} as it would without it`, () => {
      assert.deepEqual(ruleOf(`.a { ${css} } ${MEDIA}`), ruleOf(`.a { ${css} }`));
    });
  }

  it('keeps the pair logical beside a comment, an & in a comment, a string or a url, or nested @media', () => {
    const pair = 'padding-inline-start: 4px; padding-inline-end: 4px';
    const sheets = [
      `/* a & b */ .a { ${pair} } ${MEDIA}`,
      `.a { ${pair}; font-family: "A & B" } ${MEDIA}`,
      `.a { ${pair} } /* note */ ${MEDIA}`,
      `/* note */ @media (width > 1px) { .a { ${pair} } }`,
      `@font-face { font-family: F; src: url(./f.ttf?v=1&w=2) } .a { ${pair} } ${MEDIA}`,
      `@font-face { font-family: F; src: URL( ./f.ttf?v=1&w=2/*x ) } .a { ${pair} } ${MEDIA}`,
      `@media (width > 1px) { @media (height > 1px) { .a { ${pair} } } }`,
      `@layer x { @media (width > 1px) { .a { ${pair} } } }`,
    ];
    for (const css of sheets) {
      const rule = ruleOf(css)!;
      assert.equal(rule.declarations['paddingStart'], 4, css);
      assert.equal(rule.declarations['paddingEnd'], 4, css);
      assert.equal(has(rule.declarations, 'paddingLeft'), false, css);
    }
  });

  it('is still left and right for the shorthand', () => {
    const rule = ruleOf(`.a { padding-inline: 4px } ${MEDIA}`)!;
    assert.equal(rule.declarations['paddingLeft'], 4);
    assert.equal(rule.declarations['paddingRight'], 4);
  });

  it('still lowers a rule nested in a rule, inside or outside an @media rule', () => {
    const lowered = [
      '@media (width > 1px) { .a { .b { opacity: 0.5 } } }',
      '.a { .b { opacity: 0.5 } }',
      '.a { /* } */ .b { opacity: 0.5 } }',
      '.a[title="}"] { .b { opacity: 0.5 } }',
      '.a\\} { .b { opacity: 0.5 } }',
      '.a[title="\\"}"] { .b { opacity: 0.5 } }',
      '.a { .b { opacity: 0.5 }',
      '/* note */ @media (width > 1px) { .a { .b { opacity: 0.5 } } }',
      '@layer x { @media (width > 1px) { .a { .b { opacity: 0.5 } } } }',
      '.a { & .b { opacity: 0.5 } }',
    ];
    for (const css of lowered) {
      const rule = ruleOf(css, 'b');
      assert.equal(rule?.compounds.length, 2, css);
      assert.equal(rule?.declarations['opacity'], 0.5, css);
    }
    const media = rules('.a { @media (width > 1px) { opacity: 0.5 } }');
    assert.equal(media.length, 1);
    assert.equal(media[0]!.declarations['opacity'], 0.5);
  });

  it('reads a stray brace, or a comment or string left open, as before', () => {
    assert.equal(ruleOf('.a { opacity: 1 } /* x')?.declarations['opacity'], 1);
    assert.equal(
      ruleOf("@media (width > 1px) { .a[title='{'] { opacity: 0.5 } }")?.compounds.length,
      1,
    );
    assert.throws(() => rules('.c { opacity: 1 } } .a { .b { opacity: 0.5 } }'), /empty selector/);
    assert.throws(() => rules('.a[title="x] { .b { opacity: 0.5 } }'), /end of input/);
  });
});
