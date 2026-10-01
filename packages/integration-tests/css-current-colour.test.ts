/**
 * `currentColor` beyond a border's own: an outline, a background, a `var()` that falls back to it
 * or a token that holds it. Each is the element's text colour, own or inherited, where it is used.
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
const GREY = 'rgb(9, 9, 9)';
const SIDES = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = []) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'current', { onUnsupported: (m: string) => warnings.push(m) });
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

describe('an outline in currentColor', () => {
  it('is drawn in the colour of the text when it has no colour, with no warning', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; outline: 2px solid }`);
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
    assert.equal(props()['outlineWidth'], 2);
    assert.equal(props()['outlineStyle'], 'solid');
  });

  it('takes outline-color: currentColor as the colour the element inherits', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { outline-style: solid; outline-color: currentColor }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
  });

  it('takes currentColor written beside a token', () => {
    const { props, warnings } = tree(
      `.a { color: ${RED}; --w: 2px; outline: var(--w) solid currentColor }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
    assert.equal(props()['outlineWidth'], 2);
  });

  it('follows the colour when it changes', () => {
    const { engine, outer, props } = tree(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { outline: 2px solid }`,
      ['p'],
    );
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(props()['outlineColor'], BLUE);
  });
});

describe('a background in currentColor', () => {
  it('is the colour of the text, with no warning', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; background-color: currentColor }`);
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
  });

  it('is the colour the element inherits, from the shorthand too', () => {
    const { props, warnings } = tree(`.p { color: ${RED} } .a { background: currentColor }`, ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
  });

  it('follows its own colour when that changes', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: currentColor } .b { color: ${BLUE} }`,
    );
    engine.addClass(node, 'b');
    engine.commit();
    assert.equal(props()['backgroundColor'], BLUE);
  });
});

describe('a var() that is currentColor', () => {
  it('falls back to the colour of the text, in a stylesheet', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { background-color: var(--c, currentColor); ` +
        'outline: 2px solid; outline-color: var(--c, currentColor); ' +
        'border: 2px solid; border-color: var(--c, currentColor) }',
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
    assert.equal(props()['outlineColor'], RED);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });

  it('takes the token when one is set on the element instead of falling back', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: var(--c, currentColor) }`,
    );
    engine.setCustomProperty(node, '--c', BLUE);
    engine.commit();
    assert.equal(props()['backgroundColor'], BLUE);
  });

  it('is the colour of the text where the token is used, not where it is set', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED}; --c: currentColor } .a { color: ${BLUE}; ` +
        `background-color: var(--c); border: 2px solid ${GREY}; border-color: var(--c) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], BLUE);
    assert.deepEqual(colours(props()), [BLUE, BLUE, BLUE, BLUE]);
  });

  it('is the colour of the text when the token is set on the element', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: var(--c, ${GREY}); outline: 2px solid var(--c) }`,
    );
    engine.setCustomProperty(node, '--c', 'currentColor');
    engine.commit();
    assert.equal(props()['backgroundColor'], RED);
    assert.equal(props()['outlineColor'], RED);
  });

  it('is the inherited colour on color itself, as CSS reads currentColor there', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { color: ${BLUE} } .p .a { color: var(--c, currentColor) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['color'], RED);
  });

  it('draws a line whose colour token is currentColor in the colour of the text', () => {
    const { props, warnings } = tree(
      `.p { --c: currentColor } .a { color: ${RED}; border: 2px solid var(--c) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
    assert.equal(props()['borderTopWidth'], 2);
  });
});

describe("a border whose width is a calc() of a token, as Bootstrap's .table-group-divider", () => {
  const divider = '.a { border-top: calc(var(--w) * 2) solid currentcolor }';

  it('is as wide as the token works out to, in the colour of the text, with no warning', () => {
    const { props, warnings } = tree(`.p { color: ${RED}; --w: 1px } ${divider}`, ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['borderTopColor'], RED);
    assert.equal(props()['borderBottomWidth'], undefined);
  });

  it('takes the token when it is set on the element', () => {
    const { engine, node, props } = tree(`.p { color: ${RED} } ${divider}`, ['p']);
    engine.setCustomProperty(node, '--w', '3px');
    engine.commit();
    assert.equal(props()['borderTopWidth'], 6);
    assert.equal(props()['borderTopColor'], RED);
  });

  it('takes a written colour too', () => {
    const { props, warnings } = tree(
      `.a { --w: 1px; border-bottom: calc(var(--w) * 3) solid ${BLUE} }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderBottomWidth'], 3);
    assert.equal(props()['borderBottomColor'], BLUE);
  });

  it('is no border below zero, as CSS clamps a line width', () => {
    const { props } = tree(`.a { --w: 1px; border-top: calc(var(--w) - 2px) solid ${BLUE} }`);
    assert.equal(props()['borderTopWidth'], 0);
    const em = tree(`.a { font-size: 10px; --w: 0.1em; border-top: calc(var(--w) - 2px) solid }`);
    assert.equal(em.props()['borderTopWidth'], 0);
  });

  it('unsets the whole line when its token is unset, as a line of tokens does', () => {
    // CSS makes the shorthand invalid then: its style and colour go with its width.
    for (const later of ['', ' border-width: 5px']) {
      const calc = tree(`.a { border-top: calc(var(--missing) * 2) solid ${BLUE};${later} }`);
      const token = tree(`.a { border-top: var(--missing) solid ${BLUE};${later} }`);
      assert.deepEqual(calc.props(), token.props(), later);
    }
  });

  it('takes a calc() beside another token, which gives the colour', () => {
    const { props, warnings } = tree(
      `.a { --w: 1px; --c: ${BLUE}; border-top: calc(var(--w) * 2) solid var(--c) }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['borderTopColor'], BLUE);
  });
});
