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
    ':root { --gap: 4px; --n: 3; --hue: 120; --rgb: 255, 0, 0; --spaced: 0 0 255; --hsl: 0 100% 50%; --a: 0.25; --word: red; --pct: 100%; --turn: 0.5turn }';
  const cases: readonly [string, string, string, unknown][] = [
    ['calc(var(--gap) * 2)', 'width: var(--x)', 'width', 8],
    ['calc(var(--gap) + 1px)', 'width: var(--x)', 'width', 5],
    ['calc(var(--gap) + var(--gap) * var(--n))', 'width: var(--x)', 'width', 16],
    ['calc(var(--n) * 1px)', 'width: var(--x)', 'width', 3],
    ['calc((var(--gap) - 1px) / 2)', 'width: var(--x)', 'width', 1.5],
    ['calc(var(--missing, 5px) * 2)', 'width: var(--x)', 'width', 10],
    ['calc(var(--missing, 1rem) * 2)', 'width: var(--x)', 'width', 32],
    ['calc(var(--missing, var(--gap)) * 2)', 'width: var(--x)', 'width', 8],
    ['var(--missing, calc(var(--gap) * 2))', 'width: var(--x)', 'width', 8],
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
    // Modern hsl() takes a bare number for a saturation or a lightness, as a percentage.
    ['hsl(var(--hue) 100 50)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(var(--hue) 100 25)', 'color: var(--x)', 'color', 'rgb(0, 128, 0)'],
    ['hsl(var(--hue) 100 50%)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(var(--hue) 100% 25)', 'color: var(--x)', 'color', 'rgb(0, 128, 0)'],
    ['hsl(var(--hue) 100 50 / 0.5)', 'color: var(--x)', 'color', 'rgba(0, 255, 0, 0.5)'],
    ['hsla(var(--hue) 100 50 / var(--a))', 'color: var(--x)', 'color', 'rgba(0, 255, 0, 0.25)'],
    ['hsl(0.5turn var(--pct) 50)', 'color: var(--x)', 'color', 'rgb(0, 255, 255)'],
    ['hsl(240deg var(--pct) 50)', 'color: var(--x)', 'color', BLUE],
    ['hsl(var(--hue) var(--pct) var(--missing, 25))', 'color: var(--x)', 'color', 'rgb(0, 128, 0)'],
    // Out of range, as a browser takes it: a negative saturation is none, an alpha is clamped, and
    // the rest is converted as it is, then clamped into sRGB.
    ['hsl(var(--hue) 150 50)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(200 var(--pct) 25%)', 'color: var(--x)', 'color', 'rgb(0, 85, 128)'],
    ['hsl(var(--missing, 200) 150 25)', 'color: var(--x)', 'color', 'rgb(0, 96, 159)'],
    ['hsl(var(--hue) -10 50)', 'color: var(--x)', 'color', 'rgb(128, 128, 128)'],
    ['hsl(var(--hue) 100 120)', 'color: var(--x)', 'color', 'rgb(255, 255, 255)'],
    ['hsl(var(--hue) 100 50 / 2)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(var(--hue) 100 50 / -1)', 'color: var(--x)', 'color', 'rgba(0, 255, 0, 0)'],
    // A hue token in turns is the angle it is, not the bare number in front of its unit.
    ['hsl(var(--turn) 100 50)', 'color: var(--x)', 'color', 'rgb(0, 255, 255)'],
    // A color-mix() of tokens, each checked against Chrome.
    [
      'color-mix(in srgb, var(--word) 50%, white)',
      'color: var(--x)',
      'color',
      'rgb(255, 128, 128)',
    ],
    ['color-mix(in srgb, 30% var(--word), #00f)', 'color: var(--x)', 'color', 'rgb(77, 0, 179)'],
    [
      'color-mix(in oklab, var(--word) 90%, transparent)',
      'color: var(--x)',
      'color',
      'rgba(255, 0, 0, 0.9)',
    ],
    [
      'color-mix(in hsl, var(--word), rgb(0, 0, 255) 20%)',
      'color: var(--x)',
      'color',
      'rgb(255, 0, 102)',
    ],
    [
      'color-mix(in oklch longer hue, var(--word), blue)',
      'color: var(--x)',
      'color',
      'rgb(0, 138, 14)',
    ],
    [
      'color-mix(in srgb, var(--missing, blue) 50%, white)',
      'color: var(--x)',
      'color',
      'rgb(128, 128, 255)',
    ],
    [
      'color-mix(in srgb, var(--m1, var(--word)) 50%, white)',
      'color: var(--x)',
      'color',
      'rgb(255, 128, 128)',
    ],
    [
      'color-mix(in srgb, var(--missing, hsl(var(--hue) 100% 50%)), white)',
      'color: var(--x)',
      'color',
      'rgb(128, 255, 128)',
    ],
    [
      'color-mix(in srgb, rgb(var(--rgb)) 25%, white)',
      'color: var(--x)',
      'color',
      'rgb(255, 191, 191)',
    ],
    [
      'color-mix(in srgb, hsl(var(--hue) 100% 50%), black)',
      'color: var(--x)',
      'color',
      'rgb(0, 128, 0)',
    ],
    [
      'color-mix(in srgb, color-mix(in srgb, var(--word), var(--word)), white)',
      'color: var(--x)',
      'color',
      'rgb(255, 128, 128)',
    ],
    // A relative colour of a token, each checked against Chrome.
    ['oklch(from var(--word) l c h / 50%)', 'color: var(--x)', 'color', 'rgba(255, 0, 0, 0.5)'],
    ['rgb(from var(--word) r g calc(b + 255))', 'color: var(--x)', 'color', 'rgb(255, 0, 255)'],
    ['hsl(from var(--word) calc(h + 120) s l)', 'color: var(--x)', 'color', 'rgb(0, 255, 0)'],
    ['hsl(from var(--word) h 50% l)', 'color: var(--x)', 'color', 'rgb(191, 64, 64)'],
    ['lab(from var(--word) l a b)', 'color: var(--x)', 'color', 'rgb(255, 0, 0)'],
    ['hwb(from var(--word) h w b / alpha)', 'color: var(--x)', 'color', 'rgb(255, 0, 0)'],
    ['rgb(from var(--word) calc((r + g) / 2) g b)', 'color: var(--x)', 'color', 'rgb(128, 0, 0)'],
    [
      'rgb(from var(--missing, blue) r g b / 0.5)',
      'color: var(--x)',
      'color',
      'rgba(0, 0, 255, 0.5)',
    ],
    [
      'color-mix(in srgb, rgb(from var(--word) r g b / 50%), white)',
      'color: var(--x)',
      'color',
      'rgba(255, 170, 170, 0.75)',
    ],
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
      'var(--missing, calc(var(--none) * 2))',
    ];
    for (const value of lengths) {
      const read = 'width: var(--x, 7px)';
      assert.equal(written(TOKENS, value, read)['width'], 7, `${value} in a stylesheet`);
      assert.equal(set(TOKENS, value, read)['width'], 7, `${value} set on the element`);
    }
    for (const value of [
      'hsl(var(--word) 100% 50%)',
      'rgba(var(--missing), 0.5)',
      'color-mix(in srgb, var(--missing) 50%, white)',
    ]) {
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

  it('mixes a color-mix() of colours written out, set on an element, as a stylesheet does', () => {
    // A stylesheet folds it at build time; set on an element it is mixed where it is set.
    const read = 'color: var(--x, rgb(1, 2, 3))';
    for (const [value, expected] of [
      ['color-mix(in srgb, red 50%, white)', 'rgb(255, 128, 128)'],
      ['color-mix(in srgb, #00f, rgb(255, 0, 0) 30%)', 'rgb(77, 0, 179)'],
      ['rgb(from red r g 255)', 'rgb(255, 0, 255)'],
    ]) {
      assert.equal(written(TOKENS, value!, read)['color'], expected, `${value} in a stylesheet`);
      assert.equal(set(TOKENS, value!, read)['color'], expected, `${value} set on the element`);
    }
  });

  it('drops a shape a stylesheet refuses, rather than sending it to native as it is', () => {
    // A stylesheet stops the build on these; set on an element they are unset, never a colour
    // string with a var() in it.
    const width = 'width: var(--x, 7px)';
    assert.equal(set(TOKENS, 'calc(var(--gap) + 1em)', width)['width'], 7);
    const color = 'color: var(--x, rgb(1, 2, 3))';
    assert.equal(set(TOKENS, 'rgb(var(--n) 0 0)', color)['color'], 'rgb(1, 2, 3)');
    assert.equal(set(TOKENS, 'rgb(var(--rgb)', color)['color'], 'rgb(1, 2, 3)');
    for (const value of [
      'rgb(from var(--word) r g x)',
      'rgb(from var(--word) calc(r + 10%) g b)',
      'rgb(from var(--word) r g)',
      'hsl(from var(--word) 10% s l)',
      'hsl(from var(--word) 10px s l)',
      'color(from var(--word) srgb r g b)',
    ]) {
      assert.throws(() => written(TOKENS, value, color), /relative|cannot express/, value);
      assert.equal(set(TOKENS, value, color)['color'], 'rgb(1, 2, 3)', `${value} set on it`);
    }
  });

  it('refuses an hsl() CSS Color 4 does not allow, in a stylesheet and set on an element', () => {
    // The legacy comma syntax takes a percentage for a saturation and a lightness, never a bare
    // number, and no hue is a percentage: a browser makes nothing of either.
    const color = 'color: var(--x, rgb(1, 2, 3))';
    for (const value of [
      'hsl(var(--hue), 100, 50)',
      'hsla(var(--hue), 100%, 50, 0.5)',
      'hsl(var(--hue), var(--pct), 50)',
      'hsl(50% var(--pct) 50%)',
    ]) {
      assert.throws(
        () => written(TOKENS, value, color),
        /cannot express/,
        `${value} in a stylesheet`,
      );
      assert.equal(
        set(TOKENS, value, color)['color'],
        'rgb(1, 2, 3)',
        `${value} set on the element`,
      );
    }
  });

  it('makes nothing of an hsl() channel token of the wrong kind, and takes no fallback for it', () => {
    // A hue is no percentage, and a saturation, a lightness or an alpha no angle. A token that is
    // set is substituted, so its own fallback is not used when it is the wrong kind: the colour
    // is invalid, and the use site falls back.
    const color = 'color: var(--x, rgb(1, 2, 3))';
    for (const value of [
      'hsl(var(--pct) 100% 50%)',
      'hsl(var(--pct, 120) 100% 50%)',
      'hsl(var(--hue) var(--turn) 50%)',
      'hsl(var(--hue) 100% var(--turn))',
      'hsl(var(--hue) 100% 50% / var(--turn))',
    ]) {
      assert.equal(
        written(TOKENS, value, color)['color'],
        'rgb(1, 2, 3)',
        `${value} in a stylesheet`,
      );
      assert.equal(
        set(TOKENS, value, color)['color'],
        'rgb(1, 2, 3)',
        `${value} set on the element`,
      );
    }
    // The right kinds still are: an angle for a hue, a percentage for an alpha.
    for (const [value, expected] of [
      ['hsl(var(--hue) 100% 50% / var(--pct))', 'rgb(0, 255, 0)'],
      ['hsl(var(--turn) var(--pct) 50%)', 'rgb(0, 255, 255)'],
    ]) {
      assert.equal(written(TOKENS, value!, color)['color'], expected, `${value} in a stylesheet`);
      assert.equal(set(TOKENS, value!, color)['color'], expected, `${value} set on the element`);
    }
  });

  it('makes nothing of an hsl() channel token of the wrong kind set on an element', () => {
    const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
    const hsl = 'hsl(var(--h) var(--s) 50%)';
    for (const [h, s] of [
      ['50%', '100%'],
      ['120', '90deg'],
      ['120', '0.25turn'],
    ]) {
      const customs = [{ '--h': h!, '--s': s!, '--c': hsl }];
      assert.equal(innermost(read, customs)['color'], 'rgb(1, 2, 3)', `${h} ${s}`);
    }
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

  it('mixes a color-mix() with the token an ancestor sets', () => {
    const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
    const mix = { '--c': 'color-mix(in srgb, var(--b) 50%, white)' };
    assert.equal(innermost(read, [{ '--b': 'red' }, mix])['color'], 'rgb(255, 128, 128)');
    assert.equal(innermost(read, [{ '--b': 'blue' }, mix])['color'], 'rgb(128, 128, 255)');
    const cycle = { '--c': 'color-mix(in srgb, var(--c) 50%, white)' };
    assert.equal(innermost(read, [cycle])['color'], 'rgb(1, 2, 3)');
  });

  it('works out a relative colour with the token an ancestor sets', () => {
    const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
    const faded = { '--c': 'rgb(from var(--b) r g b / 50%)' };
    assert.equal(innermost(read, [{ '--b': 'red' }, faded])['color'], 'rgba(255, 0, 0, 0.5)');
    assert.equal(innermost(read, [{ '--b': 'blue' }, faded])['color'], 'rgba(0, 0, 255, 0.5)');
    const sheet = `${read} .x { --c: rgb(from var(--b) r g b / 50%) }`;
    assert.equal(innermost(sheet, [{ '--b': 'blue' }])['color'], 'rgba(0, 0, 255, 0.5)');
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

  it("reads an hsl()'s hue and saturation tokens set on an element as a stylesheet's", () => {
    const hsl = 'hsl(var(--h) var(--s) 50%)';
    const cases: readonly [string, string, string][] = [
      ['0.5turn', '100%', 'rgb(0, 255, 255)'],
      ['90deg', '50%', 'rgb(128, 191, 64)'],
      ['180', '100%', 'rgb(0, 255, 255)'],
    ];
    for (const [h, s, expected] of cases) {
      const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
      const sheet = `:root { --h: ${h}; --s: ${s}; --c: ${hsl} } ${read}`;
      assert.equal(innermost(sheet, [{}])['color'], expected, `${h} ${s} in a stylesheet`);
      const customs = [{ '--h': h, '--s': s, '--c': hsl }];
      assert.equal(innermost(read, customs)['color'], expected, `${h} ${s} set on the element`);
    }
  });
});

describe('an hsl() of tokens reads a token holding a bare saturation or lightness as a percentage', () => {
  // As Chrome does: it substitutes the token's text, then reads the hsl() as if written so.
  const TOKENS = ':root { --h: 200; --s: 100; --l: 50; --p: 100%; --half: 50% }';
  const color = 'color: var(--x, rgb(1, 2, 3))';
  const cases: readonly [string, string][] = [
    ['hsl(var(--h) var(--s) var(--l))', 'rgb(0, 170, 255)'],
    ['hsl(var(--h) var(--p) var(--l))', 'rgb(0, 170, 255)'],
    ['hsl(var(--h) var(--s) var(--half))', 'rgb(0, 170, 255)'],
    ['hsl(var(--h) var(--s) var(--l) / var(--s))', 'rgb(0, 170, 255)'],
    ['hsla(var(--h) var(--l) var(--l) / 0.5)', 'rgba(64, 149, 191, 0.5)'],
    // The legacy comma syntax takes a percentage alone, from a token as written in it.
    ['hsl(var(--h), var(--p), var(--half))', 'rgb(0, 170, 255)'],
    ['hsl(var(--h), var(--s), var(--l))', 'rgb(1, 2, 3)'],
    ['hsla(var(--h), var(--p), var(--l), 0.5)', 'rgb(1, 2, 3)'],
  ];

  for (const [value, expected] of cases) {
    it(value, () => {
      assert.equal(written(TOKENS, value, color)['color'], expected, 'in a stylesheet');
      assert.equal(set(TOKENS, value, color)['color'], expected, 'set on the element');
    });
  }

  it('reads the same tokens set on an element as a stylesheet does', () => {
    const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
    const cases: readonly [string, string, string, string][] = [
      ['hsl(var(--h) var(--s) var(--l))', '100', '50', 'rgb(0, 170, 255)'],
      ['hsl(var(--h) var(--s) var(--l))', '50', '25', 'rgb(32, 74, 96)'],
      ['hsl(var(--h) var(--s) var(--l))', '100%', '50', 'rgb(0, 170, 255)'],
      ['hsl(var(--h), var(--s), var(--l))', '100', '50', 'rgb(1, 2, 3)'],
      ['hsl(var(--h), var(--s), var(--l))', '100%', '50%', 'rgb(0, 170, 255)'],
    ];
    for (const [hsl, s, l, expected] of cases) {
      const sheet = `:root { --h: 200; --s: ${s}; --l: ${l}; --c: ${hsl} } ${read}`;
      assert.equal(innermost(sheet, [{}])['color'], expected, `${hsl} ${s} ${l} in a stylesheet`);
      const customs = [{ '--h': '200', '--s': s, '--l': l, '--c': hsl }];
      assert.equal(innermost(read, customs)['color'], expected, `${hsl} ${s} ${l} set on it`);
    }
  });

  it('reads a calc() token as the percentage or the number it makes', () => {
    // calc(50% * 2) is a percentage and calc(2 * 50) a bare number, both 100% to Chrome here,
    // whether the percentage is a token, a fallback or written in the calc().
    const read = '.x { color: var(--c, rgb(1, 2, 3)) }';
    const hsl = 'hsl(200 var(--s) 50%)';
    for (const s of [
      'calc(var(--half) * 2)',
      'calc(var(--two) * 50)',
      'calc(var(--missing, 50%) * 2)',
      'calc(var(--m1, var(--m2, 50%)) * 2)',
      'calc(var(--two) * 50%)',
      'calc(var(--missing, 50) * 2)',
      'calc(var(--two, 50%) * 50)',
    ]) {
      const sheet = `:root { --half: 50%; --two: 2; --s: ${s}; --c: ${hsl} } ${read}`;
      assert.equal(innermost(sheet, [{}])['color'], 'rgb(0, 170, 255)', `${s} in a stylesheet`);
      const customs = [{ '--half': '50%', '--two': '2', '--s': s, '--c': hsl }];
      assert.equal(innermost(read, customs)['color'], 'rgb(0, 170, 255)', `${s} set on it`);
    }
    // A percentage is a length as well, and a percentage added to a number is neither.
    const width = (s: string) =>
      innermost(`:root { --half: 50%; --s: ${s} } .x { width: var(--s, 7px) }`, [{}])['width'];
    assert.equal(width('calc(var(--half) * 2)'), '100%');
    assert.equal(width('calc(var(--half) + 10)'), 7);
  });
});

describe('arithmetic mixing a percentage and a number is invalid', () => {
  // Each checked against Chrome: a percentage and a number cannot be added or compared, nor
  // multiplied or divided the wrong way round, and the calc() is invalid.
  const TOKENS = ':root { --n: 0.2; --p: 10%; --z: 0 }';
  const read = 'opacity: var(--x, 0.5)';
  const cases: readonly [string, number][] = [
    ['calc(var(--n) + var(--p))', 0.5],
    ['calc(var(--p) + 1)', 0.5],
    ['calc(var(--z) + var(--p))', 0.5],
    ['calc(var(--n) + 10%)', 0.5],
    ['calc(var(--missing, 10%) + 1)', 0.5],
    ['calc(var(--p) * var(--p))', 0.5],
    ['calc(var(--n) / var(--p))', 0.5],
    ['max(var(--p), 1)', 0.5],
    // Of one type, or a percentage scaled by a number, it is still worked out.
    ['calc(var(--n) * var(--p))', 0.02],
    ['calc(var(--p) - 10%)', 0],
    ['calc(var(--n) * 0.2)', 0.04],
    ['calc(var(--p) * 0.2)', 0.02],
  ];

  for (const [value, expected] of cases) {
    it(value, () => {
      assert.equal(written(TOKENS, value, read)['opacity'], expected, 'in a stylesheet');
      assert.equal(set(TOKENS, value, read)['opacity'], expected, 'set on the element');
      const customs = [{ '--n': '0.2', '--p': '10%', '--z': '0', '--x': value }];
      const own = innermost(`.x { ${read} }`, customs)['opacity'];
      assert.equal(own, expected, 'with its tokens set on the element');
    });
  }

  it('leaves a declaration of it unset', () => {
    const opacity = (value: string) =>
      innermost(`${TOKENS} .x { opacity: ${value} }`, [{}])['opacity'];
    assert.equal(opacity('calc(var(--n) + 10%)'), undefined);
    assert.equal(opacity('calc(var(--n) * var(--p))'), 0.02);
  });

  it('makes an hsl() that reads it invalid', () => {
    const own = '--x: calc(var(--n) + var(--p)); --c: hsl(200 var(--x) 50%)';
    const sheet = `${TOKENS} .x { ${own}; color: var(--c, rgb(1, 2, 3)) }`;
    assert.equal(innermost(sheet, [{}])['color'], 'rgb(1, 2, 3)');
  });
});
