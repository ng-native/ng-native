/**
 * `Battery`, bound to `expo-battery`. For the work an app should not be doing on 5%.
 */
import { InjectionToken, Service, computed, inject, type Signal } from '@angular/core';
import { observed, observedFrom, type Observed } from './observed.ts';
import { expoModule, present } from './native.ts';

/** What the battery is doing. `unknown` is a real answer on a simulator. */
export type BatteryState = 'unknown' | 'unplugged' | 'charging' | 'full';

export interface BatterySources {
  level: Observed<number> | null;
  state: Observed<BatteryState> | null;
  saving: Observed<boolean> | null;
}

const NOTHING: BatterySources = { level: null, state: null, saving: null };

@Service()
export class Battery {
  /** Overridden in a test to drain a battery that is not there. */
  static readonly SOURCE = new InjectionToken<BatterySources>('angular-native.batterySource', {
    factory: () => {
      const expo = expoModule(
        'expo-battery',
        () => require('expo-battery') as typeof import('expo-battery'),
      );
      if (!expo) return NOTHING;
      // Missing from the build: stand-ins, to say so when they are read.
      if (!present(expo)) return { level: expo, state: expo, saving: expo } as never;

      /**
       * Expo's states are numbers, and one of them is Android-only.
       *
       * `NOT_CHARGING` means plugged in and holding, which for every purpose an app has is
       * charging: the battery is not going down.
       */
      const STATES: Record<number, BatteryState> = {
        [expo.BatteryState.UNKNOWN]: 'unknown',
        [expo.BatteryState.UNPLUGGED]: 'unplugged',
        [expo.BatteryState.CHARGING]: 'charging',
        [expo.BatteryState.FULL]: 'full',
        [expo.BatteryState.NOT_CHARGING]: 'full',
      };

      return {
        level: observedFrom(
          () => expo.getBatteryLevelAsync(),
          (listener) => expo.addBatteryLevelListener(({ batteryLevel }) => listener(batteryLevel)),
        ),
        state: observedFrom(
          async () => STATES[await expo.getBatteryStateAsync()] ?? 'unknown',
          (listener) =>
            expo.addBatteryStateListener(({ batteryState }) =>
              listener(STATES[batteryState] ?? 'unknown'),
            ),
        ),
        saving: observedFrom(
          () => expo.isLowPowerModeEnabledAsync(),
          (listener) => expo.addLowPowerModeListener(({ lowPowerMode }) => listener(lowPowerMode)),
        ),
      };
    },
  });

  private readonly sources = inject(Battery.SOURCE);
  private readonly reported: Signal<number> = observed(this.sources.level, 1);

  /**
   * Nought to one. One until the platform says otherwise: an app should not open dimmed.
   *
   * A negative reading is not a level. iOS answers `-1` where the battery level is unavailable -
   * every simulator, and a device that will not say - and Expo passes it through. Taken at face
   * value it is below every threshold an app has, so `low` is true and an app starts shedding
   * work on the one device that has no battery to save.
   */
  readonly level: Signal<number> = computed(() => {
    const level = this.reported();
    return level < 0 ? 1 : level;
  });

  /** Whether the platform will say. False on a simulator, and on a device that answers -1. */
  readonly known: Signal<boolean> = computed(() => this.reported() >= 0);
  readonly state: Signal<BatteryState> = observed(this.sources.state, 'unknown');
  /**
   * Low Power Mode on iOS, Battery Saver on Android. The signal to skip the background refresh,
   * drop the frame rate of a decoration, or stop prefetching.
   */
  readonly saving: Signal<boolean> = observed(this.sources.saving, false);

  readonly charging: Signal<boolean> = computed(
    () => this.state() === 'charging' || this.state() === 'full',
  );

  /**
   * Under a fifth and not charging: the point at which an app should start doing less.
   *
   * False whenever the level is unknown. "I cannot tell" and "almost flat" are not the same
   * answer, and only one of them is a reason to degrade.
   */
  readonly low: Signal<boolean> = computed(
    () => this.known() && this.level() <= 0.2 && !this.charging(),
  );
}
