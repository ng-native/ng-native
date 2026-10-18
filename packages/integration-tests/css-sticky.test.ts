/**
 * `position: sticky`, which Yoga has no scroll container to stick within. A sticky box is laid
 * out where it is written, and the engine moves it by its scroll view's offset: once the offset
 * passes the box, less its `top`, the box is pushed down by the difference, and no further than
 * the end of its parent. Native does the moving where it can; here there is no native side, so
 * the shift is written as the box's transform on each scroll event.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type NativeAnimated } from '@ng-native/fabric';
import type { FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [name: string, ...children: Spec[]];

const PAGE =
  '.scroll { height: 200px } .section { height: 300px } .lead { height: 50px } .head { position: sticky; top: 0; height: 30px } .gap { top: 10px }';

const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tr', 'th', 'td']);

function scene(css: string, spec: Spec, nativeAnimated: NativeAnimated | null = null) {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    nativeAnimated,
  });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): EngineNode => {
    // A table's parts are elements of their own names, as a web library writes them.
    const [first = ''] = name.split(' ');
    const element = name === 'scroll' ? 'scroll-view' : TABLE_PARTS.has(first) ? first : 'view';
    const node = engine.createElement(element);
    // An element of a web library's that scrolls what overflows it, where its style says so.
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
    return node;
  };
  build(spec, engine.root);
  engine.commit();
  const committed = (name: string): FakeFabricNode => {
    const find = (all: FakeFabricNode[]): FakeFabricNode | undefined =>
      all
        .flatMap((node) => (node.props['nativeID'] === name ? [node] : [find(node.children)]))
        .find(Boolean);
    return find(fabric.committed)!;
  };
  /** The shift a box has after its scroll view reports this offset. */
  const shiftAt = (name: string, y: number, within = 'scroll'): number => {
    fabric.emit(committed(within), 'topScroll', { contentOffset: { x: 0, y } });
    engine.commit();
    const transform = committed(name).props['transform'] as
      { translateY?: number }[] | null | undefined;
    return transform?.[0]?.translateY ?? 0;
  };
  return { engine, fabric, nodes, committed, shiftAt };
}

const TWO: Spec = ['scroll', ['section', ['lead'], ['head']], ['section two', ['head b']]];

describe('position: sticky', () => {
  it('is laid out where it is written, as a relative box with no insets', () => {
    const s = scene(PAGE, TWO);
    const props = s.committed('head').props;
    assert.equal(props['position'], 'relative');
    assert.equal('top' in props, false);
    assert.deepEqual(s.fabric.box('head'), { left: 0, top: 50, width: 400, height: 30 });
  });

  it('stays put until the scroll passes it, then moves with the scroll', () => {
    const s = scene(PAGE, TWO);
    assert.equal(s.shiftAt('head', 0), 0);
    assert.equal(s.shiftAt('head', 40), 0);
    assert.equal(s.shiftAt('head', 50), 0);
    assert.equal(s.shiftAt('head', 120), 70);
  });

  it('stops at the end of its parent, and comes back when the scroll does', () => {
    const s = scene(PAGE, TWO);
    // The section ends at 300 and the box is 30 tall and starts at 50: 220 is as far as it goes.
    assert.equal(s.shiftAt('head', 290), 220);
    assert.equal(s.shiftAt('head', 400), 220);
    assert.equal(s.shiftAt('head', 60), 10);
    assert.equal(s.shiftAt('head', 0), 0);
  });

  it('sticks each box in its own parent', () => {
    const s = scene(PAGE, TWO);
    assert.equal(s.shiftAt('head b', 290), 0);
    assert.equal(s.shiftAt('head b', 330), 30);
  });

  it('sticks its top that far from the top of the scroll view', () => {
    const s = scene(PAGE, ['scroll', ['section', ['lead'], ['head gap']]]);
    assert.equal(s.shiftAt('head gap', 40), 0);
    assert.equal(s.shiftAt('head gap', 60), 20);
  });

  it('follows the layout changing: a box that starts further down sticks later', () => {
    const s = scene(`${PAGE} .tall { height: 100px }`, TWO);
    assert.equal(s.shiftAt('head', 120), 70);
    s.engine.setClasses(s.nodes.get('lead')!, 'tall');
    s.engine.commit();
    assert.equal(s.shiftAt('head', 120), 20);
  });

  it('has native move it by the scroll, from where it sticks to the end of its parent', () => {
    const { native, named } = recorder();
    scene(PAGE, TWO, native);
    // One interpolation per sticky box: the first starts at 50 and stops 220 further on.
    const ranges = named('create')
      .map((call) => call[2] as { type: string; inputRange?: number[]; outputRange?: number[] })
      .filter((config) => config.type === 'interpolation');
    assert.equal(ranges.length, 2);
    assert.deepEqual(ranges[0]!.inputRange, [50, 270]);
    assert.deepEqual(ranges[0]!.outputRange, [0, 220]);
  });

  it('stops listening to a scroll view once nothing in it is sticky', () => {
    const s = scene(`${PAGE} .plain { position: relative; height: 30px }`, [
      'scroll',
      ['section', ['lead'], ['head']],
    ]);
    const scroll = s.nodes.get('scroll')!;
    assert.equal(scroll.listeners?.get('topScroll')?.size, 1);
    s.engine.setClasses(s.nodes.get('head')!, 'plain');
    s.engine.commit();
    assert.equal(scroll.listeners?.get('topScroll')?.size, 0);
  });

  it('is let go when it stops being sticky', () => {
    const s = scene(`${PAGE} .plain { position: relative; height: 30px }`, TWO);
    assert.equal(s.shiftAt('head', 120), 70);
    s.engine.setClasses(s.nodes.get('head')!, 'plain');
    assert.equal(s.shiftAt('head', 150), 0);
  });
});

