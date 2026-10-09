/**
 * A box with a z-index is drawn over what follows the boxes it is in, as a browser draws it: a
 * menu written in one card opens over the next. A native view is ordered among the views beside
 * it and no further, so each view the box is in is given the z-index too, up to one that has a
 * z-index of its own, which is where a browser stops comparing as well.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS = `
  .menu { position: absolute; z-index: 10; }
  .higher { z-index: 20; }
  .layer { z-index: 1; }
  .under { z-index: -1; }
`;

function scene() {
  const sheet = compileCss(CSS, 'app.css', { onUnsupported: () => {} });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  /** An element called `id`, with `classes`, under `parent` or the root. */
  const el = (id: string, classes = '', parent: EngineNode = engine.root, name = 'view') => {
    const node = engine.createElement(name);
    if (classes) engine.setClasses(node, classes);
    engine.setProp(node, 'testID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed z-index of the view called `id`: a prop taken away is committed as null. */
  const z = (id: string): unknown => {
    engine.commit();
    const view = all(fabric.committed).find((node) => node.props['testID'] === id);
    return view?.props['zIndex'] ?? undefined;
  };
  return { engine, el, z };
}

describe('a box with a z-index, and the views it is in', () => {
  it('raises each view it is in, and none beside them', () => {
    const { el, z } = scene();
    const card = el('card');
    const field = el('field', '', card);
    el('menu', 'menu', field);
    el('beside', '', card);
    el('next');
    assert.equal(z('menu'), 10);
    assert.equal(z('field'), 10);
    assert.equal(z('card'), 10);
    assert.equal(z('beside'), undefined);
    assert.equal(z('next'), undefined);
  });

  it('follows the z-index changing, going, and the box being taken out', () => {
    const { engine, el, z } = scene();
    const card = el('card');
    const menu = el('menu', 'menu', card);
    assert.equal(z('card'), 10);
    engine.setClasses(menu, 'menu higher');
    assert.equal(z('card'), 20);
    engine.setClasses(menu, '');
    assert.equal(z('card'), undefined);
    engine.setClasses(menu, 'menu');
    assert.equal(z('card'), 10);
    engine.removeChild(card, menu);
    assert.equal(z('card'), undefined);
  });

  it('takes the highest of the boxes in a view, and the next highest when that one goes', () => {
    const { engine, el, z } = scene();
    const card = el('card');
    el('menu', 'menu', card);
    const higher = el('higher', 'menu higher', card);
    assert.equal(z('card'), 20);
    engine.removeChild(card, higher);
    assert.equal(z('card'), 10);
  });

  it('stops at a view with a z-index of its own, which keeps it', () => {
    const { el, z } = scene();
    const card = el('card');
    const layer = el('layer', 'layer', card);
    el('menu', 'menu', layer);
    assert.equal(z('layer'), 1);
    assert.equal(z('card'), 1);
  });

  it('raises nothing for a box drawn under, or for one with no z-index', () => {
    const { el, z } = scene();
    const card = el('card');
    el('under', 'under', card);
    el('plain', '', card);
    assert.equal(z('under'), -1);
    assert.equal(z('card'), undefined);
  });

  it('stops at a scroll view, which clips what is in it', () => {
    const { el, z } = scene();
    const scroll = el('scroll', '', undefined, 'scroll-view');
    const card = el('card', '', scroll);
    el('menu', 'menu', card);
    assert.equal(z('card'), 10);
    assert.equal(z('scroll'), undefined);
  });

  it('follows a z-index written on the element', () => {
    const { engine, el, z } = scene();
    const card = el('card');
    const menu = el('menu', '', card);
    engine.setProp(menu, 'style', { zIndex: 5 });
    assert.equal(z('card'), 5);
    engine.setProp(menu, 'style', {});
    assert.equal(z('card'), undefined);
  });
});
