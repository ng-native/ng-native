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
    // The group and what is under it, and still nothing of the screen around them.
    assert.ok(s.touch('topTouchStart') <= 3);
    assert.equal(s.props('label')['opacity'], 0.3);
    s.touch('topTouchEnd');
    assert.equal(s.props('label')['opacity'], null);
  });

  it('styles what is inside a pressed element named in :is(), and not the screen', () => {
    // How Tailwind writes `group-active:`: the group is named inside `:is()`, and the compound
    // that asks has no class of its own, which is not the same as being any element.
    const s = scene(`${BASE} :is(.group):active .label { opacity: 0.3 }`);
    assert.ok(s.touch('topTouchStart') <= 3);
    assert.equal(s.props('label')['opacity'], 0.3);
    assert.ok(s.touch('topTouchEnd') <= 3);
    assert.equal(s.props('label')['opacity'], null);
  });

  it('styles what is inside a pressed element named as any alternative of :is()', () => {
    // Each alternative is the element itself: the group is one whichever it is written as.
    for (const named of [':is(.group, .other)', ':is(.other, .group)', ':is(.other, .inner)']) {
      const s = scene(`${BASE} ${named}:active .label { opacity: 0.3 }`);
      assert.ok(s.touch('topTouchStart') <= 3, named);
      assert.equal(s.props('label')['opacity'], 0.3, named);
      s.touch('topTouchEnd');
      assert.equal(s.props('label')['opacity'], null, named);
    }
  });

  it('styles an element that holds a pressed one, where a rule asks about that', () => {
    const s = scene(`${BASE} .outer:has(.btn:active) { opacity: 0.7 }`);
    s.touch('topTouchStart');
    assert.equal(s.props('outer')['opacity'], 0.7);
    s.touch('topTouchEnd');
    assert.equal(s.props('outer')['opacity'], null);
  });

  it('styles only the pressed element where the pressed state is asked inside :is() or :not()', () => {
    // The state is the element's own, wherever in its selector it is written.
    for (const rule of ['.btn:is(:active)', '.btn:not(:not(:active))', ':is(.btn:active)']) {
      const s = scene(`${BASE} .btn { opacity: 1 } ${rule} { opacity: 0.5 }`);
      assert.ok(s.touch('topTouchStart') <= 2, rule);
      assert.equal(s.props('btn')['opacity'], 0.5, rule);
      assert.ok(s.touch('topTouchEnd') <= 2, rule);
      assert.equal(s.props('btn')['opacity'], 1, rule);
    }
  });

  it('styles a host pressed under its own :host:active, with nothing else in the component', () => {
    const s = scene(BASE);
    s.engine.setHostSheet(s.button, compileCss(':host:active { opacity: 0.4 }') as StyleSheet);
    s.engine.commit();
    s.touch('topTouchStart');
    assert.equal(s.props('btn')['opacity'], 0.4);
    s.touch('topTouchEnd');
    assert.equal(s.props('btn')['opacity'], null);
  });

  it('keeps the style of an element no rule can match, under tokens set on the root', () => {
    // Only a component's sheet has a pressed style: everything else has no rule at all.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    engine.updateTokens({ '--gap': { length: 4 } });
    const sheet = compileCss('.btn:active { opacity: 0.5 }') as StyleSheet;
    const all: EngineNode[] = [];
    const add = (parent: EngineNode, own?: StyleSheet): EngineNode => {
      const node = engine.createElement('view', own);
      all.push(node);
      engine.appendChild(parent, node);
      return node;
    };
    const screen = add(engine.root);
    for (let row = 0; row < 20; row++) add(add(screen));
    const button = add(add(screen), sheet);
    engine.setClasses(button, 'btn');
    engine.setResponder(button, { onStartShouldSetResponder: () => true });
    engine.commit();
    const before = all.map((node) => node.styleCache);
    engine.dispatchEvent(button, 'topTouchStart', {});
    engine.commit();
    assert.ok(all.filter((node, i) => node.styleCache !== before[i]).length <= 1);
  });

  it('stops asking what a sheet asked once the sheet is replaced or removed', () => {
    const s = scene(BASE);
    const asks = compileCss('.group:active .label { opacity: 0.3 }') as StyleSheet;
    const plain = compileCss('.label { opacity: 0.9 }') as StyleSheet;
    s.engine.addGlobalSheet(asks);
    s.engine.commit();
    assert.ok(s.touch('topTouchStart') > 0);
    s.touch('topTouchEnd');
    // A hot swap edits the rule away, and then the sheet goes altogether.
    s.engine.addGlobalSheet(plain, asks);
    s.engine.commit();
    assert.equal(s.touch('topTouchStart'), 0);
    assert.equal(s.touch('topTouchEnd'), 0);
    s.engine.addGlobalSheet(asks, plain);
    s.engine.removeGlobalSheet(asks);
    s.engine.commit();
    assert.equal(s.touch('topTouchStart'), 0);
  });

  it('styles nothing at all under a stylesheet with no pressed style in it', () => {
    const s = scene(BASE);
    assert.equal(s.touch('topTouchStart'), 0);
    assert.equal(s.touch('topTouchEnd'), 0);
  });
});
