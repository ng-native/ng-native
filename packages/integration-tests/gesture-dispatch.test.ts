/**
 * The gesture state machine: raw events in, a gesture's own callbacks out.
 *
 * This is the one part of a gesture we write rather than borrow, it runs on the UI runtime where
 * nothing reports a mistake, and every branch of it is a callback an app declared and would
 * otherwise never see run. So it is tested here against the events native actually sends.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GESTURE_STATE,
  TOUCH_EVENT,
  gestureDispatcher,
  type GestureCallbacks,
  type GestureStateManager,
} from '../components/src/gesture-dispatch.ts';
import type { GestureEndValues } from '../components/src/gesture-backend.ts';

const TAG = 7;

/** A gesture that records the order its callbacks ran in, and what they were given. */
function recording(extra: Partial<GestureCallbacks> = {}) {
  const calls: [string, unknown?][] = [];
  const callbacks: GestureCallbacks = {
    handlerTag: TAG,
    onBegin: () => calls.push(['begin']),
    onStart: () => calls.push(['start']),
    onUpdate: (event) => calls.push(['update', event]),
    onEnd: (_event, success) => calls.push(['end', success]),
    onFinalize: (_event, success) => calls.push(['finalize', success]),
    ...extra,
  };
  return { calls, callbacks };
}

const manager: GestureStateManager = {
  begin: () => {},
  activate: () => {},
  fail: () => {},
  end: () => {},
};
const managers = (tag: number) => {
  seen.push(tag);
  return manager;
};
const seen: number[] = [];

const change = (oldState: number, state: number) => ({ handlerTag: TAG, oldState, state });

describe('gesture dispatch', () => {
  it('runs a whole successful gesture in order', () => {
    const { calls, callbacks } = recording();
    const dispatch = gestureDispatcher([callbacks], managers);

    dispatch(change(GESTURE_STATE.UNDETERMINED, GESTURE_STATE.BEGAN));
    dispatch(change(GESTURE_STATE.BEGAN, GESTURE_STATE.ACTIVE));
    dispatch({ handlerTag: TAG, translationX: 4 } as never);
    dispatch(change(GESTURE_STATE.ACTIVE, GESTURE_STATE.END));

    assert.deepEqual(
      calls.map(([name]) => name),
      ['begin', 'start', 'update', 'end', 'finalize'],
    );
    assert.equal(calls[3]![1], true, 'ended successfully');
  });

  it('finalizes without ending when the gesture never activated', () => {
    const { calls, callbacks } = recording();
    const dispatch = gestureDispatcher([callbacks], managers);

    dispatch(change(GESTURE_STATE.UNDETERMINED, GESTURE_STATE.BEGAN));
    dispatch(change(GESTURE_STATE.BEGAN, GESTURE_STATE.FAILED));

    assert.deepEqual(
      calls.map(([name]) => name),
      ['begin', 'finalize'],
      'no onEnd: a gesture that never started never ended',
    );
    assert.equal(calls[1]![1], false, 'and it did not succeed');
  });

  it('reports a cancelled gesture as an unsuccessful end', () => {
    const { calls, callbacks } = recording();
    const dispatch = gestureDispatcher([callbacks], managers);

    dispatch(change(GESTURE_STATE.BEGAN, GESTURE_STATE.ACTIVE));
    dispatch(change(GESTURE_STATE.ACTIVE, GESTURE_STATE.CANCELLED));

    assert.deepEqual(calls[1], ['end', false]);
    assert.deepEqual(calls[2], ['finalize', false]);
  });

  it('measures onChange against the event before it, and restarts each time', () => {
    const changes: number[] = [];
    const { callbacks } = recording({
      onChange: (event) => changes.push((event as { delta: number }).delta),
      changeEventCalculator: (current, previous) => ({
        delta: (current as { x: number }).x - ((previous as { x: number } | undefined)?.x ?? 0),
      }),
    });
    const dispatch = gestureDispatcher([callbacks], managers);

    dispatch(change(GESTURE_STATE.BEGAN, GESTURE_STATE.ACTIVE));
    dispatch({ handlerTag: TAG, x: 10 } as never);
    dispatch({ handlerTag: TAG, x: 25 } as never);
    // A second gesture on the same handler: the memory of the first must not carry into it.
    dispatch(change(GESTURE_STATE.ACTIVE, GESTURE_STATE.END));
    dispatch(change(GESTURE_STATE.BEGAN, GESTURE_STATE.ACTIVE));
    dispatch({ handlerTag: TAG, x: 3 } as never);

    assert.deepEqual(changes, [10, 15, 3]);
  });

  it('hands the touch callbacks one state manager per handler', () => {
    seen.length = 0;
    const got: string[] = [];
    const { callbacks } = recording({
      onTouchesDown: (_event, m) => got.push(m === manager ? 'down' : 'wrong'),
      onTouchesMove: () => got.push('move'),
      onTouchesUp: () => got.push('up'),
      onTouchesCancelled: () => got.push('cancelled'),
    });
    const dispatch = gestureDispatcher([callbacks], managers);

    for (const eventType of [
      TOUCH_EVENT.DOWN,
      TOUCH_EVENT.MOVE,
      TOUCH_EVENT.UP,
      TOUCH_EVENT.CANCELLED,
      TOUCH_EVENT.UNDETERMINED,
    ]) {
      dispatch({ handlerTag: TAG, eventType });
    }

    assert.deepEqual(got, ['down', 'move', 'up', 'cancelled'], 'and nothing for UNDETERMINED');
    assert.deepEqual(seen, [TAG], 'the manager is made once and kept');
  });

  it('ignores an event belonging to another gesture', () => {
    const { calls, callbacks } = recording();
    const dispatch = gestureDispatcher([callbacks], managers);

    dispatch({ handlerTag: TAG + 1, oldState: GESTURE_STATE.BEGAN, state: GESTURE_STATE.ACTIVE });

    assert.deepEqual(calls, [], 'a composition shares one dispatcher across its gestures');
  });
});

