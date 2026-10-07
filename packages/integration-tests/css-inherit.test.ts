/**
 * `inherit`, written for a property: the value the parent has for it, whether CSS hands that
 * property down by itself or not. A library's state layer is `border-radius: inherit` so that
 * it has the shape of the button it covers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(
    css: string,
    context: string,
    options?: { onUnsupported?: (message: string) => void },
  ): object;
};

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const element = (classes: string, parent: EngineNode = engine.root, name = 'view') => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const find = (id: string, all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = each.props['nativeID'] === id ? each : find(id, each.children);
      if (found) return found;
    }
    return undefined;
  };
  const props = (id: string) => {
    engine.commit();
    return find(id, fabric.committed)!.props;
  };
  return { engine, element, props };
}

const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(
  (corner) => `border${corner}Radius`,
);
const corners = (props: Record<string, unknown>) => CORNERS.map((corner) => props[corner]);

describe('inherit, for a property CSS does not hand down', () => {
  const CSS =
    '.round { border-radius: 8px } .square { border-radius: 2px 4px } ' +
    '.layer { border-radius: inherit }';

  it("is the parent's value, corner by corner", () => {
    const s = scene(CSS);
    s.element('layer', s.element('square'));
    assert.deepEqual(corners(s.props('layer')), [2, 4, 2, 4]);
  });

  it("is each parent's own, for two boxes that match the same rules", () => {
    const s = scene(CSS);
    s.element('layer one', s.element('round'));
    s.element('layer two', s.element('square'));
    assert.deepEqual(corners(s.props('layer one')), [8, 8, 8, 8]);
    assert.deepEqual(corners(s.props('layer two')), [2, 4, 2, 4]);
  });

  it('follows the parent when the parent is restyled', () => {
    const s = scene(CSS);
    const parent = s.element('round');
    s.element('layer', parent);
    assert.deepEqual(corners(s.props('layer')), [8, 8, 8, 8]);
    s.engine.setClasses(parent, 'square');
    assert.deepEqual(corners(s.props('layer')), [2, 4, 2, 4]);
  });

  it('is nothing where the parent has none, over a value of its own from a weaker rule', () => {
    const s = scene('.box { height: 5px; width: 3px } .box.same { height: inherit }');
    s.element('box same', s.element('plain'));
    assert.equal(s.props('box same')['height'], undefined);
    assert.equal(s.props('box same')['width'], 3);
  });

  it('loses to a later rule that writes a value', () => {
    const s = scene('.tall { height: 9px } .box { height: inherit } .box { height: 5px }');
    s.element('box', s.element('tall'));
    assert.equal(s.props('box')['height'], 5);
  });
});

describe('inherit, from a parent whose value is set on the element', () => {
  const CSS = '.wide { width: 80px } .same { width: inherit }';

  it("is the parent's inline value, over the one its rules give it", () => {
    const s = scene(CSS);
    const parent = s.element('wide');
    s.engine.setProp(parent, 'style', { width: 30 });
    s.element('same', parent);
    assert.equal(s.props('same')['width'], 30);
  });

  it('follows the inline value changing, and going', () => {
    const s = scene(CSS);
    const parent = s.element('wide');
    s.element('same', parent);
    assert.equal(s.props('same')['width'], 80);
    s.engine.setProp(parent, 'style', { width: 30 });
    assert.equal(s.props('same')['width'], 30);
    s.engine.setProp(parent, 'style', { width: 50 });
    assert.equal(s.props('same')['width'], 50);
    s.engine.setProp(parent, 'style', null);
    assert.equal(s.props('same')['width'], 80);
  });
});

describe('inherit, for a property CSS hands down anyway', () => {
  it("is the parent's value over one a weaker rule wrote", () => {
    const s = scene('.p { font-size: 12px } .t { font-size: 20px } .t.same { font-size: inherit }');
    s.element('t same', s.element('p'), 'text');
    assert.equal(s.props('t same')['fontSize'], 12);
  });
});

describe('inherit, written for a background', () => {
  // A table's rows and cells are `background: inherit`, each from the one around it, so that a
  // header that stays over the rows as they scroll covers them with the table's own colour.
  const CSS =
    '.table { background-color: rgb(250, 249, 253) } .row { background: inherit } ' +
    '.cell { background: inherit } .tinted { background-color: rgb(1, 2, 3) }';

  it("is the parent's colour, handed on through each box that says it", () => {
    const s = scene(CSS);
    const row = s.element('row', s.element('table'));
    s.element('cell', row);
    assert.equal(s.props('row')['backgroundColor'], 'rgb(250, 249, 253)');
    assert.equal(s.props('cell')['backgroundColor'], 'rgb(250, 249, 253)');
  });

  it('follows the colour above changing, and is none where there is none', () => {
    const s = scene(CSS);
    const table = s.element('table');
    s.element('cell', s.element('row', table));
    s.engine.setClasses(table, 'table tinted');
    assert.equal(s.props('cell')['backgroundColor'], 'rgb(1, 2, 3)');
    s.engine.setClasses(table, '');
    assert.equal(s.props('cell')['backgroundColor'] ?? null, null);
  });

  it('is told of nothing it leaves out', () => {
    const said: string[] = [];
    compileCss('.row { background: inherit }', 'app.css', { onUnsupported: (m) => said.push(m) });
    assert.deepEqual(said, []);
  });
});

describe('inherit, for a property with no one value to take', () => {
  it('is refused, and said so', () => {
    const dropped: string[] = [];
    compileCss('.a { display: inherit }', 'app.css', {
      onUnsupported: (message) => dropped.push(message),
    });
    assert.match(dropped.join(), /CSS-wide keyword/);
  });
});
