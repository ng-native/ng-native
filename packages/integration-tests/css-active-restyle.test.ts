/**
 * What a press restyles. `:active` is true of the element pressed and of every ancestor, up to
 * the root, so a press changes the state of the whole chain. Almost none of those elements match
 * anything different for it: a stylesheet styles a pressed button, not the screen it is on. So
 * the chain is matched again and nothing more, unless a rule styles what is inside or beside a
 * pressed element, and only an element that matches other rules is styled again.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A screen of twenty rows of five cells, and a button three boxes down beside them. */
function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
  const all: EngineNode[] = [];
  const add = (classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    all.push(node);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const screen = add('screen', engine.root);
  for (let row = 0; row < 20; row++) {
    const at = add('row', screen);
    for (let cell = 0; cell < 5; cell++) add('cell', at);
  }
  const button = add('btn', add('inner group', add('outer', screen)));
  add('label', button);
  engine.setResponder(button, { onStartShouldSetResponder: () => true });
  engine.commit();
  const props = (name: string): Record<string, unknown> => {
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === name ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  /** A touch down on the button, or its release: answers how many elements were styled again. */
  const touch = (type: 'topTouchStart' | 'topTouchEnd'): number => {
    // A style resolved again is another object: one kept is the very one it was.
    const before = all.map((node) => node.styleCache);
    engine.dispatchEvent(button, type, {});
    engine.commit();
    return all.filter((node, i) => node.styleCache !== before[i]).length;
  };
  return { engine, button, props, touch };
}

const BASE =
  '.screen { flex: 1 } .row { height: 10px } .cell { width: 10px } .label { color: black }';

describe('a press', () => {
  it('styles the pressed element again, and nothing on the screen around it', () => {
    const s = scene(`${BASE} .btn { opacity: 1 } .btn:active { opacity: 0.5 }`);
    // The button, which matches another rule, and the label in it, which inherits from it.
    assert.ok(s.touch('topTouchStart') <= 2);
    assert.equal(s.props('btn')['opacity'], 0.5);
    assert.ok(s.touch('topTouchEnd') <= 2);
    assert.equal(s.props('btn')['opacity'], 1);
  });

  it('styles an ancestor that has a pressed style of its own', () => {
    const s = scene(`${BASE} .outer:active { opacity: 0.8 } .btn:active { opacity: 0.5 }`);
    s.touch('topTouchStart');
    assert.equal(s.props('outer')['opacity'], 0.8);
    assert.equal(s.props('btn')['opacity'], 0.5);
    s.touch('topTouchEnd');
    assert.equal(s.props('outer')['opacity'], null);
  });

  it('styles what is inside a pressed element, where a rule asks about that', () => {
    const s = scene(`${BASE} .group:active .label { opacity: 0.3 }`);
    s.touch('topTouchStart');
    assert.equal(s.props('label')['opacity'], 0.3);
    s.touch('topTouchEnd');
    assert.equal(s.props('label')['opacity'], null);
  });

  it('styles an element that holds a pressed one, where a rule asks about that', () => {
    const s = scene(`${BASE} .outer:has(.btn:active) { opacity: 0.7 }`);
    s.touch('topTouchStart');
    assert.equal(s.props('outer')['opacity'], 0.7);
    s.touch('topTouchEnd');
    assert.equal(s.props('outer')['opacity'], null);
  });

  it('styles nothing at all under a stylesheet with no pressed style in it', () => {
    const s = scene(BASE);
    assert.equal(s.touch('topTouchStart'), 0);
    assert.equal(s.touch('topTouchEnd'), 0);
  });
});