describe('gesture dispatch, reporting an end', () => {
  const began = {
    handlerTag: TAG,
    oldState: GESTURE_STATE.UNDETERMINED,
    state: GESTURE_STATE.BEGAN,
  };
  const start = (at: object = {}) => ({ ...began, absoluteX: 10, absoluteY: 20, ...at });
  const activate = change(GESTURE_STATE.BEGAN, GESTURE_STATE.ACTIVE);
  const ended = (from: number, to: number, values: object = {}) => ({
    ...change(from, to),
    ...values,
  });

  function reported(extra: Partial<GestureCallbacks> = {}) {
    const reports: GestureEndValues[] = [];
    const { calls, callbacks } = recording(extra);
    const dispatch = gestureDispatcher([callbacks], managers, (end) => {
      calls.push(['report']);
      reports.push(end);
    });
    return { calls, reports, dispatch };
  }

  it('reports a gesture that ends successfully, once, after its own onEnd', () => {
    const { calls, reports, dispatch } = reported();

    dispatch(start());
    dispatch(activate);
    dispatch({ handlerTag: TAG, translationX: 4 } as never);
    dispatch(
      ended(GESTURE_STATE.ACTIVE, GESTURE_STATE.END, {
        x: 5,
        y: 6,
        absoluteX: 70,
        absoluteY: 26,
        translationX: 60,
        translationY: 6,
        velocityX: 900,
        velocityY: 10,
        numberOfPointers: 1,
        pointerType: 'touch',
      }),
    );

    assert.deepEqual(
      calls.map(([name]) => name),
      ['begin', 'start', 'update', 'end', 'finalize', 'report'],
    );
    assert.deepEqual(reports, [
      {
        handlerTag: TAG,
        x: 5,
        y: 6,
        absoluteX: 70,
        absoluteY: 26,
        translationX: 60,
        translationY: 6,
        velocityX: 900,
        velocityY: 10,
        startX: 10,
        startY: 20,
      },
    ]);
  });

  it('reports nothing for a cancelled, failed or never-active gesture', () => {
    const { reports, dispatch } = reported();

    dispatch(start());
    dispatch(activate);
    dispatch(ended(GESTURE_STATE.ACTIVE, GESTURE_STATE.CANCELLED));
    dispatch(start());
    dispatch(activate);
    dispatch(ended(GESTURE_STATE.ACTIVE, GESTURE_STATE.FAILED));
    dispatch(start());
    dispatch(ended(GESTURE_STATE.BEGAN, GESTURE_STATE.FAILED));
    dispatch(start());
    dispatch(ended(GESTURE_STATE.BEGAN, GESTURE_STATE.END));

    assert.deepEqual(reports, []);
  });

  it('forgets where the last gesture started', () => {
    const { reports, dispatch } = reported();

    dispatch(start());
    dispatch(ended(GESTURE_STATE.BEGAN, GESTURE_STATE.FAILED));
    // Native can skip BEGAN: this gesture must not report the failed one's start as its own.
    dispatch(activate);
    dispatch(ended(GESTURE_STATE.ACTIVE, GESTURE_STATE.END));

    assert.deepEqual(reports, [{ handlerTag: TAG }]);
  });

  it('reports only the gesture of a composition that ended', () => {
    const reports: GestureEndValues[] = [];
    const other = TAG + 1;
    const dispatch = gestureDispatcher(
      [recording().callbacks, { ...recording().callbacks, handlerTag: other }],
      managers,
      (end) => reports.push(end),
    );

    dispatch({
      handlerTag: other,
      oldState: GESTURE_STATE.UNDETERMINED,
      state: GESTURE_STATE.BEGAN,
    });
    dispatch(start());
    dispatch({ handlerTag: other, oldState: GESTURE_STATE.BEGAN, state: GESTURE_STATE.ACTIVE });
    dispatch(activate);
    dispatch({ handlerTag: other, oldState: GESTURE_STATE.ACTIVE, state: GESTURE_STATE.CANCELLED });
    dispatch(ended(GESTURE_STATE.ACTIVE, GESTURE_STATE.END, { scale: 2 }));

    assert.deepEqual(reports, [{ handlerTag: TAG, scale: 2, startX: 10, startY: 20 }]);
  });

  it('reports only the gestures it was told to, and keeps the others out', () => {
    const reports: GestureEndValues[] = [];
    const other = TAG + 1;
    const dispatch = gestureDispatcher(
      [recording().callbacks, { ...recording().callbacks, handlerTag: other }],
      managers,
      (end) => reports.push(end),
      [TAG],
    );

    for (const handlerTag of [other, TAG]) {
      dispatch({ handlerTag, oldState: GESTURE_STATE.UNDETERMINED, state: GESTURE_STATE.BEGAN });
      dispatch({ handlerTag, oldState: GESTURE_STATE.BEGAN, state: GESTURE_STATE.ACTIVE });
      dispatch({ handlerTag, oldState: GESTURE_STATE.ACTIVE, state: GESTURE_STATE.END });
    }

    assert.deepEqual(reports, [{ handlerTag: TAG }]);
  });
});
