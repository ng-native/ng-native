/**
 * The custom properties in scope at a node, where the node's own definitions change none of
 * them. Tailwind's base rule gives every element the same forty, `--tw-translate-x: 0` and
 * `--tw-blur: initial` among them, so nearly every node defines tokens and nearly none of them
 * changes what its parent has. Such a node is handed its parent's map as it is: a copy for each
 * is a few hundred tokens copied a thousand times on one screen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const BASE =
  '* { --a: 0px; --b: initial } .w { width: var(--a) } .wb { width: var(--b, 9px) } ' +
  '.set { --a: 4px } .setb { --b: 5px } .inherit { --a: inherit }';

function scene(parentClasses: string, childClasses: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(BASE, 'app.css') as never });
  const make = (classes: string, under: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.appendChild(under, node);
    return node;
  };
  const parent = make(parentClasses, engine.root);
  const child = make(childClasses, parent);
  const width = () => {
    engine.commit();
    return fabric.committed[0]!.children[0]!.props['width'] ?? null;
  };
  /** Whether the child was handed the very map its parent has. */
  const shared = () => child.styleCache!.tokens === parent.styleCache!.tokens;
  return { engine, parent, child, width, shared };
}

describe('the tokens in scope at a node that changes none of them', () => {
  it('are its parent’s map itself, where the same rule gave both the same values', () => {
    const s = scene('', 'w');
    assert.equal(s.width(), 0);
    assert.equal(s.shared(), true);
  });

  it('are its own where a rule gives it a value its parent does not have', () => {
    // The parent sets `--a`, and the base rule sets it back on the child: not the parent's.
    const s = scene('set', 'w');
    assert.equal(s.width(), 0);
    assert.equal(s.shared(), false);
    // And the other way: the child sets it.
    const own = scene('', 'w set');
    assert.equal(own.width(), 4);
    assert.equal(own.shared(), false);
  });

  it('are its own where `initial` unsets what its parent set', () => {
    const s = scene('setb', 'wb');
    assert.equal(s.width(), 9, 'the fallback: the token is unset on the child');
    assert.equal(s.shared(), false);
    const unset = scene('', 'wb');
    assert.equal(unset.width(), 9);
    assert.equal(unset.shared(), true, 'nothing to unset: the parent has none either');
  });

  it('are its parent’s where `inherit` asks for what the parent has', () => {
    const s = scene('set', 'w inherit');
    assert.equal(s.width(), 4);
    assert.equal(s.shared(), true);
  });

  it('follow the parent gaining a value and losing it', () => {
    const s = scene('', 'w');
    assert.equal(s.width(), 0);
    s.engine.setClasses(s.parent, 'set');
    assert.equal(s.width(), 0, 'the base rule still sets it on the child');
    assert.equal(s.shared(), false);
    s.engine.setClasses(s.child, 'w inherit');
    assert.equal(s.width(), 4);
    s.engine.setClasses(s.parent, '');
    assert.equal(s.width(), 0);
    assert.equal(s.shared(), true);
  });
});
