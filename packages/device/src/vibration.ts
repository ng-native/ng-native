/**
 * Vibration, which is not haptics.
 *
 * `Haptics` is the Taptic Engine: a tap, a nudge, a success chime you feel rather than hear, tied
 * to something the user just did. This is the motor - a buzz of a stated length, or a pattern -
 * and it is what an alarm, a timer or an incoming call uses. An app that wants feedback for a
 * button press wants the other one.
 *
 * iOS has one duration and ignores the number, so a pattern there is on and off at a fixed
 * strength; Android takes the milliseconds as written. Both are said plainly rather than papered
 * over, because a pattern designed on Android does not feel the same on iOS and nothing here can
 * make it.
 */

import { injectOs } from './os.ts';
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

export interface NativeVibration {
  vibrate(pattern?: number | number[], repeat?: boolean): void;
  cancel(): void;
}

@Service()
export class Vibration {
  /** Overridden in a test to record a buzz without one happening. */
  static readonly SOURCE = new InjectionToken<NativeVibration | null>(
    'angular-native.vibrationSource',
    { factory: () => reactNative()?.Vibration ?? null },
  );

  private readonly native = inject(Vibration.SOURCE);

  /** Whether the device can vibrate: absent on a Mac, which has no motor to drive. */
  readonly available: Signal<boolean> = signal(
    this.native !== null && injectOs() !== 'macos',
  ).asReadonly();

  /** A single buzz. The duration is Android's; iOS vibrates for its own fixed length. */
  buzz(durationMs = 400): void {
    this.native?.vibrate(durationMs);
  }

  /**
   * A pattern of waits and buzzes, in milliseconds, starting with a wait.
   *
   * `repeat` runs it until `stop()`, which is for something that must be answered - an alarm, a
   * call - and is a promise to call `stop` rather than a decoration.
   */
  pattern(millis: readonly number[], options: { repeat?: boolean } = {}): void {
    this.native?.vibrate([...millis], options.repeat ?? false);
  }

  stop(): void {
    this.native?.cancel();
  }
}
