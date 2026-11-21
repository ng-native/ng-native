/** What the visual matchers decide by: colours in their forms, and a node's committed style. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FakeFabricNode } from '../test-utils.ts';
import { inCapture, rgba, sameColour, styleMismatches } from './visual-compare.ts';

const node = (props: Record<string, unknown>) => ({ props }) as unknown as FakeFabricNode;

describe('colours, in every form a test or the engine writes one', () => {
  it('reads a CSS colour and the integer processColor gives as the same RGBA', () => {
    assert.deepEqual(rgba('#3366cc'), [51, 102, 204, 1]);
    assert.deepEqual(rgba(0xff3366cc), [51, 102, 204, 1], 'unsigned, as iOS has it');
    assert.deepEqual(rgba(0xff3366cc | 0), [51, 102, 204, 1], 'signed, as Android has it');
    assert.deepEqual(rgba(0x803366cc), [51, 102, 204, 128 / 255]);
  });

  it('matches within a tolerance of each channel', () => {
    assert.equal(sameColour([51, 102, 204, 1], [52, 102, 204, 1], 1), true);
    assert.equal(sameColour([51, 102, 204, 1], [53, 102, 204, 1], 1), false);
  });
});

describe("a node's committed style", () => {
  it('matches colours by value, lengths in points, and the rest as they are', () => {
    const card = node({
      backgroundColor: 0xff3366cc,
      borderRadius: 16,
      opacity: 0.5,
      flexDirection: 'row',
    });
    assert.deepEqual(
      styleMismatches(card, {
        backgroundColor: 'rgb(51 102 204)',
        borderRadius: '16px',
        opacity: 0.5,
        flexDirection: 'row',
      }),
      [],
    );
  });

  it('takes a shorthand the engine commits as longhands, every one of them', () => {
    const card = node({
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 4,
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    });
    assert.deepEqual(styleMismatches(card, { padding: '8px' }), []);
    assert.deepEqual(styleMismatches(card, { borderRadius: 12 }), [
      'borderBottomRightRadius: 12, got 4',
    ]);
    assert.deepEqual(
      styleMismatches(node({ borderRadius: 6 }), { borderRadius: 6 }),
      [],
      'one the node carries whole is compared whole',
    );
  });

  it('compares numbers exactly, and objects whatever order their keys are in', () => {
    assert.equal(styleMismatches(node({ flexGrow: 0.005 }), { flexGrow: 0 }).length, 1);
    assert.deepEqual(
      styleMismatches(node({ shadowOffset: { width: 2, height: 4 } }), {
        shadowOffset: { height: 4, width: 2 },
      }),
      [],
    );
    assert.equal(
      styleMismatches(node({ shadowOffset: { width: undefined } }), {
        shadowOffset: { height: undefined },
      }).length,
      1,
      'keys of their own, not just as many of them',
    );
    assert.equal(
      styleMismatches(node({ transform: [{ scale: 2 }, { rotate: '45deg' }] }), {
        transform: [{ rotate: '45deg' }, { scale: 2 }],
      }).length,
      1,
      'a transform in another order is another transform',
    );
  });

  it('names each property that differs, with what it has', () => {
    const card = node({ backgroundColor: 0xff3366cc, borderRadius: 16 });
    const misses = styleMismatches(card, {
      backgroundColor: 'red',
      borderRadius: 8,
      color: 'blue',
    });
    assert.equal(misses.length, 3);
    assert.match(
      misses[0]!,
      /^backgroundColor: rgba\(255, 0, 0, 1\), got rgba\(51, 102, 204, 1\)$/,
    );
    assert.match(misses[1]!, /^borderRadius: 8, got 16$/);
    assert.match(misses[2]!, /^color: .*got undefined$/, 'a colour the node does not have');
  });
});

describe('a colour prop the engine commits as something other than a colour string', () => {
  it('matches the same null, or the same processed value, as equal', () => {
    const node = { props: { backgroundColor: null, color: { semantic: ['label'] } } };
    assert.deepEqual(
      styleMismatches(node as unknown as FakeFabricNode, {
        backgroundColor: null,
        color: { semantic: ['label'] },
      }),
      [],
    );
    assert.equal(
      styleMismatches(node as unknown as FakeFabricNode, { backgroundColor: 'red' }).length,
      1,
    );
  });
});

describe('a point of a target, in the capture native took of it', () => {
  it('moves by what the window cut off at the left and top, and no more', () => {
    const offscreen = { x: -10, y: -4, width: 30, height: 10 };
    assert.deepEqual(inCapture(offscreen, [{ x: 15, y: 5 }]), [{ x: 5, y: 1 }]);
    assert.deepEqual(
      inCapture({ x: 8, y: 20, width: 30, height: 10 }, [{ x: 15, y: 5 }]),
      [{ x: 15, y: 5 }],
      'a target wholly in the window keeps its points',
    );
    assert.deepEqual(inCapture(null, [{ x: 15, y: 5 }]), [{ x: 15, y: 5 }], 'the whole window');
  });
});

describe('a CSS colour against the integer native is given', () => {
  it('matches at the precision native keeps, a step of 255 for each channel and alpha', () => {
    // processColor stores alpha 0.5 as 128 of 255 (0.502), and a fraction of a channel not at all.
    const argb = (0x80 << 24) | (51 << 16) | (102 << 8) | 204;
    const node = { props: { backgroundColor: argb >>> 0 } };
    assert.deepEqual(
      styleMismatches(node as unknown as FakeFabricNode, {
        backgroundColor: 'rgba(51.2, 102, 204, 0.5)',
      }),
      [],
    );
    assert.equal(
      styleMismatches(node as unknown as FakeFabricNode, {
        backgroundColor: 'rgba(51, 102, 204, 0.4)',
      }).length,
      1,
      'a different alpha still differs',
    );
  });
});

describe("a fraction of an rgb() channel, as React Native's processColor reads it", () => {
  it('drops it, where alpha and hsl() channels are rounded', () => {
    const red = (r: number) => ({
      props: { backgroundColor: ((0xff << 24) | (r << 16) | (102 << 8) | 204) >>> 0 },
    });
    const want = { backgroundColor: 'rgba(51.8, 102, 204, 1)' };
    assert.deepEqual(styleMismatches(red(51) as unknown as FakeFabricNode, want), []);
    assert.equal(styleMismatches(red(52) as unknown as FakeFabricNode, want).length, 1);
  });
});
