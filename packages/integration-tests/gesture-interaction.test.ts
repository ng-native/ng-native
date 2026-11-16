/**
 * A native gesture that ended, as the interaction an observer hears: what kind of interaction it
 * was, which way it went and how far. The numbers are the end event's, in the library's units.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SWIPE_VELOCITY } from '@ng-native/components';
import type { GestureEndValues } from '../components/src/gesture-backend.ts';
import { gestureInteraction } from '../components/src/gesture-interaction.ts';
import { trackedGestures, untrackedGesture } from '../components/src/gesture-tracking.ts';

const ended = (
  handlerName: string,
  end: Omit<GestureEndValues, 'handlerTag'>,
  directions?: number,
) => gestureInteraction({ handlerName, directions, end: { handlerTag: 1, ...end } });

/** Points per second, the library's velocity unit, at the swipe threshold. */
const SWIPE = SWIPE_VELOCITY * 1000;

describe('gesture interaction', () => {
  it('reports a tap as a click, where it landed', () => {
    assert.deepEqual(ended('TapGestureHandler', { x: 3, y: 4, absoluteX: 30, absoluteY: 40 }), {
      type: 'click',
      gesture: 'tap',
      pageX: 30,
      pageY: 40,
      locationX: 3,
      locationY: 4,
    });
  });

  it('reports a long press as a long-press', () => {
    assert.deepEqual(ended('LongPressGestureHandler', { x: 1, y: 2 }), {
      type: 'long-press',
      gesture: 'long-press',
      locationX: 1,
      locationY: 2,
    });
  });

  it('reports a pan released at a flick speed as a swipe the way the finger went', () => {
    assert.deepEqual(
      ended('PanGestureHandler', {
        translationX: -120,
        translationY: 30,
        velocityX: -SWIPE,
        velocityY: 0,
      }),
      { type: 'swipe', gesture: 'pan', direction: 'left', distance: 124 },
    );
  });

  it('reports a slower pan as a gesture, with its direction and distance', () => {
    assert.deepEqual(
      ended('PanGestureHandler', {
        translationX: 6,
        translationY: 80,
        velocityX: 0,
        velocityY: SWIPE * 0.99,
      }),
      { type: 'gesture', gesture: 'pan', direction: 'down', distance: 80 },
    );
    assert.deepEqual(
      ended('PanGestureHandler', {
        translationX: 0,
        translationY: -50,
        velocityX: 0,
        velocityY: -SWIPE * 3,
      }),
      { type: 'swipe', gesture: 'pan', direction: 'up', distance: 50 },
    );
  });

  it('goes by the vertical axis when a pan moved as far along both', () => {
    assert.deepEqual(
      ended('PanGestureHandler', {
        translationX: -30,
        translationY: 30,
        velocityX: 0,
        velocityY: 0,
      }),
      { type: 'gesture', gesture: 'pan', direction: 'down', distance: 42 },
      'as a scroll view does',
    );
  });

  it('reports a fast pan that went nowhere as a gesture with no direction', () => {
    assert.deepEqual(
      ended('PanGestureHandler', { translationX: 0, translationY: 0, velocityX: SWIPE * 2 }),
      { type: 'gesture', gesture: 'pan', distance: 0 },
    );
  });

  it('reports a fling as a swipe the way it was set to go', () => {
    assert.deepEqual(
      ended('FlingGestureHandler', {}),
      {
        type: 'swipe',
        gesture: 'fling',
        direction: 'right',
      },
      'the library flings right by default',
    );
    assert.deepEqual(ended('FlingGestureHandler', {}, 8), {
      type: 'swipe',
      gesture: 'fling',
      direction: 'down',
    });
  });

  it('reports how far a fling went, from where the finger came down', () => {
    assert.deepEqual(
      ended('FlingGestureHandler', { startX: 10, startY: 50, absoluteX: 70, absoluteY: 130 }),
      { type: 'swipe', gesture: 'fling', direction: 'right', distance: 100 },
      'the direction it was set to, and the distance the finger moved',
    );
  });

  it('reports a fling set to several directions by the way the finger moved', () => {
    const LEFT_OR_UP = 2 | 4;
    assert.deepEqual(
      ended(
        'FlingGestureHandler',
        { startX: 200, startY: 300, absoluteX: 190, absoluteY: 220 },
        LEFT_OR_UP,
      ),
      { type: 'swipe', gesture: 'fling', direction: 'up', distance: 81 },
    );
    assert.deepEqual(
      ended(
        'FlingGestureHandler',
        { startX: 200, startY: 300, absoluteX: 120, absoluteY: 290 },
        LEFT_OR_UP,
      ),
      { type: 'swipe', gesture: 'fling', direction: 'left', distance: 81 },
    );
    assert.deepEqual(
      ended('FlingGestureHandler', { absoluteX: 190, absoluteY: 220 }, LEFT_OR_UP),
      { type: 'swipe', gesture: 'fling' },
      'and with no start, no direction rather than a wrong one',
    );
    assert.deepEqual(
      ended('FlingGestureHandler', { startX: 200, absoluteX: 190, absoluteY: 220 }, LEFT_OR_UP),
      { type: 'swipe', gesture: 'fling' },
      'nor with half of one',
    );
    assert.deepEqual(
      ended('FlingGestureHandler', { startX: 200, startY: 300, absoluteX: 190 }, LEFT_OR_UP),
      { type: 'swipe', gesture: 'fling' },
      'nor with half of an end',
    );
  });

  it('reports a pinch with its scale, and a rotation, as gestures', () => {
    assert.deepEqual(ended('PinchGestureHandler', { scale: 1.8 }), {
      type: 'gesture',
      gesture: 'pinch',
      scale: 1.8,
    });
    assert.deepEqual(ended('RotationGestureHandler', { scale: 3 }), {
      type: 'gesture',
      gesture: 'rotation',
    });
    assert.deepEqual(ended('ManualGestureHandler', {}), { type: 'gesture', gesture: 'manual' });
  });

  it('reports neither a hover nor a native view, which reports itself', () => {
    assert.equal(ended('HoverGestureHandler', {}), null);
    assert.equal(ended('NativeViewGestureHandler', {}), null);
  });
});

