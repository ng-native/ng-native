/**
 * A custom property whose value is another `var()`, as a component sets its own variable to a
 * design token and its classes read the variable.
 *
 * Substituted where it is defined, against the tokens in scope there, and passed down resolved,
 * as a browser computes it. A cycle makes every property in it invalid, so a use site takes its
 * own fallback, and nothing loops.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { build, committedProps } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(source: string, context?: string): StyleSheet;
};
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

after(cleanup);

const LIGHT = 'rgb(59, 110, 245)';
const DARK = 'rgb(122, 160, 255)';
const RED = 'rgb(255, 0, 0)';
const GREEN = 'rgb(0, 128, 0)';
const BLUE = 'rgb(0, 0, 255)';

const GLOBAL = `
  :root { --brand: ${LIGHT} }
  .dark { --brand: ${DARK} }
  .fill { background-color: var(--fill-color) }
  .ink { color: var(--fill-color, rgb(0, 0, 0)) }
`;

interface Fixture {
  dark: { set(value: boolean): void };
  brand: { set(value: string | null): void };
}

describe('a custom property set on an element to another var()', () => {
  let Host: Type<Fixture>;
  let fabric: FakeFabric;
  let result: Awaited<ReturnType<typeof render>>;

  const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);
  const props = (id: string): Record<string, unknown> => {
    const node = flatten(fabric.committed).find((n) => n.props['nativeID'] === id);
    assert.ok(node, `a node with nativeID ${id}`);
    return node.props;
  };
  const fill = (id: string) => props(id)['backgroundColor'];

  before(async () => {
    const mod = await compileFixture('fixtures/token-chain.ts');
    Host = mod['TokenChain'] as Type<Fixture>;
  });

  const boot = async () => {
    result = await render(Host, { globalStyles: compileCss(GLOBAL, 'global') });
    fabric = result.fabric;
  };

  it('resolves to the token it names, bound or written in a style attribute', async () => {
    await boot();
    assert.equal(fill('bound'), LIGHT);
    assert.equal(fill('static'), LIGHT);
    assert.equal(fill('literal'), 'rgb(255, 0, 0)');
  });

  it('passes the resolved value down to what is inside', async () => {
    await boot();
    assert.equal(props('inside')['color'], LIGHT);
  });

  it('takes a fallback, written or itself a var()', async () => {
    await boot();
    assert.equal(fill('fallback'), LIGHT);
    assert.equal(fill('written'), 'rgb(0, 128, 0)');
  });

  it('follows a theme that redefines the token it names', async () => {
    await boot();
    (result.instance as Fixture).dark.set(true);
    await result.rerender();
    assert.equal(fill('bound'), DARK);
    assert.equal(fill('static'), DARK);
    assert.equal(fill('fallback'), DARK);
    assert.equal(props('inside')['color'], DARK);
    (result.instance as Fixture).dark.set(false);
    await result.rerender();
    assert.equal(fill('bound'), LIGHT);
  });

  it('follows an ancestor that sets the token it names at run time', async () => {
    await boot();
    (result.instance as Fixture).brand.set('rgb(1, 2, 3)');
    await result.rerender();
    assert.equal(fill('bound'), 'rgb(1, 2, 3)');
    assert.equal(fill('static'), 'rgb(1, 2, 3)');
    (result.instance as Fixture).brand.set(null);
    await result.rerender();
    assert.equal(fill('bound'), LIGHT);
  });
});

/** The props the innermost of a chain of views commits with, each setting custom properties. */
function innermost(
  css: string,
  className: string,
  customs: readonly Record<string, string>[],
): Record<string, unknown> {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'global') });
  let parent = engine.root;
  let node = parent;
  for (const custom of customs) {
    node = engine.createElement('view', null);
    for (const [name, value] of Object.entries(custom)) engine.setCustomProperty(node, name, value);
    engine.appendChild(parent, node);
    parent = node;
  }
  engine.addClass(node, className);
  engine.commit();
  return committedProps(fabric, node);
}

