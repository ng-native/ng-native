/**
 * A `min-height` over a `max-height`, and a `max-height` under a box's own padding: CSS lets the
 * least win in both (CSS 2.2, 10.7, and a border box is never smaller than its padding and border),
 * where React Native's Yoga holds a box to its most, and the box around it to that. The same
 * across a width. The Yoga from npm these tests lay out with lets the least win already, so the
 * most the engine commits is checked as well as the sizes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { layOutTree } from './layout.ts';

type Spec = [name: string, ...children: Spec[]];

function scene(css: string, spec: Spec) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): void => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
  };
  build(spec, engine.root);
  const find = (all: readonly FakeFabricNode[], name: string): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = each.props['nativeID'] === name ? each : find(each.children, name);
      if (found) return found;
    }
    return undefined;
  };
  /** The width and height of the view with this `nativeID`, as Yoga lays out the commit. */
  const size = (name: string) => {
    engine.commit();
    const { width, height } = layOutTree(fabric.committed, { width: 400, height: 800 }).get(
      find(fabric.committed, name)!,
    )!;
    return [width, height];
  };
  /** A prop the view with this `nativeID` was last committed with. */
  const committed = (name: string, key: string): unknown => {
    engine.commit();
    return find(fabric.committed, name)!.props[key];
  };
  return { engine, nodes, size, committed };
}

// Chrome's numbers.
const CSS =
  '.both { min-height: 100px; max-height: 80px } .padded { max-height: 10px; padding-top: 50px }' +
  ' .row { flex-direction: row } .wide { min-width: 100px; max-width: 80px; height: 5px }' +
  ' .inset { max-width: 10px; padding-left: 30px; height: 5px } .low { min-height: 20px }' +
  ' .content { box-sizing: content-box; max-height: 10px; padding-top: 50px }';

describe('a least size over a most', () => {
  it('is the least, and so is the box around it', () => {
    const s = scene(CSS, ['a', ['both']]);
    assert.deepEqual(s.size('both'), [400, 100]);
    assert.deepEqual(s.size('a'), [400, 100]);
    assert.equal(s.committed('both', 'maxHeight'), 100);
  });

  it('is the least across a width too', () => {
    const s = scene(CSS, ['row', ['wide'], ['inset']]);
    assert.deepEqual(s.size('wide'), [100, 5]);
    assert.deepEqual(s.size('inset'), [30, 5]);
    assert.equal(s.committed('wide', 'maxWidth'), 100);
    assert.equal(s.committed('inset', 'maxWidth'), 30);
  });

  it('holds a box at its padding, and the box around it with it', () => {
    const s = scene(CSS, ['a', ['padded']]);
    assert.deepEqual(s.size('padded'), [400, 50]);
    assert.deepEqual(s.size('a'), [400, 50]);
    assert.equal(s.committed('padded', 'maxHeight'), 50);
  });

  it('leaves a content box its most, which its padding is outside', () => {
    const s = scene(CSS, ['a', ['content']]);
    assert.equal(s.committed('content', 'maxHeight'), 10);
  });

  it('gives the most back when the least goes under it', () => {
    const s = scene(`${CSS} .most { max-height: 80px }`, ['a', ['both']]);
    assert.equal(s.committed('both', 'maxHeight'), 100);
    s.engine.setClasses(s.nodes.get('both')!, 'low most');
    assert.equal(s.committed('both', 'maxHeight'), 80);
    assert.equal(s.size('both')[1], 20);
  });
});
