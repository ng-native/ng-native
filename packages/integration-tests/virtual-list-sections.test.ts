/**
 * Variable row heights in a windowed list, which is what a section list actually needs: a header
 * and an item are different heights, so uniform maths cannot place them.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Keyboard, type KeyboardMetrics } from '@ng-native/device';
import {
  cleanup,
  fireEvent,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const slots = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((n) => n.props['position'] === 'absolute');

describe('virtual list with variable row heights', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let list: FakeFabricNode;
  let emitKeyboard: (metrics: KeyboardMetrics) => void = () => {};

  before(async () => {
    const mod = await compileFixture('fixtures/sections.ts');
    Component = mod['Sections'] as Type<unknown>;
  });

  afterEach(() => cleanup());

  beforeEach(async () => {
    const rendered = await render(Component, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => {
              emitKeyboard = fn;
              return () => {};
            },
            dismiss: () => {},
          },
        },
      ],
    });
    fabric = rendered.fabric;
    list = flatten(fabric.committed).find((n) => n.viewName === 'ScrollView')!;
    await fireEvent(list, 'layout', { layout: { height: 300 } });
  });

  it('sizes the canvas from the cumulative row heights', () => {
    // 30 sections: one 60px header plus nine 30px items each.
    const canvas = list.children[0]!.children[1]!;
    assert.equal(canvas.props['height'], 30 * (60 + 9 * 30));
  });

  it('places headers and items at their true offsets', () => {
    const placed = slots(fabric);
    assert.equal(placed[0]!.props['top'], 0);
    assert.equal(placed[0]!.props['height'], 60, 'header');
    assert.equal(placed[1]!.props['top'], 60);
    assert.equal(placed[1]!.props['height'], 30, 'item');
    assert.equal(placed[2]!.props['top'], 90);
  });

  it('binary-searches the offset table to find the first visible row', async () => {
    // Section 10 starts at 10 * 330 = 3300.
    await fireEvent.scroll(list, { contentOffset: { y: 3300 } });

    const texts = flatten(fabric.committed)
      .map((n) => n.props['text'])
      .filter((t): t is string => typeof t === 'string');
    assert.ok(texts.includes('section 10'), `landed on the right section: ${texts[0]}`);
    assert.ok(!texts.includes('section 0'), 'the top is gone');
  });

  it('renders only a window even with mixed heights', () => {
    // 300px viewport over 30px items, plus overscan. Nowhere near 300 rows.
    assert.ok(slots(fabric).length < 20, `${slots(fabric).length} rows rendered`);
  });
});
