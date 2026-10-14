/**
 * `DeviceOrientation`, bound to `expo-screen-orientation`.
 *
 * Named for the device rather than the screen because that is what it reports: a layout asking
 * which way *it* is laid out wants the `orientation` media feature, which needs none of this.
 * This is what a camera preview or a video player needs - a screen locked to portrait still has a
 * phone that is sideways.
 */
import { InjectionToken, Service, computed, inject, type Signal } from '@angular/core';
import { observed, observedFrom, type Observed } from './observed.ts';
import { expoModule, present } from './native.ts';

export type Orientation =
  'unknown' | 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';

/** What a screen may rotate to. `default` is portrait plus, on a phone, nothing else. */
export type OrientationLock = 'default' | 'all' | 'portrait' | 'landscape';

export interface OrientationSource {
  readonly reported: Observed<Orientation> | null;
  lock(lock: OrientationLock): Promise<void>;
  unlock(): Promise<void>;
}

const NOTHING: OrientationSource = {
  reported: null,
  lock: () => Promise.resolve(),
  unlock: () => Promise.resolve(),
};

@Service()
export class DeviceOrientation {
  /** Overridden in a test to rotate a device that is not there. */
  static readonly SOURCE = new InjectionToken<OrientationSource>(
    'angular-native.orientationSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-screen-orientation',
          () => require('expo-screen-orientation') as typeof import('expo-screen-orientation'),
        );
        if (!expo) return NOTHING;
        // Missing from the build: stand-ins, to say so when they are used.
        if (!present(expo)) return { reported: expo, lock: expo, unlock: expo } as never;

        const ORIENTATIONS: Record<number, Orientation> = {
          [expo.Orientation.UNKNOWN]: 'unknown',
          [expo.Orientation.PORTRAIT_UP]: 'portrait',
          [expo.Orientation.PORTRAIT_DOWN]: 'portrait-upside-down',
          [expo.Orientation.LANDSCAPE_LEFT]: 'landscape-left',
          [expo.Orientation.LANDSCAPE_RIGHT]: 'landscape-right',
        };
        const LOCKS: Record<OrientationLock, import('expo-screen-orientation').OrientationLock> = {
          default: expo.OrientationLock.DEFAULT,
          all: expo.OrientationLock.ALL,
          portrait: expo.OrientationLock.PORTRAIT,
          landscape: expo.OrientationLock.LANDSCAPE,
        };

        return {
          reported: observedFrom(
            async () => ORIENTATIONS[await expo.getOrientationAsync()] ?? 'unknown',
            (listener) =>
              expo.addOrientationChangeListener(({ orientationInfo }) =>
                listener(ORIENTATIONS[orientationInfo.orientation] ?? 'unknown'),
              ),
          ),
          lock: (lock) => expo.lockAsync(LOCKS[lock]),
          unlock: () => expo.unlockAsync(),
        };
      },
    },
  );

  private readonly source = inject(DeviceOrientation.SOURCE);

  readonly orientation: Signal<Orientation> = observed(this.source.reported, 'unknown');

  readonly landscape: Signal<boolean> = computed(() => this.orientation().startsWith('landscape'));

  /**
   * Pin the screen. Returns the function that unpins it, so a screen that wants landscape while
   * it is up can hand it to `DestroyRef.onDestroy` and not think about it again.
   */
  lock(lock: OrientationLock): () => void {
    // A stack, as the status bar's is: a screen pushed over one with a lock of its own releases
    // only its own, and the lock beneath it comes back rather than the whole app unlocking.
    const entry = { lock };
    this.locks.push(entry);
    void this.source.lock(lock);
    return () => {
      const at = this.locks.indexOf(entry);
      if (at === -1) return;
      this.locks.splice(at, 1);
      if (at < this.locks.length) return;
      const below = this.locks.at(-1);
      void (below ? this.source.lock(below.lock) : this.source.unlock());
    };
  }

  /** Every lock not yet released, the one in force last. */
  private readonly locks: { readonly lock: OrientationLock }[] = [];
}
