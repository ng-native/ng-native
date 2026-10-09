/**
 * A border with a width and no colour of its own is drawn in the colour of the text, as a
 * browser draws it: `border-color` starts as `currentColor`. Native starts it as black. The
 * `border` shorthand already says so where it writes no colour; this is the border written as
 * a width and a style, which is how Tailwind's `border` and a library's reset write one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const el = (id: string, classes: string, parent: EngineNode = engine.root): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'testID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed colour of each side of the border of the view called `id`. */
  const edges = (id: string): unknown[] => {
    engine.commit();
    const view = all(fabric.committed).find((each) => each.props['testID'] === id)!;
    return SIDES.map(
      (side) => view.props[`border${side}Color`] ?? view.props['borderColor'] ?? null,
    );
  };
  return { engine, el, edges };
}

const SLATE = 'rgb(51, 65, 85)';
const BOX = '.box { border-width: 1px; border-style: solid }';

describe('a border with a width and no colour', () => {
  it('is the colour of the text, its own or what it inherits', () => {
    const own = scene(`${BOX} .ink { color: ${SLATE} }`);
    own.el('box', 'box ink');
    assert.deepEqual(own.edges('box'), [SLATE, SLATE, SLATE, SLATE]);
    const inherited = scene(`${BOX} .ink { color: ${SLATE} }`);
    inherited.el('box', 'box', inherited.el('page', 'ink'));
    assert.deepEqual(inherited.edges('box'), [SLATE, SLATE, SLATE, SLATE]);
  });

  it('keeps a colour it is given, on the sides it is given for', () => {
    const s = scene(
      `${BOX} .ink { color: ${SLATE} } .red { border-color: red } .top { border-top-color: blue }`,
    );
    s.el('red', 'box ink red');
    s.el('top', 'box ink top');
    assert.deepEqual(s.edges('red'), Array(4).fill('rgb(255, 0, 0)'));
    assert.deepEqual(s.edges('top'), ['rgb(0, 0, 255)', SLATE, SLATE, SLATE]);
  });

  it('is said for the sides that have a width, and for none where there is no text colour', () => {
    const s = scene(`.under { border-bottom-width: 2px } .ink { color: ${SLATE} } ${BOX}`);
    s.el('under', 'under ink');
    s.el('plain', 'box');
    assert.deepEqual(s.edges('under'), [null, null, SLATE, null]);
    // Black, which is native's own and what a browser starts text as.
    assert.deepEqual(s.edges('plain'), [null, null, null, null]);
  });

  it('follows the text colour changing above it, the border going, and one written on it', () => {
    const s = scene(`${BOX} .ink { color: ${SLATE} } .red { color: red }`);
    const page = s.el('page', 'ink');
    const box = s.el('box', 'box', page);
    assert.deepEqual(s.edges('box'), Array(4).fill(SLATE));
    s.engine.setClasses(page, 'red');
    assert.deepEqual(s.edges('box'), Array(4).fill('rgb(255, 0, 0)'));
    s.engine.setClasses(box, '');
    assert.deepEqual(s.edges('box'), [null, null, null, null]);
    // Written on the element, as a library writes one as it runs.
    s.engine.setProp(box, 'style', { borderLeftWidth: 3 });
    assert.deepEqual(s.edges('box'), [null, null, null, 'rgb(255, 0, 0)']);
  });
});
