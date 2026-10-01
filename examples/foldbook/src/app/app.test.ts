import { Foldable, type HingeState, type NativeHinge } from '@ng-native/expo/foldable';
import { render, screen } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';

const fold = (isSeparating: boolean) => ({
  bounds: { x: 455, y: 0, width: 40, height: 669 },
  orientation: 'vertical' as const,
  isSeparating,
  occlusion: 'none' as const,
});

function fakeHinge(state: HingeState | undefined, angle?: number) {
  let listener: ((next: HingeState | undefined) => void) | null = null;
  let turn: ((next: number) => void) | null = null;
  const native: NativeHinge = {
    isAvailable: state !== undefined,
    isAngleAvailable: angle !== undefined,
    getState: () => state,
    addOnStateChangeListener: (next) => {
      listener = next;
      return { remove: () => (listener = null) };
    },
    addOnAngleChangeListener: (next) => {
      turn = next;
      if (angle !== undefined) next(angle);
      return { remove: () => (turn = null) };
    },
  };
  return {
    native,
    change: (next: HingeState) => listener?.(next),
    turn: (next: number) => turn?.(next),
  };
}

const start = (hinge: ReturnType<typeof fakeHinge>) =>
  render(App, { providers: [{ provide: Foldable.SOURCE, useValue: hinge.native }] });

test('shows the cover while the phone is closed', async () => {
  await start(fakeHinge({ posture: 'closed' }, 0));
  expect(screen.getByText('Open the phone to read')).toBeTruthy();
});

test('opens to two pages either side of the fold, with the angle', async () => {
  const hinge = fakeHinge({ posture: 'closed' }, 0);
  await start(hinge);

  hinge.change({ posture: 'partially-open', fold: fold(true) });
  hinge.turn(124);

  expect(await screen.findByText('Signals all the way down')).toBeTruthy();
  expect(screen.getByText('124°')).toBeTruthy();
  expect(screen.getByText('open like a book')).toBeTruthy();
});

test('becomes one wide page when the phone lies flat', async () => {
  await start(fakeHinge({ posture: 'fully-open', fold: fold(false) }, 180));
  expect(screen.getByText('180°')).toBeTruthy();
  expect(screen.getByText('open flat')).toBeTruthy();
  expect(screen.queryByText('Signals all the way down')).toBeNull();
});

test('reads as one page on a phone that does not fold', async () => {
  await start(fakeHinge(undefined));
  expect(screen.getByText('Reading the hinge')).toBeTruthy();
  expect(screen.queryByText('Open the phone to read')).toBeNull();
});
