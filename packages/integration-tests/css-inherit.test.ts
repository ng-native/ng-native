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

describe('inherit, written for a border', () => {
  // Chrome inherits each of the twelve longhands: width, style and colour on each side.
  const CSS =
    '.box { border: 2px solid rgb(1, 2, 3) } .sides { border-top: 4px solid rgb(4, 5, 6) } ' +
    '.own { border: 9px dotted rgb(9, 9, 9) } .same { border: inherit }';
  const BORDER = ['borderWidth', 'borderStyle', 'borderColor', 'borderTopWidth', 'borderTopColor'];
  const border = (props: Record<string, unknown>) =>
    Object.fromEntries(BORDER.map((key) => [key, props[key] ?? null]));

  it("is the parent's border, over one a weaker rule wrote", () => {
    const s = scene(CSS);
    s.element('own same', s.element('box'));
    s.element('box', s.engine.root);
    assert.deepEqual(border(s.props('own same')), border(s.props('box')));
    assert.equal(s.props('own same')['borderWidth'], 2);
    assert.equal(s.props('own same')['borderColor'], 'rgb(1, 2, 3)');
  });

  it("is each side's value, as the parent has it", () => {
    const s = scene(CSS);
    s.element('same', s.element('box sides'));
    assert.equal(s.props('same')['borderTopWidth'], 4);
    assert.equal(s.props('same')['borderTopColor'], 'rgb(4, 5, 6)');
    const sides = (props: Record<string, unknown>) =>
      ['Right', 'Bottom', 'Left'].map((side) => [
        props[`border${side}Width`] ?? props['borderWidth'],
      ]);
    assert.deepEqual(sides(s.props('same')), sides(s.props('box sides')));
    assert.deepEqual(sides(s.props('same')), [[2], [2], [2]]);
  });

  it("is the side the parent's logical border lands on, in the parent's direction", () => {
    const css =
      '.ltr { border-inline-start: 4px solid rgb(1, 2, 3) } ' +
      '.rtl { direction: rtl; border-inline-start: 4px solid rgb(1, 2, 3) } .same { border: inherit }';
    for (const [parent, side, other] of [
      ['ltr', 'Left', 'Right'],
      ['rtl', 'Right', 'Left'],
    ] as const) {
      const s = scene(css);
      s.element('same', s.element(parent));
      assert.equal(s.props('same')[`border${side}Width`], 4, parent);
      assert.equal(s.props('same')[`border${side}Color`], 'rgb(1, 2, 3)', parent);
      assert.equal(s.props('same')[`border${other}Width`] ?? null, null, parent);
    }
  });

  it('compiles with no warning, and so do its longhands', () => {
    const said: string[] = [];
    const css =
      '.a { border: inherit } .b { border-width: inherit } .c { border-color: inherit } ' +
      '.d { border-style: inherit } .e { border-top-width: inherit } .f { border-left-color: inherit }';
    compileCss(css, 'app.css', { onUnsupported: (m) => said.push(m) });
    assert.deepEqual(said, []);
  });

  it("is refused for a side's style or shorthand, and a logical side, which it cannot take whole", () => {
    // Native has one style for every side, and a logical side's parent value is a physical one.
    // A side's shorthand sets its style too, which it cannot take, and would be half inherited.
    const refused = [
      '.a { border-top-style: inherit }',
      '.a { border-top: inherit }',
      '.a { border-inline-start: inherit }',
    ];
    for (const css of refused) {
      const said: string[] = [];
      compileCss(css, 'app.css', { onUnsupported: (m) => said.push(m) });
      assert.match(said.join(), /CSS-wide keyword/, css);
    }
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
