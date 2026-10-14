/**
 * A scroll-driven animation (`animation-timeline: scroll()`) is handed to native against the tags
 * of its view and its scroll view. One made again, after a `display: none` on it, on a box it is
 * in or on its page, has new tags, and the drive starts again with them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { recorder } from './native-animated.ts';

const CSS =
  '@keyframes fade { from { opacity: 1 } to { opacity: 0 } } ' +
  '.a { animation: fade linear both; animation-timeline: scroll(); animation-range: 0px 100px } ' +
  '.hidden { display: none }';

function scene() {
  const rec = recorder();
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css') as StyleSheet,
    nativeAnimated: rec.native,
  });
  const page = engine.createElement('view');
  const scroll = engine.createElement('scroll-view');
  const box = engine.createElement('view');
  const view = engine.createElement('view');
  engine.setClasses(view, 'a');
  engine.appendChild(engine.root, page);
  engine.appendChild(page, scroll);
  engine.appendChild(scroll, box);
  engine.appendChild(box, view);
  engine.commit();
  engine.commit();
  /** The tags of the views a native animated props node is connected to now. */
  const driven = (): unknown[] => {
    const live = new Map<unknown, unknown>();
    for (const [name, props, tag] of rec.calls) {
      if (name === 'toView') live.set(tag, props);
      if (name === 'fromView' && live.get(tag) === props) live.delete(tag);
    }
    return [...live.keys()];
  };
  /** The tags of the views a native event feeds a value from now. */
  const listened = (): unknown[] => {
    const live = new Set<unknown>();
    for (const [name, tag] of rec.calls) {
      if (name === 'event') live.add(tag);
      if (name === 'removeEvent') live.delete(tag);
    }
    return [...live];
  };
  const hideAndShow = (node: EngineNode) => {
    engine.addClass(node, 'hidden');
    engine.commit();
    engine.removeClass(node, 'hidden');
    engine.commit();
    engine.commit();
  };
  return { engine, page, scroll, box, view, driven, listened, hideAndShow };
}

describe('a scroll-driven animation on a view that is created again', () => {
  it('control: drives the view it was started on, fed by its scroll view', () => {
    const s = scene();
    assert.deepEqual(s.driven(), [s.engine.tagOf(s.view)]);
    assert.deepEqual(s.listened(), [s.engine.tagOf(s.scroll)]);
  });

  it('drives the new view after the element was display: none', () => {
    const s = scene();
    const before = s.engine.tagOf(s.view);
    s.hideAndShow(s.view);
    assert.notEqual(s.engine.tagOf(s.view), before, 'the view was created again');
    assert.deepEqual(s.driven(), [s.engine.tagOf(s.view)]);
  });

  it('drives the new view after a box it is in was display: none', () => {
    const s = scene();
    s.hideAndShow(s.box);
    assert.deepEqual(s.driven(), [s.engine.tagOf(s.view)]);
  });

  it('is fed by the new scroll view after the page it is in was display: none', () => {
    const s = scene();
    s.hideAndShow(s.page);
    assert.deepEqual(s.driven(), [s.engine.tagOf(s.view)]);
    assert.deepEqual(s.listened(), [s.engine.tagOf(s.scroll)]);
  });
});
