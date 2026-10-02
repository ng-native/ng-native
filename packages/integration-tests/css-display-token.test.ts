/**
 * `display: var(--d)`: the token is read on device, as one of the values native has. `flex`,
 * `none` and `contents` are themselves; `block`, `inline`, `inline-block`, `flow-root` and
 * `inline-flex` are flex, as the compiler reads them written out, and so is each of them in
 * the two-keyword form, `inline flex`. Anything else unsets display, which is flex on native,
 * and says so in development, since native has no grid or table to lay out.
 *
 * Chrome's values for the stylesheet path are in the oracle (`css-oracle-cases.ts`); this covers
 * a token set on an element, and one that changes after the first commit.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = [], dev = false) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'display', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { dev });
  const outer = engine.createElement('view', sheet);
  for (const name of parent) engine.addClass(outer, name);
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(outer, node);
  engine.appendChild(engine.root, outer);
  engine.commit();
  const display = () => fabric.committed[0]!.children[0]!.props['display'];
  return { engine, outer, node, display, warnings };
}

describe('display: var()', () => {
  it('compiles with no warning, and reads a token from the stylesheet', () => {
    const { display, warnings } = tree('.p { --d: none } .a { display: var(--d) }', ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(display(), 'none');
  });

  it('reads a token set on the element, and follows it when it changes', () => {
    const { engine, node, display } = tree('.a { display: none; display: var(--d, none) }');
    assert.equal(display(), 'none');
    const read: Record<string, unknown> = {};
    const values = ['block', 'inline', 'inline-block', 'flow-root', 'inline-flex', 'flex'];
    for (const value of [...values, 'contents', 'none', 'Block']) {
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
      read[value] = display();
    }
    assert.deepEqual(read, {
      block: 'flex',
      inline: 'flex',
      'inline-block': 'flex',
      'flow-root': 'flex',
      'inline-flex': 'flex',
      flex: 'flex',
      contents: 'contents',
      none: 'none',
      Block: 'flex',
    });
  });

  it('follows a token on the parent when it changes', () => {
    const { engine, outer, display } = tree(
      '.p { --d: none } .q { --d: block } .a { display: var(--d) }',
      ['p'],
    );
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(display(), 'flex');
  });

  it('unsets display for a token that is no display value native has, over a weaker rule', () => {
    const { engine, node, display } = tree('.a { display: none } .a.b { display: var(--d) }');
    engine.addClass(node, 'b');
    for (const value of [
      'red',
      'grid',
      '2px',
      'inline-grid',
      'table',
      'block grid',
      '-webkit-box',
    ]) {
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
      // Cleared on native, which commits a removed prop as null: Yoga's default, flex.
      assert.equal(display() ?? undefined, undefined, value);
    }
  });

  it('takes a written fallback and a padded token through the same reading', () => {
    assert.equal(tree('.a { display: var(--missing, block) }').display(), 'flex');
    assert.equal(tree('.a { display: var(--missing,  none ) }').display(), 'none');
    assert.equal(tree('.a { --d:  none ; display: var(--d) }').display(), 'none');
  });
});

/** The two-keyword forms Chrome computes as a display native reads as flex. */
const AS_FLEX = [
  'block flex',
  'inline flex',
  'flex inline',
  'block flow',
  'inline flow',
  'flow',
  'block flow-root',
  'inline flow-root',
  'flow-root inline',
  'INLINE  FLEX',
  'inline\tflex',
];

/** Values Chrome keeps that native has no layout for, or that are no display at all. */
const UNREAD = [
  'grid',
  'inline-grid',
  'block grid',
  'table',
  'table-cell',
  'list-item',
  '-webkit-box',
  'red',
];

describe('display: var() of two keywords', () => {
  it('reads one bound on the element as flex, over a weaker none', () => {
    const { engine, node, display } = tree('.a { display: none } .a.b { display: var(--d) }');
    engine.addClass(node, 'b');
    for (const value of AS_FLEX) {
      engine.setCustomProperty(node, '--d', 'none');
      engine.commit();
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
      assert.equal(display(), 'flex', value);
    }
  });

  it('reads one in the stylesheet as flex', () => {
    for (const value of AS_FLEX.filter((word) => !word.includes('\t'))) {
      const { display } = tree(`.a { --d: ${value}; display: var(--d) }`);
      assert.equal(display(), 'flex', value);
    }
  });
});

describe('display: var() with a written fallback', () => {
  it('refuses at build time a fallback native has no layout for, as it refuses the value', () => {
    for (const value of UNREAD) {
      const { warnings } = tree(`.a { display: var(--missing, ${value}) }`);
      assert.equal(warnings.length, 1, value);
      assert.match(warnings[0]!, /does not exist on native/, value);
    }
  });

  it('still reads the token where it is set, with such a fallback', () => {
    assert.equal(tree('.a { --d: none; display: var(--d, grid) }').display(), 'none');
  });

  it('keeps a fallback of two keywords', () => {
    // It lays out as flex whether or not it is kept, as an unset display does, so this reads the
    // compiled declaration: a lost fallback is the bug, and nothing renders differently.
    for (const value of AS_FLEX.filter((word) => !word.includes('\t'))) {
      const sheet = compileCss(`.a { display: var(--missing, ${value}) }`, 'display');
      assert.equal(sheet.rules[0].deferred[0].fallback, value.replace(/ +/g, ' '), value);
    }
  });
});

describe('display: var() of a value native has no layout for, in development', () => {
  const warnings: string[] = [];
  const warn = console.warn;
  beforeEach(() => {
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  });
  afterEach(() => {
    console.warn = warn;
    warnings.length = 0;
  });
  /** What is said of a display, apart from a token nothing defines, which is said elsewhere. */
  const said = () => warnings.filter((line) => line.includes('display: var('));

  it('names the token and the value bound on the element, once each', () => {
    const { engine, node, display } = tree('.a { display: var(--d) }', [], true);
    for (const value of [...UNREAD, ...UNREAD]) {
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
      assert.equal(display() ?? undefined, undefined, value);
    }
    const reports = said();
    assert.equal(reports.length, UNREAD.length, reports.join('\n'));
    UNREAD.forEach((value, index) => {
      assert.ok(reports[index]!.includes(`display: var(--d) is ${value},`), reports[index]);
    });
  });

  it('names a token from the stylesheet', () => {
    tree('.p { --d: grid } .a { display: var(--d) }', ['p'], true);
    assert.equal(said().length, 1, warnings.join('\n'));
    assert.match(said()[0]!, /display: var\(--d\) is grid,/);
  });

  it('says nothing of a display native has, an unset token or a fallback', () => {
    const { engine, node } = tree('.a { display: var(--d, none) }', [], true);
    for (const value of ['none', 'contents', 'block', 'inline flex', 'Flex']) {
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
    }
    tree('.a { display: var(--missing) }', [], true);
    assert.deepEqual(said(), []);
  });

  it('says nothing when an important display wins over the token', () => {
    const { display } = tree(
      '.p { --d: grid } .a { display: none !important } .a { display: var(--d) }',
      ['p'],
      true,
    );
    assert.equal(display(), 'none');
    assert.deepEqual(said(), []);
  });

  it('says nothing in a release build', () => {
    const { engine, node } = tree('.a { display: var(--d) }');
    engine.setCustomProperty(node, '--d', 'grid');
    engine.commit();
    assert.deepEqual(warnings, []);
  });
});
