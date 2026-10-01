/**
 * `display: var(--d)`: the token is read on device, as one of the values native has. `flex`,
 * `none` and `contents` are themselves; `block`, `inline`, `inline-block`, `flow-root` and
 * `inline-flex` are flex, as the compiler reads them written out; anything else unsets display,
 * as Chrome does.
 *
 * Chrome's values for the stylesheet path are in the oracle (`css-oracle-cases.ts`); this covers
 * a token set on an element, and one that changes after the first commit.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = []) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'display', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
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
    for (const value of ['red', 'grid', '2px']) {
      engine.setCustomProperty(node, '--d', value);
      engine.commit();
      // Cleared on native, which commits a removed prop as null: Yoga's default, flex.
      assert.equal(display() ?? undefined, undefined, value);
    }
  });

  it('takes a written fallback through the same reading', () => {
    assert.equal(tree('.a { display: var(--missing, block) }').display(), 'flex');
    assert.equal(tree('.a { display: var(--missing, none) }').display(), 'none');
  });
});