describe('gesture interaction, one gesture kept out', () => {
  /** A gesture as the library builds one: a single gesture attaches itself. */
  const gesture = (handlerName: string) => {
    const self = { handlerName, toGestureArray: () => [self] };
    return self;
  };
  /** A composed gesture attaches the single gestures it is made of. */
  const composed = (...parts: ReturnType<typeof gesture>[]) => ({
    toGestureArray: () => parts,
  });

  it('keeps an untracked gesture of a composed one out, and reports the rest', () => {
    const tap = gesture('TapGestureHandler');
    const pan = gesture('PanGestureHandler');
    const pinch = gesture('PinchGestureHandler');

    assert.equal(untrackedGesture(pan), pan, 'the same gesture, so it nests in a composition');
    assert.deepEqual(
      trackedGestures(composed(tap, pan, pinch).toGestureArray()).map((g) => g.handlerName),
      ['TapGestureHandler', 'PinchGestureHandler'],
    );
  });

  it('keeps every gesture of an untracked composed gesture out', () => {
    const tap = gesture('TapGestureHandler');
    const pan = gesture('PanGestureHandler');
    const pinch = gesture('PinchGestureHandler');
    const both = composed(pan, pinch);

    assert.equal(untrackedGesture(both), both);
    assert.deepEqual(
      trackedGestures([tap, ...both.toGestureArray()]).map((g) => g.handlerName),
      ['TapGestureHandler'],
    );
  });

  it('keeps a gesture with no gesture array of its own out, as the test stand-in builds one', () => {
    const standIn = { kind: 'Pan' };
    assert.equal(untrackedGesture(standIn), standIn);
    assert.deepEqual(trackedGestures([standIn, { kind: 'Tap' }]), [{ kind: 'Tap' }]);
  });
});
