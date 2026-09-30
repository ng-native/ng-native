/**
 * A Tailwind theme token the app sets somewhere in the tree, as the web lets it.
 *
 * On the web an element can set `--color-red-500` and every `bg-red-500` inside it follows. The
 * flattener used to substitute a token Tailwind defines only once, so `bg-red-500` held the red
 * itself and nothing inside followed, with nothing to say so. Every theme token is now left for
 * the engine, which resolves `var()` per node against the tokens in scope.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { build, buildV3, committedProps } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string, options?: object): StyleSheet;
};

const compile = (css: string) =>
  compileCss(flattenTailwind(css), 'tailwind', { onUnsupported: () => {} });

/**
 * A parent that sets `custom` (bound, or from `ownSheet` when it wears class `own`), around a
 * child wearing `classes`, beside a sibling wearing the same classes outside it.
 */
function render(
  sheet: StyleSheet,
  classes: string,
  custom: Record<string, string>,
  ownSheet?: StyleSheet,
) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet });
  const parent = engine.createElement('view', ownSheet);
  const inside = engine.createElement('view');
  const outside = engine.createElement('view');
  if (ownSheet) engine.setClasses(parent, 'own');
  for (const [name, value] of Object.entries(custom)) engine.setCustomProperty(parent, name, value);
  engine.setClasses(inside, classes);
  engine.setClasses(outside, classes);
  engine.appendChild(engine.root, parent);
  engine.appendChild(parent, inside);
  engine.appendChild(engine.root, outside);
  engine.commit();
  return { inside: committedProps(fabric, inside), outside: committedProps(fabric, outside) };
}

