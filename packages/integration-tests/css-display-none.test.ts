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
import { Engine, registerHoist, type EngineNode } from '@ng-native/fabric';
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

  it('takes the focus from a field in it, which has no view to blur', () => {
    // `Engine.focused` is what a scroll view reads to decide a touch dismisses the keyboard: a
    // field with no view, still focused, has every tap after it swallowed.
    const s = scene();
    s.engine.setClasses(s.panel, 'box');
    const field = s.engine.createElement('text-input');
    s.engine.appendChild(s.inside, field);
    const outside = s.engine.createElement('text-input');
    s.engine.appendChild(s.before, outside);
    s.engine.commit();
    s.engine.dispatchEvent(field, 'topFocus', {});
    s.engine.setClasses(s.panel, 'box gone');
    s.engine.commit();
    assert.equal(s.engine.focused, null);

    s.engine.dispatchEvent(outside, 'topFocus', {});
    s.engine.setClasses(s.panel, 'box');
    s.engine.commit();
    s.engine.setClasses(s.panel, 'box gone');
    s.engine.commit();
    assert.equal(s.engine.focused, outside, 'a field outside it keeps the focus');
  });

  it('keeps back what is hoisted out of it, and lets it land once it is displayed', () => {
    registerHoist('hidden-config', 'hidden-host');
    const s = scene();
    const host = s.engine.createElement('hidden-host');
    s.engine.setProp(host, 'nativeID', 'host');
    const wrapper = s.engine.createElement('view');
    s.engine.setProp(wrapper, 'nativeID', 'wrapper');
    const config = s.engine.createElement('hidden-config');
    s.engine.setProp(config, 'nativeID', 'config');
    s.engine.appendChild(s.page, host);
    s.engine.appendChild(host, wrapper);
    s.engine.appendChild(wrapper, s.panel);
    s.engine.appendChild(s.panel, config);
    const underHost = () => (s.tree()[0] as unknown[]).at(-1);
    // The wrapper is displayed, and the panel between it and the config is not.
    assert.deepEqual(underHost(), ['host', ['wrapper']]);
    s.engine.setClasses(s.panel, 'box');
    assert.deepEqual(underHost(), ['host', ['wrapper', ['panel', ['inside']]], ['config']]);
    s.engine.setClasses(s.panel, 'box gone');
    assert.deepEqual(underHost(), ['host', ['wrapper']]);
    s.engine.setClasses(s.panel, 'box');
    s.engine.setProp(config, 'style', { display: 'none' });
    assert.deepEqual(underHost(), ['host', ['wrapper', ['panel', ['inside']]]]);
  });
});
