/**
 * A custom property set on an element at run time (`[style.--x]`, through
 * `Engine.setCustomProperty`) is read as the same text in a stylesheet is, for the shapes a
 * binding holds: a `calc()` or `min()` of lengths, a `rem`, an `em`, a line height multiple and
 * the sides of a padding.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const BASE = ':root { --gap: 6px } .p { font-size: 20px }';

/** What `.k` commits with `--x` set on its parent: by a rule, or by `setCustomProperty`. */
function committed(use: string, value: string | number, how: 'sheet' | 'inline', extra = '') {
  const css = `${BASE} .k { ${use} } ${extra}` + (how === 'sheet' ? ` .n { --x: ${value} }` : '');
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(css, 'app.css') as StyleSheet,
      dev: true,
    });
    const make = (classes: string, parent = engine.root) => {
      const node = engine.createElement('view');
      engine.declareElement('view');
      engine.setClasses(node, classes);
      engine.appendChild(parent, node);
      return node;
    };
    const n = make('n', make('p'));
    make('k', n);
    if (how === 'inline') engine.setCustomProperty(n, '--x', value);
    engine.commit();
    return { props: fabric.committed[0]!.children[0]!.children[0]!.props, warnings };
  } finally {
    console.warn = warn;
  }
}

const same = (use: string, value: string | number, key: string, extra = '') => {
  const sheet = committed(use, value, 'sheet', extra).props[key];
  const inline = committed(use, value, 'inline', extra);
  assert.notEqual(sheet, undefined, 'the stylesheet reads it');
  assert.equal(inline.props[key], sheet, `inline warnings: ${JSON.stringify(inline.warnings)}`);
};

describe('a custom property set on an element', () => {
  it('control: is a length in px', () => same('width: var(--x)', '10px', 'width'));
  it('control: is a calc() with a var() in it', () =>
    same('width: var(--x)', 'calc(var(--gap) * 2)', 'width'));

  it('is a calc() of lengths with no var() in it', () =>
    same('width: var(--x)', 'calc(10px * 2)', 'width'));
  it('is a calc() of px and rem', () => same('width: var(--x)', 'calc(1rem + 2px)', 'width'));
  it('is a min() of lengths', () => same('width: var(--x)', 'min(10px, 2rem)', 'width'));

  it('is a line height multiple as a number', () =>
    same('line-height: var(--x)', 1.5, 'lineHeight'));
  it('is a line height multiple that a child with a font size of its own takes as a multiple', () =>
    // Set on the parent, at 20 points, and taken by a child at 10: 15, not the parent's 30.
    same('font-size: 10px', 1.5, 'lineHeight', '.n { line-height: var(--x) }'));
  it('is a line height multiple as text', () => same('line-height: var(--x)', '1.5', 'lineHeight'));

  it('is a length in rem', () => same('width: var(--x)', '1rem', 'width'));
  it('is a length in em', () => same('width: var(--x)', '2em', 'width'));
  it('is two lengths, for a padding', () => same('padding: var(--x)', '8px 16px', 'paddingLeft'));
});

it('is no list of sides for five lengths, which no side shorthand takes', () => {
  const { props } = committed('padding: var(--x)', '1px 2px 3px 4px 5px', 'inline');
  assert.equal(props['paddingLeft'], undefined);
});
