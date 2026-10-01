/**
 * A border with no colour, which CSS draws in `currentcolor`: the element's text colour, its own
 * or inherited. Native's own default is black, which is what such a border was drawn in.
 *
 * Chrome's values for the same stylesheets are in the oracle (`css-oracle-cases.ts`); this covers
 * what the oracle cannot: a colour that changes after the first commit, and a token set on an
 * element rather than in a stylesheet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';
const SIDES = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = []) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'border', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const outer = engine.createElement('view', sheet);
  for (const name of parent) engine.addClass(outer, name);
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(outer, node);
  engine.appendChild(engine.root, outer);
  engine.commit();
  const props = () => fabric.committed[0]!.children[0]!.props;
  return { engine, outer, node, props, warnings };
}

const colours = (props: Record<string, unknown>) => SIDES.map((side) => props[side]);

describe('a border with no colour', () => {
  it('is drawn in the colour of the text, with no warning', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; border: 2px solid }`);
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['borderStyle'], 'solid');
  });

  it('is drawn in the colour the element inherits', () => {
    const { props } = tree(`.p { color: ${RED} } .a { border: 2px solid }`, ['p']);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });

  it('colours only the side a per-side border draws', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; border-top: 2px solid }`);
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [RED, undefined, undefined, undefined]);
  });

  it('takes border-color: currentColor as the colour of the text, as border-current writes', () => {
    const { props, warnings } = tree(
      `.a { color: ${RED}; border-width: 2px; border-color: currentColor }`,
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });

  it('takes currentColor on the inline and block edges, as border-x-current writes', () => {
    const { props, warnings } = tree(
      `.a { color: ${RED}; border-width: 2px; border-inline-color: currentColor; ` +
        'border-block-color: currentColor }',
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderLeftColor'], RED);
    assert.equal(props()['borderRightColor'], RED);
    // Native's one prop for both block edges.
    assert.equal(props()['borderBlockColor'], RED);
  });

  it('takes currentColor written in the shorthand, with or without tokens', () => {
    const plain = tree(`.a { color: ${RED}; border: 2px solid currentColor }`);
    assert.deepEqual(plain.warnings, []);
    assert.deepEqual(colours(plain.props()), [RED, RED, RED, RED]);
    const tokened = tree(`.a { color: ${RED}; --w: 2px; border: var(--w) solid currentColor }`);
    assert.deepEqual(tokened.warnings, []);
    assert.deepEqual(colours(tokened.props()), [RED, RED, RED, RED]);
  });

  it('cascades in the order written within a rule', () => {
    const after = tree(`.a { color: ${RED}; border: 2px solid; border-color: ${BLUE} }`);
    assert.deepEqual(colours(after.props()), [BLUE, BLUE, BLUE, BLUE]);
    const before = tree(`.a { color: ${RED}; border-color: ${BLUE}; border: 2px solid }`);
    assert.deepEqual(colours(before.props()), [RED, RED, RED, RED]);
  });

  it('keeps an important colour from a weaker rule', () => {
    const { props } = tree(
      `.a { border-color: ${BLUE} !important } .p .a { color: ${RED}; border: 2px solid }`,
      ['p'],
    );
    assert.deepEqual(colours(props()), [BLUE, BLUE, BLUE, BLUE]);
  });

  it('writes no colour for a border of no width', () => {
    const { props } = tree(`.a { color: ${RED}; border: 0 solid }`);
    assert.deepEqual(colours(props()), [undefined, undefined, undefined, undefined]);
  });

  it('takes a text colour that is itself a token', () => {
    const { props } = tree(`.a { --fg: ${RED}; color: var(--fg); border: 2px solid }`);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });

  it('follows the colour when it changes', () => {
    const { engine, outer, props } = tree(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { border: 2px solid }`,
      ['p'],
    );
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.deepEqual(colours(props()), [BLUE, BLUE, BLUE, BLUE]);
  });

  it('follows its own colour when that changes', () => {
    const { engine, node, props } = tree(`.a { border: 2px solid } .b { color: ${BLUE} }`);
    engine.addClass(node, 'b');
    engine.commit();
    assert.deepEqual(colours(props()), [BLUE, BLUE, BLUE, BLUE]);
  });

  it('is drawn in the colour of the text when its width is a token set on the element', () => {
    const { engine, node, props } = tree(`.a { color: ${RED}; border: var(--w, 1px) solid }`);
    engine.setCustomProperty(node, '--w', '2px');
    engine.commit();
    assert.equal(props()['borderTopWidth'], 2);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });
});
