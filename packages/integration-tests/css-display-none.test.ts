/**
 * `display: none`: an element with no box, and so no native view, nor one for anything in it.
 * A view that is committed and not displayed would look the same, but Yoga marks one as laid out
 * each time it measures what holds it, and React Native clears the mark only where it reads that
 * parent's layout: a debug build stops at the mark on a later commit that has the parent's
 * layout already. So an element is given its views when it is displayed, and they go when it is
 * not: shown again it is made again, as an element put back in the tree is.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS = '.gone { display: none } .box { height: 10px }';

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const add = (id: string, classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const page = add('page', 'box', engine.root);
  const before = add('before', 'box', page);
  const panel = add('panel', 'box gone', page);
  const inside = add('inside', 'box', panel);
  const after = add('after', 'box', page);
  /** The ids of the views committed, nested as the views are. */
  const tree = (): unknown[] => {
    engine.commit();
    const walk = (all: readonly FakeFabricNode[]): unknown[] =>
      all.map((node) => [String(node.props['nativeID']), ...walk(node.children)]);
    return walk(fabric.committed);
  };
  return { engine, fabric, page, before, panel, inside, after, tree };
}

describe('an element that is display: none', () => {
  it('has no view, and nothing in it has one', () => {
    assert.deepEqual(scene().tree(), [['page', ['before'], ['after']]]);
  });

  it('is given its views, in its place, once it is displayed, and loses them again', () => {
    const s = scene();
    s.engine.setClasses(s.panel, 'box');
    assert.deepEqual(s.tree(), [['page', ['before'], ['panel', ['inside']], ['after']]]);
    s.engine.setClasses(s.panel, 'box gone');
    assert.deepEqual(s.tree(), [['page', ['before'], ['after']]]);
    s.engine.setClasses(s.panel, 'box');
    assert.deepEqual(s.tree(), [['page', ['before'], ['panel', ['inside']], ['after']]]);
  });

  it('is the same for a display set on the element as for one in a stylesheet', () => {
    const s = scene();
    s.engine.setClasses(s.panel, 'box');
    s.engine.setProp(s.before, 'style', { display: 'none' });
    assert.deepEqual(s.tree(), [['page', ['panel', ['inside']], ['after']]]);
    s.engine.setProp(s.before, 'style', { display: 'flex' });
    assert.deepEqual(s.tree(), [['page', ['before'], ['panel', ['inside']], ['after']]]);
  });

  it('keeps what is put in it while it is hidden, for when it is shown', () => {
    const s = scene();
    const late = s.engine.createElement('view');
    s.engine.setProp(late, 'nativeID', 'late');
    s.engine.appendChild(s.panel, late);
    assert.deepEqual(s.tree(), [['page', ['before'], ['after']]]);
    s.engine.setClasses(s.panel, 'box');
    assert.deepEqual(s.tree(), [['page', ['before'], ['panel', ['inside'], ['late']], ['after']]]);
  });

  it('hears no event while it is hidden, and its listeners are there when it is shown', () => {
    const s = scene();
    let heard = 0;
    s.engine.setEventListener(s.inside, 'topLayout', () => heard++);
    s.engine.setClasses(s.panel, 'box');
    s.engine.commit();
    s.engine.dispatchEvent(s.inside, 'topLayout', {});
    assert.equal(heard, 1);
  });
});
