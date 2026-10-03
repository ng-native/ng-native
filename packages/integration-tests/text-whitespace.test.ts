/**
 * Whitespace at a paragraph's edges. Angular collapses template whitespace to one space rather
 * than removing it, so text written across lines arrives padded; a browser hides that padding
 * and React Native's Text draws it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { Engine } from '@ng-native/fabric';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

function commit(build: (engine: Engine) => void): string[] {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { processColor: (value) => value });
  build(engine);
  engine.commit();
  return flatten(fabric.committed)
    .filter((n) => n.viewName === 'RawText')
    .map((n) => String(n.props['text']));
}

describe('text written across lines', () => {
  it('loses the space at the start and end of its paragraph', () => {
    const runs = commit((engine) => {
      const p = engine.createElement('text');
      engine.appendChild(p, engine.createText(' Ada Lovelace '));
      engine.appendChild(engine.root, p);
    });
    assert.deepEqual(runs, ['Ada Lovelace']);
  });

  it('keeps the space between a run and a nested one, as HTML does', () => {
    const runs = commit((engine) => {
      const p = engine.createElement('text');
      const star = engine.createElement('text');
      engine.appendChild(p, engine.createText(' Tenant Name '));
      engine.appendChild(star, engine.createText('*'));
      engine.appendChild(p, star);
      engine.appendChild(p, engine.createText(' '));
      engine.appendChild(engine.root, p);
    });
    assert.deepEqual(runs, ['Tenant Name ', '*', '']);
  });

  it('trims text written straight into a view, which is a paragraph of its own', () => {
    const runs = commit((engine) => {
      const view = engine.createElement('view');
      engine.appendChild(view, engine.createText(' loose '));
      engine.appendChild(engine.root, view);
    });
    assert.deepEqual(runs, ['loose']);
  });
});
