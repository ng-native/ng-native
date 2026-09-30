/**
 * A custom property set on an element to a value with a `var()` inside it: arithmetic,
 * `calc(var(--gap) * 2)`, or a colour made of tokens, `hsl(var(--hue) 100% 50%)` or
 * `rgba(var(--rgb), 0.5)`.
 *
 * Worked out where it is set, against the tokens in scope there, as the same text in a stylesheet
 * is, and following them when a theme or an ancestor changes one.
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
import { committedProps } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(source: string, context?: string): StyleSheet;
};

after(cleanup);

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

const GLOBAL = `
  :root { --gap: 4px; --hue: 0; --rgb: 255, 0, 0 }
  .dark { --gap: 10px; --hue: 240; --rgb: 0, 0, 255 }
  .sized { width: var(--size) }
  .fill { background-color: var(--fill) }
`;

interface Fixture {
  dark: { set(value: boolean): void };
  gap: { set(value: string | null): void };
}

describe('a custom property set on an element to a value with a var() inside it', () => {
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

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/token-arithmetic.ts', import.meta.url)),
    );
    Host = mod['TokenArithmetic'] as Type<Fixture>;
  });

  const boot = async () => {
    result = await render(Host, { globalStyles: compileCss(GLOBAL, 'global') });
    fabric = result.fabric;
  };

  it('works out a calc() of a token, bound or written in a style attribute', async () => {
    await boot();
    assert.equal(props('bound-calc')['width'], 8);
    assert.equal(props('static-calc')['width'], 8);
  });

  it('works out a colour of tokens, bound or written in a style attribute', async () => {
    await boot();
    assert.equal(props('bound-hsl')['backgroundColor'], RED);
    assert.equal(props('static-hsl')['backgroundColor'], RED);
    assert.equal(props('bound-rgb')['backgroundColor'], 'rgba(255, 0, 0, 0.5)');
    assert.equal(props('static-rgb')['backgroundColor'], 'rgba(255, 0, 0, 0.5)');
  });

  it('follows a theme that redefines a token inside it', async () => {
    await boot();
    (result.instance as Fixture).dark.set(true);
    await result.rerender();
    assert.equal(props('bound-calc')['width'], 20);
    assert.equal(props('static-calc')['width'], 20);
    assert.equal(props('bound-hsl')['backgroundColor'], BLUE);
    assert.equal(props('static-rgb')['backgroundColor'], 'rgba(0, 0, 255, 0.5)');
    (result.instance as Fixture).dark.set(false);
    await result.rerender();
    assert.equal(props('bound-calc')['width'], 8);
    assert.equal(props('bound-hsl')['backgroundColor'], RED);
  });

  it('follows an ancestor that sets a token inside it at run time', async () => {
    await boot();
    (result.instance as Fixture).gap.set('3px');
    await result.rerender();
    assert.equal(props('bound-calc')['width'], 6);
    assert.equal(props('static-calc')['width'], 6);
    (result.instance as Fixture).gap.set(null);
    await result.rerender();
    assert.equal(props('bound-calc')['width'], 8);
  });
});

/** The props a view commits with, setting `--x` to `value`, under a root with `css`. */
function set(css: string, value: string, read: string): Record<string, unknown> {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(`${css} .x { ${read} }`, 'g') });
  const node = engine.createElement('view', null);
  engine.setCustomProperty(node, '--x', value);
  engine.addClass(node, 'x');
  engine.appendChild(engine.root, node);
  engine.commit();
  return committedProps(fabric, node);
}

/** The same, with `--x: value` in a stylesheet rule on the view instead. */
function written(css: string, value: string, read: string): Record<string, unknown> {
  const fabric = createFakeFabric();
  const sheet = compileCss(`${css} .x { --x: ${value}; ${read} }`, 'g');
  const engine = new Engine(fabric, 1, { globalStyles: sheet });
  const node = engine.createElement('view', null);
  engine.addClass(node, 'x');
  engine.appendChild(engine.root, node);
  engine.commit();
  return committedProps(fabric, node);
}