describe('a chain of var() in a stylesheet', () => {
  const color = (css: string, customs: readonly Record<string, string>[] = [{}]) =>
    innermost(css, 'x', customs)['color'];

  it('resolves through each link', () => {
    assert.equal(color(':root { --a: red; --b: var(--a) } .x { color: var(--b) }'), RED);
    assert.equal(
      color(':root { --a: red; --b: var(--a); --c: var(--b) } .x { color: var(--c) }'),
      RED,
    );
  });

  it("is substituted where it is defined, so a descendant's redefinition does not reach it", () => {
    // As in a browser: `--b` on :root is computed on :root, from the `--a` there.
    const css = ':root { --a: red; --b: var(--a) } .x { color: var(--b) }';
    assert.equal(color(css, [{ '--a': 'rgb(0, 0, 255)' }]), RED);
  });

  it('takes a fallback that is itself a var()', () => {
    const css = ':root { --a: red; --b: var(--missing, var(--a)) } .x { color: var(--b) }';
    assert.equal(color(css), RED);
    const deeper = ':root { --a: red; --b: var(--m1, var(--m2, var(--a))) } .x { color: var(--b) }';
    assert.equal(color(deeper), RED);
  });

  it('makes every property in a cycle invalid, so the use site falls back', () => {
    const css = ':root { --a: var(--b, red); --b: var(--a, blue) } .x { color: var(--a, green) }';
    assert.equal(color(css), GREEN);
    const self = ':root { --a: var(--a, red) } .x { color: var(--a, green) }';
    assert.equal(color(self), GREEN);
  });

  it('resolves a chain that ends at a token made of others, defined alongside it', () => {
    // An hsl() of tokens, a colour of channels or a calc() is worked out after the aliases are
    // followed, so every link on the way to one has to be followed again, not only the last.
    const hsl = ':root { --hue: 0; --c: hsl(var(--hue), 100%, 50%); --b: var(--c); --a: var(--b) }';
    assert.equal(color(`${hsl} .x { color: var(--a) }`), RED);
    assert.equal(color(`${hsl} .x { color: var(--b) }`), RED, 'the link next to it');
    const channels =
      ':root { --rgb: 255, 0, 0; --c: rgba(var(--rgb), 1); --b: var(--c); --a: var(--b) }';
    assert.equal(color(`${channels} .x { color: var(--a) }`), 'rgba(255, 0, 0, 1)');
    const fallback =
      ':root { --hue: 0; --c: hsl(var(--hue), 100%, 50%); --a: var(--none, var(--c)) }';
    assert.equal(color(`${fallback} .x { color: var(--a) }`), RED, 'through a fallback');
  });

  it('takes the fallback of a property outside a cycle that names one', () => {
    const css =
      ':root { --a: var(--b); --b: var(--a); --c: var(--a, rgb(0, 128, 0)) } .x { color: var(--c) }';
    assert.equal(color(css), 'rgb(0, 128, 0)');
  });
});

describe('a chain of var() set on elements', () => {
  const color = (customs: readonly Record<string, string>[], css = '') =>
    innermost(`${css} .x { color: var(--c, green) }`, 'x', customs)['color'];

  it('resolves through links set on the element and its ancestors', () => {
    assert.equal(
      color([{ '--a': 'rgb(255, 0, 0)' }, { '--b': 'var(--a)' }, { '--c': 'var(--b)' }]),
      RED,
    );
    assert.equal(color([{ '--a': 'rgb(255, 0, 0)', '--b': 'var(--a)', '--c': 'var(--b)' }]), RED);
  });

  it('keeps a comma inside a fallback', () => {
    assert.equal(color([{ '--c': 'var(--missing, rgb(1, 2, 3))' }]), 'rgb(1, 2, 3)');
  });

  it('treats a cycle as invalid and never loops', () => {
    assert.equal(color([{ '--a': 'var(--c)', '--c': 'var(--a)' }]), GREEN);
    assert.equal(color([{ '--c': 'var(--c, rgb(255, 0, 0))' }]), GREEN);
  });

  it('resolves a long chain', () => {
    const links: Record<string, string> = { '--l0': 'rgb(255, 0, 0)' };
    for (let i = 1; i < 200; i++) links[`--l${i}`] = `var(--l${i - 1})`;
    links['--c'] = 'var(--l199)';
    assert.equal(color([links]), RED);
    const backwards = Object.fromEntries(Object.entries(links).reverse());
    assert.equal(color([backwards]), RED, 'whichever order the links are set in');
  });

  it('reads a stylesheet token, and a nearer one set on an ancestor', () => {
    const css = ':root { --a: red }';
    assert.equal(color([{ '--c': 'var(--a)' }], css), RED);
    assert.equal(color([{ '--a': 'rgb(0, 0, 255)' }, { '--c': 'var(--a)' }], css), BLUE);
  });
});

