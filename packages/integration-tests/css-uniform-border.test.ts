/**
 * A border the same on every side, which native is given unsided as well: Android strokes a
 * rounded border, the only way it draws one dashed or dotted, from `borderWidth` and
 * `borderColor` alone, and only when every side equals them. Given the sides only, it fills each
 * side in as a solid quadrilateral: a dashed card with rounded corners was drawn solid there, and
 * dashed on iOS. The four sides are only known once the cascade is done and every token is read,
 * so these hold the props a view is committed with.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const RED = 'rgb(255, 0, 0)';

/** A view wearing `classes`, committed, with every warning collected. */
function view(css: string, classes: string[] = ['a']) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'border', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const node = engine.createElement('view', sheet);
  for (const name of classes) engine.addClass(node, name);
  engine.appendChild(engine.root, node);
  engine.commit();
  const props = () => fabric.committed[0]!.props;
  return { engine, node, props, warnings };
}

const sides = (props: Record<string, unknown>, part: 'Width' | 'Color') =>
  ['Top', 'Right', 'Bottom', 'Left'].map((side) => props[`border${side}${part}`]);

describe('a border the same on every side', () => {
  it('is given unsided as well, beside each side', () => {
    const { props, warnings } = view('.a { border: 1px dashed #8a7a66; border-radius: 12px }');
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderWidth'], 1);
    assert.equal(props()['borderColor'], 'rgb(138, 122, 102)');
    assert.equal(props()['borderStyle'], 'dashed');
    assert.deepEqual(sides(props(), 'Width'), [1, 1, 1, 1]);
  });

  it('is, with a colour from a token, as every Tailwind 4 colour is', () => {
    // `border border-dashed border-gray-300` is `border-color: var(--color-gray-300)`.
    const { props } = view(`.a { --line: ${RED}; border: 1px dashed; border-color: var(--line) }`);
    assert.equal(props()['borderColor'], RED);
    assert.equal(props()['borderWidth'], 1);
  });

  it('is, with a token for the colour in the shorthand', () => {
    const { props } = view(`.a { --line: ${RED}; border: 1px dashed var(--line) }`);
    assert.equal(props()['borderWidth'], 1);
    assert.equal(props()['borderColor'], RED);
  });

  it('is, with a width a token or the font size gives', () => {
    const token = view('.a { --w: 2px; border: 1px dashed red; border-width: var(--w) }');
    assert.equal(token.props()['borderWidth'], 2);
    const em = view('.a { font-size: 10px; border: 0.5em dashed red }');
    assert.equal(em.props()['borderWidth'], 5);
  });

  it('is, in a system colour, which each side holds as an object of its own', () => {
    const { props } = view('.a { border: 1px dashed; border-color: AccentColor }');
    assert.notEqual(props()['borderTopColor'], undefined);
    assert.deepEqual(props()['borderColor'], props()['borderTopColor']);
  });

  it('is, where a stronger rule gives every side a width of its own', () => {
    const css =
      '.a { border: 1px dashed red } ' +
      '.b { border-top-width: 2px; border-right-width: 2px; border-bottom-width: 2px; ' +
      'border-left-width: 2px }';
    assert.equal(view(css, ['a', 'b']).props()['borderWidth'], 2);
    // Preflight's `* { border: 0 solid }` under a width given side by side.
    const preflight =
      '* { border: 0 solid } ' +
      '.a { border-style: dashed; border-color: red; border-top-width: 2px; ' +
      'border-right-width: 2px; border-bottom-width: 2px; border-left-width: 2px }';
    assert.equal(view(preflight).props()['borderWidth'], 2);
  });

  it('is not, where the sides differ, and is taken back when they come to', () => {
    assert.equal('borderWidth' in view('.a { border-width: 1px 2px }').props(), false);
    assert.equal(
      'borderColor' in view('.a { border: 1px solid; border-color: red blue }').props(),
      false,
    );
    const { engine, node, props } = view(
      '.a { border: 1px dashed red } .b { border-top-width: 4px }',
    );
    assert.equal(props()['borderWidth'], 1);
    engine.addClass(node, 'b');
    engine.commit();
    assert.equal(props()['borderTopWidth'], 4);
    assert.equal(props()['borderWidth'] ?? null, null);
  });

  it('is not, where a logical side has a width of its own', () => {
    const { props } = view('.a { border: 1px dashed red; border-inline-start-width: 3px }');
    assert.equal('borderWidth' in props(), false);
  });

  it('is not, where there is no width to draw', () => {
    // Preflight writes this on every element: nothing is stroked, so nothing more is sent.
    const { props } = view('.a { border: 0 solid; border-color: red }');
    assert.equal('borderWidth' in props(), false);
    assert.equal('borderColor' in props(), false);
  });
});
