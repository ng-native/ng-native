/**
 * `layoutConformance: 'strict'`, which lays the app out without Yoga's legacy errata: a
 * percentage inset or size of an out-of-flow box is of its container's padding box, as CSS has
 * it, and not of its content box. React Native turns it on for a subtree with a
 * `LayoutConformance` view, which has no box of its own, so the engine commits one around
 * everything.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineOptions } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

function app(options: EngineOptions = {}) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, options);
  const first = engine.createElement('view');
  engine.appendChild(engine.root, first);
  engine.commit();
  return { fabric, engine, first };
}

describe('layout conformance', () => {
  it('commits the app as it is by default', () => {
    const { fabric } = app();
    assert.deepEqual(
      fabric.committed.map((node) => node.viewName),
      ['View'],
    );
  });

  it('commits the app inside one strict view that has no box of its own', () => {
    const { fabric } = app({ layoutConformance: 'strict' });
    assert.equal(fabric.committed.length, 1);
    const [wrapper] = fabric.committed;
    assert.equal(wrapper!.viewName, 'LayoutConformance');
    assert.deepEqual(wrapper!.props, { mode: 'strict', display: 'contents' });
    assert.deepEqual(
      wrapper!.children.map((node) => node.viewName),
      ['View'],
    );
  });

  it('keeps the same view around the app as its children change', () => {
    const { fabric, engine, first } = app({ layoutConformance: 'strict' });
    const tag = fabric.committed[0]!.reactTag;
    engine.appendChild(engine.root, engine.createElement('view'));
    engine.commit();
    assert.equal(fabric.committed.length, 1);
    assert.equal(fabric.committed[0]!.reactTag, tag);
    assert.equal(fabric.committed[0]!.children.length, 2);
    engine.removeChild(engine.root, first);
    engine.commit();
    assert.equal(fabric.committed[0]!.reactTag, tag);
    assert.equal(fabric.committed[0]!.children.length, 1);
  });
});