describe('a chain of var() through Tailwind', () => {
  let sheet: StyleSheet;

  before(() => {
    const css = build(
      'native',
      'bg-(--fill-color) text-brand dark',
      '@theme { --color-brand: rgb(1, 2, 3); } .dark { --color-brand: rgb(4, 5, 6); }',
    );
    sheet = compileCss(flattenTailwind(css), 'tailwind');
  });

  const background = (dark: boolean, value: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    const theme = engine.createElement('view', null);
    if (dark) engine.addClass(theme, 'dark');
    const node = engine.createElement('view', null);
    engine.addClass(node, 'bg-(--fill-color)');
    engine.setCustomProperty(node, '--fill-color', value);
    engine.appendChild(theme, node);
    engine.appendChild(engine.root, theme);
    engine.commit();
    return committedProps(fabric, node)['backgroundColor'];
  };

  it('resolves an arbitrary value set to a theme token', () => {
    assert.equal(background(false, 'var(--color-brand)'), 'rgb(1, 2, 3)');
    assert.equal(background(true, 'var(--color-brand)'), 'rgb(4, 5, 6)');
  });
});

describe('a var() whose fallback is made of other tokens', () => {
  const TOKENS = ':root { --gap: 8px; --n: 3; --hue: 120 }';

  /** A view with `--x: value` set on it, and `own` beside it, reading it through `read`. */
  const set = (value: string, read: string, own: Record<string, string> = {}) =>
    innermost(`${TOKENS} .x { ${read} }`, 'x', [{ ...own, '--x': value }]);
  /** The same, with `--x: value` in the rule that reads it. */
  const written = (value: string, read: string) =>
    innermost(`${TOKENS} .x { --x: ${value}; ${read} }`, 'x', [{}]);
  /** `value` as the declaration itself, not a token. */
  const declared = (property: string, value: string, own: Record<string, string> = {}) =>
    innermost(`${TOKENS} .x { ${property}: ${value} }`, 'x', [own]);

  const cases: readonly [string, string, unknown][] = [
    ['var(--missing, calc(var(--gap) * 2))', 'width', 16],
    ['var(--m1, var(--m2, calc(var(--gap) * 2)))', 'width', 16],
    ['var(--missing, max(var(--gap), 10px))', 'width', 10],
    ['var(--gap, calc(var(--n) * 1px))', 'width', 8],
    ['calc(var(--missing, calc(var(--gap) * 2)) + 1px)', 'width', 17],
    ['calc(var(--m1, var(--m2, 3px)) * 2)', 'width', 6],
    ['calc(var(--m1, var(--gap)) * 2)', 'width', 16],
    ['var(--missing, calc(var(--n) / 10))', 'opacity', 0.3],
    ['var(--missing, hsl(var(--hue) 100% 50%))', 'color', 'rgb(0, 255, 0)'],
  ];

  for (const [value, property, expected] of cases) {
    it(value, () => {
      const unset = { width: '99px', opacity: '0.99', color: 'rgb(1, 2, 3)' }[property];
      const read = `${property}: var(--x, ${unset})`;
      assert.equal(written(value, read)[property], expected, 'a token in a stylesheet');
      assert.equal(set(value, read)[property], expected, 'a token set on the element');
      assert.equal(declared(property, value)[property], expected, 'the declaration itself');
    });
  }

  it('works the fallback out from the tokens where it is read', () => {
    const value = 'var(--missing, calc(var(--gap) * 2))';
    assert.equal(declared('width', value, { '--gap': '3px' })['width'], 6);
    assert.equal(set(value, 'width: var(--x)', { '--gap': '3px' })['width'], 6);
  });

  it('treats a cycle through a fallback as invalid and never loops', () => {
    const read = 'width: var(--x, 7px)';
    for (const value of [
      'var(--missing, calc(var(--x) * 2))',
      'var(--m1, var(--m2, calc(var(--x) + 1px)))',
      'calc(var(--missing, calc(var(--x) * 2)) + 1px)',
    ]) {
      assert.equal(written(value, read)['width'], 7, `${value} in a stylesheet`);
      assert.equal(set(value, read)['width'], 7, `${value} set on the element`);
    }
    const value = 'var(--missing, calc(var(--y) * 2))';
    assert.equal(set(value, read, { '--y': 'var(--x)' })['width'], 7, 'set on the element');
    const sheet = `${TOKENS} .x { --x: ${value}; --y: var(--x); ${read} }`;
    assert.equal(innermost(sheet, 'x', [{}])['width'], 7, 'in a stylesheet');
  });

  it('follows a theme and an ancestor that change a token the fallback reads', () => {
    const fabric = createFakeFabric();
    const css = `${TOKENS} .dark { --gap: 10px } .x { width: var(--x, 7px) }`;
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'global') });
    const theme = engine.createElement('view', null);
    const node = engine.createElement('view', null);
    engine.setCustomProperty(node, '--x', 'var(--missing, calc(var(--gap) * 2))');
    engine.addClass(node, 'x');
    engine.appendChild(theme, node);
    engine.appendChild(engine.root, theme);
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 16);
    engine.addClass(theme, 'dark');
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 20);
    engine.setCustomProperty(theme, '--gap', '1px');
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 2);
    engine.setCustomProperty(theme, '--missing', '5px');
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 5);
  });

  it('settles tokens defined together as a browser does, whatever order they are in', () => {
    // Each checked against Chrome. A fallback is taken only for a token that is unset or invalid,
    // never for one not yet worked out; a cycle is every token in it and no other, counting only
    // the references substituted.
    const cases: readonly [Record<string, string>, number][] = [
      // A link to an invalid token takes the link's own fallback.
      [{ '--r': 'var(--b, 7px)', '--b': 'calc(var(--unset) * 2)' }, 7],
      [
        { '--t': 'calc(var(--unset) * 2)', '--r': 'calc(var(--a) + 1px)', '--a': 'var(--t, 7px)' },
        8,
      ],
      // A token read inside its own fallback is a cycle, whatever that fallback is.
      [{ '--r': 'var(--missing, calc(var(--r, 3px) * 2))' }, 9],
      [{ '--r': 'calc(var(--r, 3px) * 2)' }, 9],
      // A token worked out later is waited for, not taken as unset.
      [
        {
          '--r': 'var(--missing, calc(var(--b, 1px) * 2))',
          '--b': 'calc(var(--g) * 3)',
          '--g': '8px',
        },
        48,
      ],
      [{ '--r': 'calc(var(--b, 1px) * 2)', '--b': 'calc(var(--g) * 3)', '--g': '8px' }, 48],
      // A fallback that is not substituted is no reference, and so no cycle.
      [{ '--c': 'var(--g, 1px)', '--r': 'var(--c, var(--b))', '--b': 'var(--r)' }, 1],
      // A token outside a cycle that reads one takes its fallback.
      [
        {
          '--a': 'calc(var(--b) + 1px)',
          '--b': 'calc(var(--a) + 1px)',
          '--r': 'calc(var(--a, 5px) * 2)',
        },
        10,
      ],
      [
        {
          '--a': 'var(--m, calc(var(--b) + 1px))',
          '--b': 'calc(var(--a) + 1px)',
          '--r': 'var(--a, 5px)',
        },
        5,
      ],
    ];
    const read = 'width: var(--r, 9px)';
    for (const [tokens, expected] of cases) {
      for (const order of [tokens, Object.fromEntries(Object.entries(tokens).reverse())]) {
        const written = Object.entries(order).map(([name, value]) => `${name}: ${value}`);
        const sheet = `.x { ${written.join('; ')}; ${read} }`;
        const what = JSON.stringify(order);
        assert.equal(innermost(sheet, 'x', [{}])['width'], expected, `${what} in a stylesheet`);
        const set = innermost(`.x { ${read} }`, 'x', [order])['width'];
        assert.equal(set, expected, `${what} set on the element`);
      }
    }
  });
});