describe('a sticky part of a table', () => {
  // A header that stays as its table scrolls: a library makes each cell of the header row
  // sticky. In CSS a cell, a row or a group of rows sticks within its table, not within the row
  // or the group it is written in, which is no taller than it is.
  const TABLE =
    '.scroll { height: 200px } .lead { height: 50px } .tr { height: 30px } .tbody { height: 400px } ' +
    '.th { position: sticky; top: 0; height: 30px } .stuck { position: sticky; top: 0 }';
  const SPEC: Spec = ['scroll', ['lead'], ['table', ['thead', ['tr', ['th']]], ['tbody']]];

  it('moves with the scroll for as long as the table is in sight', () => {
    const s = scene(TABLE, SPEC);
    assert.equal(s.shiftAt('th', 40), 0);
    assert.equal(s.shiftAt('th', 150), 100);
    // To the end of the table, 430 tall from 50: where the cell's own 30 still fit.
    assert.equal(s.shiftAt('th', 600), 400);
    assert.equal(s.shiftAt('th', 0), 0);
  });

  it('is so for a row and for a group of rows', () => {
    const row = scene(TABLE, ['scroll', ['lead'], ['table', ['thead', ['tr stuck']], ['tbody']]]);
    assert.equal(row.shiftAt('tr stuck', 150), 100);
    const group = scene(TABLE, ['scroll', ['lead'], ['table', ['thead stuck', ['tr']], ['tbody']]]);
    assert.equal(group.shiftAt('thead stuck', 150), 100);
  });
});

describe('a sticky box and what is written after it', () => {
  // A browser paints a positioned box over the boxes in the flow, so a header that sticks is
  // over the rows that scroll under it. A native view is under every view written after it.
  const z = (s: ReturnType<typeof scene>, name: string) =>
    s.committed(name).props['zIndex'] ?? null;

  it('is drawn over it, by its own z-index where it has one', () => {
    const s = scene(`${PAGE} .high { z-index: 100 }`, [
      'scroll',
      ['section', ['head'], ['lead']],
      ['section two', ['head high']],
    ]);
    assert.equal(z(s, 'head'), 1);
    assert.equal(z(s, 'head high'), 100);
  });

  it('is so for the row and the group a sticky cell of a table is in', () => {
    const css =
      '.scroll { height: 200px } .tr { height: 30px } .tbody { height: 400px } ' +
      '.th { position: sticky; top: 0; height: 30px; z-index: 100 } .plain { position: static }';
    const s = scene(css, ['scroll', ['table', ['thead', ['tr', ['th']]], ['tbody']]]);
    // In the commit after the one that found the cell sticky, as its place is.
    s.engine.commit();
    assert.deepEqual([z(s, 'th'), z(s, 'tr'), z(s, 'thead'), z(s, 'table')], [100, 100, 100, 100]);
    // And no longer once the cell stops being sticky.
    s.engine.setClasses(s.nodes.get('th')!, 'plain');
    s.shiftAt('th', 0);
    s.engine.commit();
    assert.deepEqual([z(s, 'tr'), z(s, 'thead'), z(s, 'table')], [null, null, null]);
  });
});
