/**
 * Text inside a box of a row aligned by baseline, measured again whenever the row is committed
 * again. React Native keeps what a paragraph measured on the copy of its node that was measured,
 * and Yoga copies the nodes it lays out around. A row laid out again asks each box for its
 * baseline, the box asks the paragraph in it, and a copy that was never measured works the
 * answer out then, on a node a debug build no longer lets change: the app stops with
 * "Attempt to mutate a sealed object". A form field's prefix beside its input is such a row.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '.row { flex-direction: row; align-items: baseline } .plain { flex-direction: row } ' +
  '.on { opacity: 0.5 } .out { position: absolute }';

/** A row holding a box with words in it and a box beside it, which a class is put on. */
function scene(row: string, lead = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const view = (classes: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.appendChild(parent, node);
    return node;
  };
  const outer = view(row, engine.root);
  const prefix = view('', outer);
  if (lead) view(lead, prefix);
  const text = engine.createElement('text');
  engine.appendChild(text, engine.createText('£'));
  engine.appendChild(prefix, text);
  const beside = view('', outer);
  engine.commit();
  const paragraph = (): FakeFabricNode => {
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined =>
      all.flatMap((n) => (n.viewName === 'Paragraph' ? [n] : [find(n.children)])).find(Boolean);
    return find(fabric.committed)!;
  };
  /** Whether a change beside the words had the paragraph committed as a new copy. */
  const copied = (): boolean => {
    const before = paragraph();
    engine.setClasses(beside, 'on');
    engine.commit();
    return paragraph() !== before;
  };
  return { copied };
}

describe('text a row aligned by baseline takes a baseline from', () => {
  it('is committed to be measured again when the row is committed again', () => {
    assert.equal(scene('row').copied(), true);
  });

  it('is left as it is in a row aligned any other way', () => {
    assert.equal(scene('plain').copied(), false);
  });

  it('is the first box in the flow, past one that is out of it', () => {
    assert.equal(scene('row', 'out').copied(), true);
  });
});
