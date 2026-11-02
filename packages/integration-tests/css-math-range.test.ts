/**
 * What the oracle rows cannot reach: the ways into a stylesheet's clamp beside a plain rule, and the
 * two lists of props that have to agree. The values themselves are Chrome's, in `css-oracle.test.ts`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, NEVER_NEGATIVE, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const compiled = (css: string) => {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'range', { onUnsupported: (m: string) => warnings.push(m) });
  return { sheet, warnings };
};

describe('a math function below zero in a stylesheet', () => {
  it('is 0 in a nested rule, where the lowering prints it as a plain negative', () => {
    const { sheet, warnings } = compiled('.a { .b { width: calc(1px - 5px) } }');
    assert.deepEqual(warnings, []);
    assert.equal(sheet.rules[0].declarations.width, 0);
  });

  it('is refused written out in a nested rule', () => {
    const { sheet, warnings } = compiled('.a { .b { width: -4px } }');
    assert.equal(sheet.rules.length, 0);
    assert.match(warnings[0]!, /width/);
  });

  it('is refused written out after a nested rule, keeping the value before it', () => {
    const { sheet, warnings } = compiled('.a { width: 7px; .b { color: red } width: -4px }');
    assert.match(warnings[0]!, /nothing below zero/);
    assert.equal(sheet.rules[0].declarations.width, 7);
  });

  it('leaves a negative in quoted text alone, in a selector and in a value', () => {
    const { sheet, warnings } = compiled(
      `[data-note="x; width: -4px more"] { height: 4px } .b { font-family: 'a; width: -4px' }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(sheet.rules.length, 2);
    assert.ok(!JSON.stringify(sheet).includes('__negative'), JSON.stringify(sheet));
  });

  it('tags a negative after a comment with an apostrophe in it', () => {
    const { sheet, warnings } = compiled(`.a { /* don't */ width: -4px; font-family: 'Roboto' }`);
    assert.match(warnings[0]!, /nothing below zero/);
    assert.equal(sheet.rules[0].declarations.width, undefined);
  });

  it('tags a negative in a rule after a comment with an apostrophe in it', () => {
    const { warnings } = compiled(`/* don't */ .a { width: -4px; font-family: 'Roboto' }`);
    assert.match(warnings[0]!, /nothing below zero/);
  });

  it('leaves a negative in a comment alone', () => {
    const { sheet, warnings } = compiled('.a { /* ; width: -4px; */ height: 4px }');
    assert.deepEqual(warnings, []);
    assert.equal(sheet.rules[0].declarations.height, 4);
  });

  it('is 0 in a keyframe', () => {
    const { sheet } = compiled(
      '@keyframes k { from { width: calc(1px - 5px) } to { width: 4px } }',
    );
    assert.equal(sheet.keyframes.k[0].declarations.width, 0);
  });

  it('is 0 in the width of a border shorthand, and keeps its margin', () => {
    const { sheet } = compiled('.a { border: calc(0px - 1px) solid red; margin: calc(0px - 1px) }');
    const { declarations } = sheet.rules[0];
    assert.equal(declarations.borderTopWidth, 0);
    assert.equal(declarations.marginTop, -1);
  });

  it('is told from a negative written out on each shorthand of a width or a radius', () => {
    for (const declaration of [
      'border: -1px solid red',
      'border-top: -1px solid red',
      'outline: -1px solid red',
      'border-width: 1px -1px',
      'border-radius: 1px -1px',
      'flex: 1 1 -2px',
      'padding: -1px 1px !important',
    ]) {
      const { warnings } = compiled(`.a { ${declaration} }`);
      assert.notDeepEqual(warnings, [], declaration);
    }
  });

  it('leaves a zero with a sign, a negative in a function, and every other property', () => {
    const { sheet, warnings } = compiled(
      '.a { width: -0px; height: calc(-1px + 5px); margin-left: -4px; letter-spacing: -1px }',
    );
    assert.deepEqual(warnings, []);
    const { width, height, marginLeft, letterSpacing } = sheet.rules[0].declarations;
    assert.deepEqual([width, height, marginLeft, letterSpacing], [0, 4, -4, -1]);
  });
});

describe('a math function of a length and a number in a stylesheet', () => {
  it('keeps the type of what it folds, through min() and products', () => {
    for (const value of [
      'min(1, 2)',
      'calc(2 * 3 + 1px)',
      'calc(1 + 2 + 1px)',
      'calc(min(1, 2) + min(2, 3) + 1px)',
      'calc(min(1, 2) * min(3, 4) + 1px)',
    ]) {
      const { sheet, warnings } = compiled(`.a { width: ${value} }`);
      assert.equal(sheet.rules.length, 0, value);
      assert.notDeepEqual(warnings, [], value);
    }
  });

  it('takes a number that multiplies a length', () => {
    const { sheet, warnings } = compiled('.a { width: calc(min(1, 2) * 2px + 1px) }');
    assert.deepEqual(warnings, []);
    assert.equal(sheet.rules[0].declarations.width, 3);
  });

  it('says a negative number written out is below zero', () => {
    const { warnings } = compiled('.a { flex-grow: -1 }');
    assert.match(warnings[0]!, /nothing below zero/);
  });
});

describe('the props with nothing below zero', () => {
  it('are one list in the compiler and on the device', () => {
    const { NEVER_NEGATIVE: compiler } = require('@ng-native/metro/css/properties.cjs');
    assert.equal(compiler.source, NEVER_NEGATIVE.source);
  });

  it('take in a token that moves, in both directions', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss('.c { width: calc(var(--t) - 5px) }') as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    const node = renderer.createElement('view') as EngineNode;
    renderer.setAttribute(node, 'class', 'c');
    renderer.setAttribute(node, 'nativeID', 'n');
    renderer.setStyle(node, '--t', '1px');
    renderer.appendChild(engine.root, node);
    engine.commit();
    const width = () =>
      (fabric.committed[0]!.props['style'] as Record<string, unknown> | undefined)?.['width'] ??
      fabric.committed[0]!.props['width'];
    assert.equal(width(), 0);
    renderer.setStyle(node, '--t', '9px');
    engine.commit();
    assert.equal(width(), 4);
    renderer.setStyle(node, '--t', '2px');
    engine.commit();
    assert.equal(width(), 0);
  });

  it('gives way to the rule when refused, and follows the binding out of it', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss('.c { width: 7px }') as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    const node = renderer.createElement('view') as EngineNode;
    renderer.setAttribute(node, 'class', 'c');
    renderer.appendChild(engine.root, node);
    const width = () => {
      engine.commit();
      return (fabric.committed[0]!.props as Record<string, unknown>)['width'];
    };
    renderer.setStyle(node, 'width', 'calc(1px + 1px)');
    assert.equal(width(), 2);
    renderer.setStyle(node, 'width', 'calc(1px + 2)');
    assert.equal(width(), 7, 'refused over a value bound before it');
    renderer.setStyle(node, 'width', 'calc(1px - 5px)');
    assert.equal(width(), 0);
    renderer.removeStyle(node, 'width', 0 as never);
    assert.equal(width(), 7);
  });

  it('leaves a negative written in a token unset, in a rule and on the element', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      '.a { width: 7px } .a.rule { --t: -4px; width: var(--t) } .a.alias { --u: -4px; --t: var(--u); width: var(--t) } .a.math { --t: calc(1px - 5px); width: var(--t) } .a.bound { width: var(--t) }',
    ) as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    const add = (classes: string, bound?: string): EngineNode => {
      const node = renderer.createElement('view') as EngineNode;
      renderer.setAttribute(node, 'class', classes);
      if (bound) renderer.setStyle(node, '--t', bound);
      renderer.appendChild(engine.root, node);
      return node;
    };
    add('a rule');
    add('a alias');
    add('a math');
    add('a bound', '-4px');
    add('a bound', 'calc(1px - 5px)');
    engine.commit();
    const widths = fabric.committed.map((node) => (node.props as Record<string, unknown>)['width']);
    assert.deepEqual(widths, [undefined, undefined, 0, undefined, 0]);
  });

  it('uses a token over a negative fallback, and keeps one on a margin', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      '.a { --x: 5px; width: var(--x, -4px) } .b { margin-left: var(--x, -4px) }',
    ) as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    for (const name of ['a', 'b']) {
      const node = renderer.createElement('view') as EngineNode;
      renderer.setAttribute(node, 'class', name);
      renderer.appendChild(engine.root, node);
    }
    engine.commit();
    const [set, margin] = fabric.committed.map((node) => node.props as Record<string, unknown>);
    assert.equal(set!['width'], 5);
    assert.equal(margin!['marginLeft'], -4);
  });

  it('keeps a negative in a token on a property that takes one', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss('.a { --t: -4px; margin-left: var(--t) }') as StyleSheet;
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    const node = renderer.createElement('view') as EngineNode;
    renderer.setAttribute(node, 'class', 'a');
    renderer.appendChild(engine.root, node);
    engine.commit();
    assert.equal((fabric.committed[0]!.props as Record<string, unknown>)['marginLeft'], -4);
  });
});
