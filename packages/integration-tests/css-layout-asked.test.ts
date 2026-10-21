/**
 * A layout CSS has and Yoga has not is worked out by the engine once something asks for it: a
 * stylesheet, a style, a package that gives elements a browser's defaults. Until then a node
 * is asked none of what that takes, so an app of native views and flex pays for none of it.
 * What asks can come late, after boxes it lays out were made: they are laid out by it from
 * then on, as if it had been asked from the start.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, name: string): StyleSheet;
};

/** Two boxes whose margins add in a flex column, and collapse to the larger in a block. */
const STACK = '.a { margin-bottom: 20px } .b { margin-top: 10px; margin-bottom: 5px }';
const ADDED = [
  [0, 20],
  [10, 5],
];
const COLLAPSED = [
  [0, 0],
  [20, 5],
];

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') });
  const box = (classes: string, parent: EngineNode, sheet: StyleSheet | null = null) => {
    const node = engine.createElement('view', sheet);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const find = (all: FakeFabricNode[], name: string): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = each.props['nativeID'] === name ? each : find(each.children, name);
      if (found) return found;
    }
    return undefined;
  };
  /** The margins the boxes named are committed with, after a commit. */
  const margins = (...names: string[]) => {
    engine.commit();
    return names.map((name) => {
      const { marginTop, marginBottom } = find(fabric.committed, name)!.props;
      return [marginTop ?? 0, marginBottom ?? 0];
    });
  };
  /** The props the box named is committed with, as they stand. */
  const props = (name: string) => find(fabric.committed, name)!.props;
  return { engine, box, margins, props };
}

describe('a layout of CSS asked for after boxes were made', () => {
  it('lays them out by it once a style asks, and as flex again once it does not', () => {
    const s = scene(STACK);
    const p = s.box('p', s.engine.root);
    s.box('a', p);
    s.box('b', p);
    assert.deepEqual(s.margins('a', 'b'), ADDED);
    s.engine.setProp(p, 'style', { display: 'block' });
    assert.deepEqual(s.margins('a', 'b'), COLLAPSED);
    s.engine.setProp(p, 'style', null);
    assert.deepEqual(s.margins('a', 'b'), ADDED);
  });

  it('lays them out by it once a stylesheet added to the app asks', () => {
    const s = scene(STACK);
    const p = s.box('p', s.engine.root);
    s.box('a', p);
    s.box('b', p);
    assert.deepEqual(s.margins('a', 'b'), ADDED);
    s.engine.addGlobalSheet(compileCss('.p { display: block }', 'late.css'));
    assert.deepEqual(s.margins('a', 'b'), COLLAPSED);
  });

  it('lays out the boxes of a component whose own sheet asks, in the commit they are made in', () => {
    // The sheet is first seen as the component's first box is merged, by when that box has
    // been planned as flex and the boxes above it committed.
    const s = scene(STACK);
    const own = compileCss(`.q { display: block } ${STACK}`, 'card.ts');
    const p = s.box('p', s.engine.root);
    assert.deepEqual(s.margins('p'), [[0, 0]]);
    const q = s.box('q', p, own);
    s.box('a', q, own);
    s.box('b', q, own);
    assert.deepEqual(s.margins('a', 'b'), COLLAPSED);
  });

  it("lays them out by it once a box is given a browser's default", () => {
    const s = scene(STACK);
    const p = s.box('p', s.engine.root);
    s.box('a', p);
    s.box('b', p);
    assert.deepEqual(s.margins('a', 'b'), ADDED);
    s.engine.setDefaultStyle(p, { display: 'block' });
    assert.deepEqual(s.margins('a', 'b'), COLLAPSED);
  });
});

describe('a box nothing restyled, placed by what a box above it comes to ask for', () => {
  // A box out of the flow is placed against the nearest box above it that is positioned. Its
  // parent stops being one, by a style of the parent's alone: the box itself is as it was.
  const CSS =
    '.g { width: 200px; height: 100px } .p { margin-left: 30px; margin-top: 20px; width: 100px; height: 50px }' +
    ' .c { position: absolute; left: 10px; top: 5px; width: 10px; height: 10px }';

  function placed(from: 'the start' | 'later') {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') });
    const box = (classes: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      engine.setProp(node, 'nativeID', classes);
      engine.appendChild(parent, node);
      return node;
    };
    const p = box('p', box('g', engine.root));
    box('c', p);
    const where = () => {
      engine.commit();
      const { left, top } = fabric.box('c');
      return [left, top];
    };
    if (from === 'the start') engine.setProp(p, 'style', { position: 'static' });
    const before = where();
    engine.setProp(p, 'style', { position: 'static' });
    return { before, after: where() };
  }

  it('is placed as it would have been had the box above asked from the start', () => {
    const late = placed('later');
    // Against its parent first, as a native view is, and against the box above that after.
    assert.deepEqual(late.before, [40, 25]);
    assert.deepEqual(late.after, [10, 5]);
    assert.deepEqual(late.after, placed('the start').after);
  });
});

describe('what a layout of CSS keeps of every box, of the boxes made before it was asked for', () => {
  it('is kept of them from then on: a row that turns into a column has its items merged again', () => {
    // An item with an automatic minimum does not shrink along a row, and does down a column
    // it has no minimum along. Which its container is, is kept of the container as it is
    // laid out: of one laid out before anything asked, once something has.
    const s = scene('.row { flex-direction: row } .item { flex-shrink: 1 }');
    const row = s.box('row', s.engine.root);
    const item = s.box('item', row);
    s.box('icon', item);
    const shrink = () => {
      s.margins('item');
      return s.engine.root && s.props('item')['flexShrink'];
    };
    assert.equal(shrink(), 1);
    s.engine.setProp(item, 'style', { minWidth: 'auto' });
    assert.equal(shrink(), 0);
    s.engine.setClasses(row, '');
    assert.equal(shrink(), 1);
  });
});