describe('a Tailwind 4 theme token the app sets', () => {
  let css: string;
  before(() => {
    css = build('native', 'bg-red-500 bg-blue-500 p-4 shadow-lg shadow-red-500');
  });

  it('reaches the utility that reads it, inside the element that sets it', () => {
    const sheet = compile(css);
    const { inside } = render(sheet, 'bg-red-500', { '--color-red-500': 'rgb(0, 0, 255)' });
    assert.equal(inside['backgroundColor'], 'rgb(0, 0, 255)');
  });

  it('leaves the theme value everywhere else', () => {
    const sheet = compile(css);
    const plain = compile(css);
    const { outside } = render(sheet, 'bg-red-500', { '--color-red-500': 'rgb(0, 0, 255)' });
    const reference = render(plain, 'bg-red-500', {}).outside;
    assert.equal(outside['backgroundColor'], reference['backgroundColor']);
  });

  it('reaches the spacing scale, through the calc() it is multiplied in', () => {
    const sheet = compile(css);
    const { inside, outside } = render(sheet, 'p-4', { '--spacing': '2px' });
    assert.equal(inside['paddingTop'], 8);
    assert.equal(outside['paddingTop'], 16);
  });

  it('reaches a shadow coloured by it, through the color-mix() Tailwind wraps it in', () => {
    const sheet = compile(css);
    const shadow = (props: Record<string, unknown>) =>
      (props['boxShadow'] as { color: string }[] | undefined)?.[0]?.color;
    const { inside, outside } = render(sheet, 'shadow-lg shadow-red-500', {
      '--color-red-500': 'rgb(0, 0, 255)',
    });
    const plain = render(compile(css), 'shadow-lg shadow-red-500', {}).outside;
    assert.equal(shadow(outside), shadow(plain));
    assert.notEqual(shadow(inside), shadow(plain));
    assert.match(String(shadow(inside)), /^rgba?\(0, 0, 255/);
  });

  it('leaves an alias of it at the value it had where the theme defines it, as the web does', () => {
    // `@theme { --color-primary: var(--color-blue-500) }`: on the web the alias is worked out on
    // the root, so setting --color-blue-500 lower down does not reach bg-primary.
    const theme =
      ':root, :host { --color-blue-500: rgb(43, 127, 255); ' +
      '--color-primary: var(--color-blue-500) }\n' +
      '.bg-primary { background-color: var(--color-primary) }\n' +
      '.bg-blue-500 { background-color: var(--color-blue-500) }\n';
    const sheet = compile(theme);
    const set = { '--color-blue-500': 'rgb(1, 2, 3)' };
    assert.equal(render(sheet, 'bg-primary', set).inside['backgroundColor'], 'rgb(43, 127, 255)');
    assert.equal(render(sheet, 'bg-blue-500', set).inside['backgroundColor'], 'rgb(1, 2, 3)');
    const both = compile(theme);
    const primary = { '--color-primary': 'rgb(4, 5, 6)' };
    assert.equal(render(both, 'bg-primary', primary).inside['backgroundColor'], 'rgb(4, 5, 6)');
    assert.equal(render(both, 'bg-primary', set).inside['backgroundColor'], 'rgb(43, 127, 255)');
  });

  it('reaches a translate and a line height built from the spacing scale', () => {
    // Two translate classes make --tw-translate-x a token each sets and translate reads.
    const spaced = build('native', 'translate-x-4 translate-x-8 leading-6');
    const sheet = compile(spaced);
    const translateX = (props: Record<string, unknown>) =>
      Object.assign({}, ...((props['transform'] as object[] | undefined) ?? []))['translateX'];
    const moved = render(sheet, 'translate-x-4', { '--spacing': '2px' });
    assert.equal(translateX(moved.inside), 8);
    assert.equal(translateX(moved.outside), 16);
    const lines = render(sheet, 'leading-6', { '--spacing': '2px' });
    assert.equal(lines.inside['lineHeight'], 12);
    assert.equal(lines.outside['lineHeight'], 24);
  });

  it('keeps the type scale on whole points', () => {
    // `--text-sm--line-height: calc(1.25 / .875)`, rounded and then multiplied back up by the
    // font size, was 20.006 rather than the 20 a browser draws.
    const type = build('native', 'text-xs text-sm text-lg text-2xl');
    const sheet = compile(type);
    const lineHeight = (c: string) => render(sheet, c, {}).outside['lineHeight'];
    assert.deepEqual(
      ['text-xs', 'text-sm', 'text-lg', 'text-2xl'].map(lineHeight),
      [16, 20, 28, 32],
    );
  });

  it('keeps a token live where it is read with a fallback', () => {
    // Taken out of the substitution map, `var(--c, red)` was substituted by its fallback instead.
    const sheet = compile(':root { --c: rgb(0, 128, 0) } .a { color: var(--c, red) }');
    const { inside, outside } = render(sheet, 'a', { '--c': 'rgb(0, 0, 255)' });
    assert.equal(inside['color'], 'rgb(0, 0, 255)');
    assert.equal(outside['color'], 'rgb(0, 128, 0)');
  });

  it('reads a declaration whole, a semicolon inside a string and all', () => {
    const out = flattenTailwind(
      ':root { --font-x: Avenir } .a { font-family: var(--font-x, "A;B"); color: red }',
    );
    assert.match(out, /font-family: var\(--font-x, "A;B"\)/);
  });
});

describe('a Tailwind 3 colour from a token the app sets', () => {
  it('reaches the utility, from a component stylesheet', () => {
    const css = buildV3(
      'bg-primary',
      { theme: { extend: { colors: { primary: 'var(--primary)' } } } },
      ':root { --primary: rgb(255, 0, 0) }',
    );
    const sheet = compile(css);
    const own = compileCss('.own { --primary: rgb(0, 0, 255) }', 'card');
    const { inside, outside } = render(sheet, 'bg-primary', {}, own);
    assert.equal(inside['backgroundColor'], 'rgb(0, 0, 255)');
    assert.equal(outside['backgroundColor'], 'rgb(255, 0, 0)');
  });
});

describe('a Tailwind 3 colour from a token of channels', () => {
  it('reaches the utility, from a component stylesheet, as shadcn themes one', () => {
    const css = buildV3(
      'bg-primary',
      { theme: { extend: { colors: { primary: 'hsl(var(--primary))' } } } },
      ':root { --primary: 0 100% 50% }',
    );
    const sheet = compile(css);
    const own = compileCss('.own { --primary: 240 100% 50% }', 'card');
    const { inside, outside } = render(sheet, 'bg-primary', {}, own);
    assert.equal(inside['backgroundColor'], 'rgb(0, 0, 255)');
    assert.equal(outside['backgroundColor'], 'rgb(255, 0, 0)');
  });

  it('keeps the opacity modifier, from the alpha-value form Tailwind 3 documents', () => {
    const css = buildV3(
      'bg-primary bg-primary/50',
      { theme: { extend: { colors: { primary: 'rgb(var(--primary) / <alpha-value>)' } } } },
      ':root { --primary: 255 0 0 }',
    );
    const sheet = compile(css);
    const { inside, outside } = render(sheet, 'bg-primary/50', { '--primary': '0 0 255' });
    assert.equal(inside['backgroundColor'], 'rgba(0, 0, 255, 0.5)');
    assert.equal(outside['backgroundColor'], 'rgba(255, 0, 0, 0.5)');
  });
});

describe('a Tailwind 3 colour from a token, faded by an opacity class', () => {
  // `bg-opacity-50` sets --tw-bg-opacity, which `bg-primary`'s `hsl(var(--primary) /
  // var(--tw-bg-opacity, 1))` reads: substituted with bg-primary's own 1, it never faded.
  const css = () =>
    buildV3(
      'bg-primary bg-opacity-50',
      { theme: { extend: { colors: { primary: 'hsl(var(--primary) / <alpha-value>)' } } } },
      ':root { --primary: 0 100% 50% }',
    );

  it('fades when nothing sets the token', () => {
    const { outside } = render(compile(css()), 'bg-primary bg-opacity-50', {});
    assert.equal(outside['backgroundColor'], 'rgba(255, 0, 0, 0.5)');
  });

  it('fades, and follows, when the app sets it', () => {
    const sheet = compile(css());
    const { inside, outside } = render(sheet, 'bg-primary bg-opacity-50', {
      '--primary': '240 100% 50%',
    });
    assert.equal(inside['backgroundColor'], 'rgba(0, 0, 255, 0.5)');
    assert.equal(outside['backgroundColor'], 'rgba(255, 0, 0, 0.5)');
    assert.equal(render(sheet, 'bg-primary', {}).outside['backgroundColor'], 'rgb(255, 0, 0)');
  });
});