describe('a var() fallback made of other tokens inside a colour', () => {
  // Each checked against Chrome, which reports the sky mix unrounded, 212.5 green: the same mix
  // of a token holding rgb(0, 170, 255) paints 212 here.
  const TOKENS = ':root { --h: 200; --brand: rgb(10, 20, 30); --rgb: 255, 0, 0 }';
  const mix = (colour: string) => `color-mix(in srgb, ${colour} 50%, white)`;
  const gradient = (colour: string) => `linear-gradient(${colour}, black)`;
  const stops = (colour: string) => [
    { color: colour, position: null },
    { color: 'black', position: null },
  ];
  /** What `property: value` paints, with `own` set on the view and `TOKENS` above it. */
  const painted = (property: string, value: string, own: Record<string, string> = {}) => {
    const props = innermost(`${TOKENS} .x { ${property}: ${value} }`, 'x', [own]);
    if (property === 'background-color') return props['backgroundColor'];
    const image = props['experimental_backgroundImage'] as { colorStops: unknown }[] | undefined;
    return image?.[0]?.colorStops;
  };

  const colours: readonly [string, string][] = [
    [mix('var(--missing, hsl(var(--h) 100% 50%))'), 'rgb(128, 212, 255)'],
    [mix('var(--m1, var(--m2, hsl(var(--h) 100% 50%)))'), 'rgb(128, 212, 255)'],
    [mix('var(--missing, rgba(var(--rgb), 0.5))'), 'rgba(255, 170, 170, 0.75)'],
    [mix('var(--missing, var(--brand))'), 'rgb(133, 138, 143)'],
  ];

  for (const [value, expected] of colours) {
    it(value, () => {
      assert.equal(painted('background-color', value), expected, 'the declaration itself');
      const read = 'background-color: var(--c, rgb(1, 2, 3))';
      const token = innermost(`${TOKENS} .x { --c: ${value}; ${read} }`, 'x', [{}]);
      assert.equal(token['backgroundColor'], expected, 'a token in a stylesheet');
    });
  }

  it('paints a gradient stop from a fallback made of other tokens', () => {
    const hsl = gradient('var(--missing, hsl(var(--h) 100% 50%))');
    assert.deepEqual(painted('background-image', hsl), stops('rgb(0, 170, 255)'));
    const mixed = gradient(`var(--missing, ${mix('var(--brand)')})`);
    assert.deepEqual(painted('background-image', mixed), stops('rgb(133, 138, 143)'));
  });

  it('paints a shadow from a fallback made of other tokens', () => {
    const shadow = '0 0 2px var(--missing, hsl(var(--h) 100% 50%))';
    const props = innermost(`${TOKENS} .x { box-shadow: ${shadow} }`, 'x', [{ '--h': '120' }]);
    assert.equal((props['boxShadow'] as { color: string }[])[0]!.color, 'rgb(0, 255, 0)');
  });

  it('works the fallback out from the tokens set on the element', () => {
    const hsl = mix('var(--missing, hsl(var(--h) 100% 50%))');
    assert.equal(painted('background-color', hsl, { '--h': '120' }), 'rgb(128, 255, 128)');
    const rgba = mix('var(--missing, rgba(var(--rgb), 0.5))');
    const blue = painted('background-color', rgba, { '--rgb': '0, 0, 255' });
    assert.equal(blue, 'rgba(170, 170, 255, 0.75)');
    const stop = gradient('var(--missing, hsl(var(--h) 100% 50%))');
    assert.deepEqual(painted('background-image', stop, { '--h': '120' }), stops('rgb(0, 255, 0)'));
  });

  it('is invalid in a cycle, and paints nothing when a token it needs is not set', () => {
    const read = 'background-color: var(--c, rgb(1, 2, 3))';
    const cycle = mix('var(--missing, hsl(var(--c) 100% 50%))');
    const cyclic = innermost(`${TOKENS} .x { --c: ${cycle}; ${read} }`, 'x', [{}]);
    assert.equal(cyclic['backgroundColor'], 'rgb(1, 2, 3)');
    // A fallback that is not substituted is no reference, and so no cycle, as in Chrome.
    const unused = mix('var(--brand, hsl(var(--c) 100% 50%))');
    const valid = innermost(`${TOKENS} .x { --c: ${unused}; ${read} }`, 'x', [{}]);
    assert.equal(valid['backgroundColor'], 'rgb(133, 138, 143)');
    const unset = mix('var(--missing, hsl(var(--nope) 100% 50%))');
    assert.equal(painted('background-color', unset), undefined);
  });

  it('follows a theme and an ancestor that change what the fallback reads', () => {
    const fabric = createFakeFabric();
    const value = mix('var(--missing, hsl(var(--h) 100% 50%))');
    const css = `${TOKENS} .dark { --h: 120 } .x { background-color: ${value} }`;
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'global') });
    const theme = engine.createElement('view', null);
    const node = engine.createElement('view', null);
    engine.addClass(node, 'x');
    engine.appendChild(theme, node);
    engine.appendChild(engine.root, theme);
    engine.commit();
    assert.equal(committedProps(fabric, node)['backgroundColor'], 'rgb(128, 212, 255)');
    engine.addClass(theme, 'dark');
    engine.commit();
    assert.equal(committedProps(fabric, node)['backgroundColor'], 'rgb(128, 255, 128)');
    engine.setCustomProperty(theme, '--missing', 'red');
    engine.commit();
    assert.equal(committedProps(fabric, node)['backgroundColor'], 'rgb(255, 128, 128)');
  });
});
