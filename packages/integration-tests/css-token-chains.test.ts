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
import { fileURLToPath } from 'node:url';
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
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/token-chain.ts', import.meta.url)),
    );
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
