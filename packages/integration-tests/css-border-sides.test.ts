/**
 * A border's style, side by side. CSS computes the width of a side styled `none` as 0, whatever
 * width another rule gives it, and each side has a style of its own: an outline drawn in three
 * pieces has `border-right: none` on the first and `border-width: 1px` for them all. Native has
 * one border style for every side, so the cascade keeps each side's and settles the widths.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StyleResolver, type StyleTarget } from '@ng-native/fabric';
import { compileCss } from '@ng-native/testing';

function resolvedStyle(css: string, classes: string[]): Record<string, unknown> {
  const node: StyleTarget = {
    name: 'view',
    parent: null,
    classes: new Set(classes),
    props: {},
    sheet: null,
    hostSheet: null,
    styleCache: null,
    styleDirty: true,
  };
  const resolver = new StyleResolver(compileCss(css, 'borders'), {
    width: 400,
    height: 800,
    colorScheme: 'light',
    fontScale: 1,
  } as never);
  return resolver.resolve(node, 1).style;
}

const widths = (style: Record<string, unknown>) =>
  ['Top', 'Right', 'Bottom', 'Left'].map((side) => style[`border${side}Width`]);

describe('a side of a border styled none', () => {
  it('is no width, under a width a stronger rule gives every side', () => {
    const css =
      '.piece { border: none; border-top: 1px solid; border-bottom: 1px solid } ' +
      '.lead { border-left: 1px solid; border-right: none } .outlined.piece { border-width: 2px }';
    const style = resolvedStyle(css, ['piece', 'lead', 'outlined']);
    assert.deepEqual(widths(style), [2, 0, 2, 2]);
    assert.equal(style['borderStyle'], 'solid');
  });

  it('is drawn again by a stronger rule that styles that side, or every side', () => {
    const none = '.a { border-right: none; border-width: 3px }';
    assert.equal(
      resolvedStyle(
        '.a { border: 5px solid } .b { border-right-style: none } .c { border-right-style: solid }',
        ['a', 'b', 'c'],
      )['borderRightWidth'],
      5,
      'the width it had before a rule between them styled it none',
    );
    // Every side styled none at once, and one of them drawn again: that side has the width
    // the box was given, and the others are still not drawn.
    const again = resolvedStyle(
      '.a { border-width: 5px; border-style: none } .b { border-top-style: solid }',
      ['a', 'b'],
    );
    assert.equal(again['borderTopWidth'], 5);
    assert.equal(again['borderRightWidth'], 0);
    assert.deepEqual(
      widths(resolvedStyle(`${none} .b { border-right: 1px solid }`, ['a', 'b'])),
      [3, 1, 3, 3],
    );
    assert.deepEqual(
      widths(resolvedStyle(`${none} .b { border: 1px solid red }`, ['a', 'b'])),
      [1, 1, 1, 1],
    );
    assert.deepEqual(
      widths(resolvedStyle(`${none} .b { border-style: dashed }`, ['a', 'b'])),
      [3, 3, 3, 3],
    );
  });

  it('is set by the longhand for one side, which draws a line a width was waiting for', () => {
    const style = resolvedStyle(
      '.a { border-bottom-width: 2px; border-bottom-style: solid } .b { border-top-style: none; border-top-width: 5px }',
      ['a', 'b'],
    );
    assert.deepEqual([style['borderBottomWidth'], style['borderTopWidth']], [2, 0]);
  });

  it('leaves no style for a side in what a view is given', () => {
    const style = resolvedStyle('.a { border: 1px solid red; border-left: none }', ['a']);
    assert.deepEqual(
      Object.keys(style).filter((key) => /^border\w+Style$/.test(key)),
      [],
    );
    assert.equal(style['borderStyle'], 'solid');
  });

  it('is still every side for a border with no style at all, under any width', () => {
    assert.deepEqual(
      widths(resolvedStyle('.a { border-style: none } .b { border-width: 2px }', ['a', 'b'])),
      [0, 0, 0, 0],
    );
  });
});
