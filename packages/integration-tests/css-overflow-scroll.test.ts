/**
 * `overflow: auto` and `overflow: scroll` on an element that scrolls what overflows it: a list
 * of options taller than its panel. A native view does not scroll, so such an element is a
 * scroll view, and what it holds is in one view inside that, as a scroll view's content is on
 * both platforms. The box the element is, its size, border and background, is the scroll
 * view's; how it lays out what it holds, its padding and its flex properties, is the content's.
 *
 * Only an element said to scroll its overflow is one, by a package that gives elements a
 * browser's behaviour (`scrollsOverflow`). For any other the property is layout alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, scrollsOverflow, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '.panel { overflow: auto; max-height: 100px; padding: 8px; display: flex;' +
  ' flex-direction: column; gap: 4px; background-color: red; border-radius: 4px }' +
  ' .row { height: 48px } .clip { overflow: hidden }';

function scene(marked = true) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const add = (id: string, classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const panel = engine.createElement('view');
  if (marked) scrollsOverflow(panel);
  engine.setClasses(panel, 'panel');
  engine.setProp(panel, 'nativeID', 'panel');
  engine.appendChild(engine.root, panel);
  const rows = ['a', 'b', 'c'].map((id) => add(id, 'row', panel));
  const view = (): FakeFabricNode => {
    engine.commit();
    return fabric.committed[0]!;
  };
  const ids = (node: FakeFabricNode) => node.children.map((child) => child.props['nativeID']);
  return { engine, fabric, panel, rows, add, view, ids };
}

describe('an element that scrolls its overflow', () => {
  it('is a scroll view, with what it holds in one view inside it', () => {
    const s = scene();
    const panel = s.view();
    assert.equal(panel.viewName, 'ScrollView');
    assert.equal(panel.children.length, 1);
    const [content] = panel.children;
    assert.equal(content!.viewName, 'View');
    assert.deepEqual(s.ids(content!), ['a', 'b', 'c']);
  });

  it('keeps its box on the scroll view, and lays out what it holds from the content', () => {
    const s = scene();
    const panel = s.view();
    const [content] = panel.children;
    assert.equal(panel.props['maxHeight'], 100);
    // `auto` is no overflow native has, and read as none: what is past the box would be drawn.
    assert.equal(panel.props['overflow'], 'scroll');
    assert.equal(panel.props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(panel.props['borderTopLeftRadius'], 4);
    // On Android a scroll view in another one scrolls only where it asks to.
    assert.equal(panel.props['nestedScrollEnabled'], true);
    for (const key of ['paddingTop', 'paddingLeft', 'rowGap', 'gap', 'flexDirection']) {
      assert.equal(panel.props[key] ?? null, null, key);
    }
    assert.equal(content!.props['paddingTop'], 8);
    assert.equal(content!.props['paddingLeft'], 8);
    assert.equal(content!.props['flexDirection'], 'column');
    assert.equal(content!.props['rowGap'] ?? content!.props['gap'], 4);
    // Its own view on both platforms, whatever is in it: a scroll view scrolls one child.
    assert.equal(content!.props['collapsable'], false);
  });

  it('grows and shrinks as the element would, not as a scroll view of its own does', () => {
    // React Native's scroll view grows to fill a column by default, where an element with a
    // height of its own and overflow: auto is as tall as it says.
    const panel = scene().view();
    assert.equal(panel.props['flexGrow'] ?? null, null);
    const native = new Engine(createFakeFabric(), 1, {});
    const list = native.createElement('scroll-view');
    native.appendChild(native.root, list);
    native.commit();
    assert.equal(list.committed?.props['flexGrow'], 1, 'a scroll view of its own still does');
  });

  it('follows what it holds coming and going, as the view it was made', () => {
    const s = scene();
    const tag = s.view().reactTag;
    const late = s.add('d', 'row', s.panel);
    assert.deepEqual(s.ids(s.view().children[0]!), ['a', 'b', 'c', 'd']);
    s.engine.removeChild(s.panel, late);
    s.engine.removeChild(s.panel, s.rows[0]!);
    assert.deepEqual(s.ids(s.view().children[0]!), ['b', 'c']);
    assert.equal(s.view().reactTag, tag, 'the same scroll view throughout');
  });

  it('is one for an inline style that says auto, which no sheet compiled', () => {
    const s = scene();
    s.engine.setClasses(s.panel, '');
    assert.equal(s.view().viewName, 'View');
    s.engine.setProp(s.panel, 'style', { overflow: 'auto' });
    assert.equal(s.view().viewName, 'ScrollView');
  });

  it('follows its padding changing, on the content', () => {
    const s = scene();
    s.engine.setProp(s.panel, 'style', { paddingTop: 20 });
    const panel = s.view();
    assert.equal(panel.children[0]!.props['paddingTop'], 20);
    assert.equal(panel.props['paddingTop'] ?? null, null);
  });

  it('is a plain view again once it no longer scrolls, and a scroll view once it does', () => {
    const s = scene();
    s.engine.setClasses(s.panel, 'panel clip');
    let panel = s.view();
    assert.equal(panel.viewName, 'View');
    assert.deepEqual(s.ids(panel), ['a', 'b', 'c']);
    assert.equal(panel.props['paddingTop'], 8);
    s.engine.setClasses(s.panel, 'panel');
    panel = s.view();
    assert.equal(panel.viewName, 'ScrollView');
    assert.deepEqual(s.ids(panel.children[0]!), ['a', 'b', 'c']);
  });

  it('is a plain view once its overflow goes, and holds what came while it was one', () => {
    const s = scene();
    s.view();
    s.engine.setClasses(s.panel, '');
    assert.equal(s.view().viewName, 'View');
    s.add('d', 'row', s.panel);
    s.engine.removeChild(s.panel, s.rows[1]!);
    assert.deepEqual(s.ids(s.view()), ['a', 'c', 'd']);
    s.engine.setClasses(s.panel, 'panel');
    const panel = s.view();
    assert.equal(panel.viewName, 'ScrollView');
    assert.deepEqual(s.ids(panel.children[0]!), ['a', 'c', 'd']);
  });

  it('is a scroll view around what it holds again once it leaves the tree and comes back', () => {
    const s = scene();
    s.view();
    s.engine.removeChild(s.engine.root, s.panel);
    s.engine.commit();
    assert.equal(s.fabric.committed.length, 0);
    s.engine.appendChild(s.engine.root, s.panel);
    let panel = s.view();
    assert.equal(panel.viewName, 'ScrollView');
    assert.deepEqual(s.ids(panel.children[0]!), ['a', 'b', 'c']);
    s.add('d', 'row', s.panel);
    panel = s.view();
    assert.equal(panel.children.length, 1);
    assert.deepEqual(s.ids(panel.children[0]!), ['a', 'b', 'c', 'd']);
  });
});

describe('an element not said to scroll its overflow', () => {
  it('is the view it is, with overflow as layout alone', () => {
    const s = scene(false);
    const panel = s.view();
    assert.equal(panel.viewName, 'View');
    assert.deepEqual(s.ids(panel), ['a', 'b', 'c']);
    assert.equal(panel.props['paddingTop'], 8);
    assert.equal(panel.props['overflow'], 'scroll');
  });
});
