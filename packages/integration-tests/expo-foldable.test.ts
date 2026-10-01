import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { Foldable, type HingeState, type NativeHinge } from '@ng-native/expo/foldable';

const BOOK: HingeState = {
  posture: 'partially-open',
  fold: {
    bounds: { x: 200, y: 0, width: 0, height: 800 },
    orientation: 'vertical',
    isSeparating: true,
    occlusion: 'none',
  },
};

function fakeHinge(options: { state?: HingeState; angle?: boolean; angleFrom?: number } = {}) {
  const stateListeners = new Set<(state: HingeState | undefined) => void>();
  const angleListeners = new Set<(angle: number) => void>();
  let state = options.state;
  let angleAvailable = options.angle ?? true;
  const native: NativeHinge = {
    get isAvailable() {
      return state !== undefined;
    },
    get isAngleAvailable() {
      return angleAvailable;
    },
    getState: () => state,
    addOnStateChangeListener: (listener) => {
      stateListeners.add(listener);
      return { remove: () => stateListeners.delete(listener) };
    },
    addOnAngleChangeListener: (listener) => {
      if (!angleAvailable) throw new Error('no angle sensor');
      angleListeners.add(listener);
      if (options.angleFrom !== undefined) listener(options.angleFrom);
      return { remove: () => angleListeners.delete(listener) };
    },
  };
  return {
    native,
    change: (next: HingeState | undefined) => {
      state = next;
      stateListeners.forEach((listener) => listener(next));
    },
    turn: (angle: number) => angleListeners.forEach((listener) => listener(angle)),
    angleArrives: () => (angleAvailable = true),
    listening: () => stateListeners.size + angleListeners.size,
  };
}

function foldableWith(native: NativeHinge | null) {
  const injector = Injector.create({ providers: [{ provide: Foldable.SOURCE, useValue: native }] });
  const foldable = runInInjectionContext(injector, () => new Foldable());
  return { foldable, destroy: () => (injector as unknown as { destroy(): void }).destroy() };
}

describe('Foldable, on a phone with no hinge', () => {
  it('answers like a phone that does not fold', () => {
    const { foldable } = foldableWith(null);
    assert.equal(foldable.available(), false);
    assert.equal(foldable.posture(), 'unknown');
    assert.equal(foldable.fold(), null);
    assert.equal(foldable.angle(), null);
    assert.deepEqual(
      [foldable.separating(), foldable.book(), foldable.tabletop()],
      [false, false, false],
    );
  });
});

describe('Foldable, on a foldable', () => {
  it('reads the posture and the fold as it starts', () => {
    const { foldable } = foldableWith(fakeHinge({ state: BOOK }).native);
    assert.equal(foldable.available(), true);
    assert.equal(foldable.posture(), 'partially-open');
    assert.deepEqual(foldable.fold()?.bounds, { x: 200, y: 0, width: 0, height: 800 });
    assert.equal(foldable.separating(), true);
  });

  it('follows the posture as the device folds and unfolds', () => {
    const hinge = fakeHinge({ state: { posture: 'closed' } });
    const { foldable } = foldableWith(hinge.native);
    assert.equal(foldable.fold(), null, 'closed, on the cover display, the fold crosses no window');

    hinge.change(BOOK);
    assert.equal(foldable.book(), true);
    hinge.change({ posture: 'fully-open', fold: { ...BOOK.fold!, isSeparating: false } });
    assert.equal(foldable.posture(), 'fully-open');
    assert.deepEqual([foldable.book(), foldable.separating()], [false, false]);
  });

  it('tells book from tabletop by the way the fold runs', () => {
    const hinge = fakeHinge({ state: BOOK });
    const { foldable } = foldableWith(hinge.native);
    assert.deepEqual([foldable.book(), foldable.tabletop()], [true, false]);
    hinge.change({ ...BOOK, fold: { ...BOOK.fold!, orientation: 'horizontal' } });
    assert.deepEqual([foldable.book(), foldable.tabletop()], [false, true]);
  });

  it('follows the angle, starting from the one already known', () => {
    const hinge = fakeHinge({ state: BOOK, angleFrom: 127 });
    const { foldable } = foldableWith(hinge.native);
    assert.equal(foldable.angle(), 127);
    hinge.turn(150);
    assert.equal(foldable.angle(), 150);
  });

  it('starts following the angle once the sensor turns up after launch', () => {
    const hinge = fakeHinge({ angle: false });
    const { foldable } = foldableWith(hinge.native);
    assert.equal(foldable.available(), false, 'no hinge reported yet');

    hinge.angleArrives();
    hinge.change(BOOK);
    hinge.turn(90);
    assert.equal(foldable.available(), true);
    assert.equal(foldable.angle(), 90);
  });

  it('keeps no angle where the device has no angle sensor', () => {
    const hinge = fakeHinge({ state: BOOK, angle: false });
    const { foldable } = foldableWith(hinge.native);
    hinge.change(BOOK);
    assert.equal(foldable.angle(), null);
  });

  it('becomes a phone again when the device stops reporting a hinge', () => {
    const hinge = fakeHinge({ state: BOOK, angleFrom: 127 });
    const { foldable } = foldableWith(hinge.native);
    hinge.change(undefined);
    assert.deepEqual(
      [foldable.available(), foldable.posture(), foldable.fold(), foldable.angle()],
      [false, 'unknown', null, null],
    );
    assert.equal(hinge.listening(), 1, 'the angle is not followed without a hinge');
  });

  it('reads the angle afresh when the hinge comes back', () => {
    const hinge = fakeHinge({ state: BOOK, angleFrom: 127 });
    const { foldable } = foldableWith(hinge.native);
    hinge.change(undefined);
    hinge.change(BOOK);
    assert.equal(foldable.angle(), 127);
    assert.equal(hinge.listening(), 2);
  });

  it('stops listening when the app is destroyed', () => {
    const hinge = fakeHinge({ state: BOOK, angleFrom: 100 });
    const { destroy } = foldableWith(hinge.native);
    assert.equal(hinge.listening(), 2);
    destroy();
    assert.equal(hinge.listening(), 0);
  });
});
