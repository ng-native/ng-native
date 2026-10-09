/**
 * Vibration, which React Native offers as two functions on a module: a buzz, a pattern, and the
 * stop a repeating pattern promises.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Vibration, type NativeVibration } from '@ng-native/device';
import { serviceWith } from './injected.ts';

/** What the platform was asked to do, in order. */
function recorder() {
  const calls: unknown[][] = [];
  const source: NativeVibration = {
    vibrate: (...args) => void calls.push(['vibrate', ...args]),
    cancel: () => void calls.push(['cancel']),
  };
  return { calls, vibration: serviceWith(Vibration.SOURCE, source, () => new Vibration()) };
}

describe('vibration', () => {
  it('buzzes for the length asked, and for 400ms when none is', () => {
    const { calls, vibration } = recorder();
    vibration.buzz();
    vibration.buzz(50);
    assert.deepEqual(calls, [
      ['vibrate', 400],
      ['vibrate', 50],
    ]);
  });

  it('plays a pattern once unless asked to repeat it', () => {
    const { calls, vibration } = recorder();
    vibration.pattern([0, 100, 50]);
    vibration.pattern([0, 100, 50], { repeat: true });
    assert.deepEqual(calls, [
      ['vibrate', [0, 100, 50], false],
      ['vibrate', [0, 100, 50], true],
    ]);
  });

  it("hands native a pattern of its own, not the caller's array", () => {
    const { calls, vibration } = recorder();
    const millis = Object.freeze([0, 100]);
    vibration.pattern(millis);
    assert.notEqual(calls[0]![1], millis);
  });

  it('stops', () => {
    const { calls, vibration } = recorder();
    vibration.stop();
    assert.deepEqual(calls, [['cancel']]);
  });

  it('does nothing off a device rather than throwing', () => {
    const vibration = serviceWith(Vibration.SOURCE, null, () => new Vibration());
    assert.doesNotThrow(() => {
      vibration.buzz();
      vibration.pattern([0, 100], { repeat: true });
      vibration.stop();
    });
  });
});