describe('a value with a var() inside it resolves as the same text in a stylesheet does', () => {
  const TOKENS =
    ':root { --gap: 4px; --n: 3; --hue: 120; --rgb: 255, 0, 0; --spaced: 0 0 255; --hsl: 0 100% 50%; --a: 0.25; --word: red }';
  const cases: readonly [string, string, string, unknown][] = [
    ['calc(var(--gap) * 2)', 'width: var(--x)', 'width', 8],
    ['calc(var(--gap) + 1px)', 'width: var(--x)', 'width', 5],
    ['calc(var(--gap) + var(--gap) * var(--n))', 'width: var(--x)', 'width', 16],
    ['calc(var(--n) * 1px)', 'width: var(--x)', 'width', 3],
    ['calc((var(--gap) - 1px) / 2)', 'width: var(--x)', 'width', 1.5],
    ['calc(var(--missing, 5px) * 2)', 'width: var(--x)', 'width', 10],
    ['calc(var(--missing, 1rem) * 2)', 'width: var(--x)', 'width', 32],
    ['calc(var(--n) / 10)', 'opacity: var(--x)', 'opacity', 0.3],
    ['calc(var(--n) * 10%)', 'opacity: var(--x)', 'opacity', 0.3],
    ['max(var(--gap), 6px)', 'width: var(--x)', 'width', 6],
    ['hsl(var(--hue) 100% 50%)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(var(--hue), 100%, 50%)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsla(var(--hue), 100%, 50%, var(--a))', 'color: var(--x)', 'color', 'rgba(0, 255, 0, 0.25)'],
    ['rgb(var(--rgb))', 'color: var(--x)', 'color', RED],
    ['rgba(var(--rgb), 0.5)', 'color: var(--x)', 'color', 'rgba(255, 0, 0, 0.5)'],
    ['rgb(var(--spaced) / var(--a))', 'color: var(--x)', 'color', 'rgba(0, 0, 255, 0.25)'],
    ['hsl(var(--hsl))', 'color: var(--x)', 'color', RED],
  ];

  for (const [value, read, prop, expected] of cases) {
    it(value, () => {
      assert.equal(written(TOKENS, value, read)[prop], expected, 'in a stylesheet');
      assert.equal(set(TOKENS, value, read)[prop], expected, 'set on the element');
    });
  }

  it('drops a value its tokens make nothing of, so a use site takes its fallback', () => {
    const lengths = [
      'calc(var(--word) * 2)',
      'calc(var(--missing) * 2)',
      'calc(var(--gap) / 0)',
      'calc(var(--x) * 2)',
      'var(--missing, calc(var(--gap) * 2))',
    ];
    for (const value of lengths) {
      const read = 'width: var(--x, 7px)';
      assert.equal(written(TOKENS, value, read)['width'], 7, `${value} in a stylesheet`);
      assert.equal(set(TOKENS, value, read)['width'], 7, `${value} set on the element`);
    }
    for (const value of ['hsl(var(--word) 100% 50%)', 'rgba(var(--missing), 0.5)']) {
      const read = 'color: var(--x, rgb(1, 2, 3))';
      assert.equal(
        written(TOKENS, value, read)['color'],
        'rgb(1, 2, 3)',
        `${value} in a stylesheet`,
      );
      assert.equal(
        set(TOKENS, value, read)['color'],
        'rgb(1, 2, 3)',
        `${value} set on the element`,
      );
    }
  });

  it('drops a shape a stylesheet refuses, rather than sending it to native as it is', () => {
    // A stylesheet stops the build on these; set on an element they are unset, never a colour
    // string with a var() in it.
    const width = 'width: var(--x, 7px)';
    assert.equal(set(TOKENS, 'calc(var(--missing, var(--gap)) * 2)', width)['width'], 7);
    assert.equal(set(TOKENS, 'calc(var(--gap) + 1em)', width)['width'], 7);
    const color = 'color: var(--x, rgb(1, 2, 3))';
    assert.equal(set(TOKENS, 'rgb(var(--n) 0 0)', color)['color'], 'rgb(1, 2, 3)');
    assert.equal(set(TOKENS, 'rgb(var(--rgb)', color)['color'], 'rgb(1, 2, 3)');
  });
});

/** The props the innermost of a chain of views commits with, each setting custom properties. */
function innermost(css: string, customs: readonly Record<string, string>[]) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'g') });
  let parent = engine.root;
  for (const custom of customs) {
    const node = engine.createElement('view', null);
    for (const [name, value] of Object.entries(custom)) engine.setCustomProperty(node, name, value);
    engine.appendChild(parent, node);
    parent = node;
  }
  engine.addClass(parent, 'x');
  engine.commit();
  return committedProps(fabric, parent);
}

describe('a value with a var() inside it among others set on elements', () => {
  const width = (customs: readonly Record<string, string>[]) =>
    innermost('.x { width: var(--size, 7px) }', customs)['width'];

  it('reads a token set beside it, or on an ancestor', () => {
    assert.equal(width([{ '--gap': '4px', '--size': 'calc(var(--gap) * 2)' }]), 8);
    assert.equal(width([{ '--size': 'calc(var(--gap) * 2)', '--gap': '4px' }]), 8);
    assert.equal(width([{ '--gap': '4px' }, { '--size': 'calc(var(--gap) * 2)' }]), 8);
    assert.equal(
      width([{ '--gap': '4px', '--g': 'var(--gap)', '--size': 'calc(var(--g) * 2)' }]),
      8,
    );
  });

  it('treats a cycle through arithmetic as invalid and never loops', () => {
    assert.equal(width([{ '--size': 'calc(var(--size) * 2)' }]), 7);
    assert.equal(width([{ '--size': '4px' }, { '--size': 'calc(var(--size) * 2)' }]), 7);
    assert.equal(width([{ '--size': 'calc(var(--a) + 1px)', '--a': 'calc(var(--size) * 2)' }]), 7);
    assert.equal(width([{ '--size': 'calc(var(--a) + 1px)', '--a': 'var(--size)' }]), 7);
  });

  it('is replaced when the binding changes, and removed when it is unset', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(':root { --gap: 4px } .x { width: var(--size, 7px) }', 'g'),
    });
    const node = engine.createElement('view', null);
    engine.addClass(node, 'x');
    engine.appendChild(engine.root, node);
    engine.setCustomProperty(node, '--size', 'calc(var(--gap) * 2)');
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 8);
    engine.setCustomProperty(node, '--size', 'calc(var(--gap) * 3)');
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 12);
    engine.setCustomProperty(node, '--size', null);
    engine.commit();
    assert.equal(committedProps(fabric, node)['width'], 7);
  });
});
