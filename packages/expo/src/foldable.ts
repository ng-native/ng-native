/**
 * `Foldable`, bound to `expo-hinge` and `expo-foldables`: the hinge of a foldable device, an iPhone
 * Duo or an Android foldable.
 *
 * The posture and the angle come from `expo-hinge` (Expo SDK 58) while it reports a hinge, and from
 * `expo-foldables` otherwise. The fold comes from `expo-foldables` only, since `expo-hinge` does not
 * say where the fold crosses the window.
 *
 * On a phone that does not fold, on the web and in a test, it answers like a phone: not available,
 * `'unknown'`, no fold and no angle.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { expoModule, optional, present } from './native.ts';

/** How far the hinge is open. `'unknown'` without a hinge, or while the platform cannot say. */
export type HingePosture = 'closed' | 'partially-open' | 'fully-open' | 'unknown';

/** A rectangle in window coordinates, in points: measured from the window's top left corner. */
export interface FoldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the fold crosses the app's window. */
export interface Fold {
  /** The fold's area, in window coordinates. Zero wide or tall where the fold is a line. */
  readonly bounds: FoldRect;
  readonly orientation: 'horizontal' | 'vertical';
  /** Whether the fold splits the window in two, so content should stay off it. */
  readonly isSeparating: boolean;
  /** `'full'` where the fold area shows nothing, as with a physical gap between two screens. */
  readonly occlusion: 'none' | 'full';
}

/** What `expo-foldables` reports: the posture, and the fold while it crosses the window. */
export interface HingeState {
  readonly posture: HingePosture;
  readonly fold?: Fold;
}

interface Subscription {
  remove(): void;
}

/** `expo-foldables`' `Hinge`, as `Foldable.SOURCE` provides it. A test passes a stand-in. */
export interface NativeHinge {
  readonly isAvailable: boolean;
  readonly isAngleAvailable: boolean;
  getState(): HingeState | undefined;
  addOnStateChangeListener(listener: (state: HingeState | undefined) => void): Subscription;
  addOnAngleChangeListener(
    listener: (angle: number) => void,
    options?: { minDeltaDegrees?: number },
  ): Subscription;
}

/** What `expo-hinge` reports: the angle in degrees, and how far open the hinge is. */
export interface ExpoHingeReading {
  readonly angle: number;
  readonly status: 'closed' | 'partiallyOpen' | 'fullyOpen' | 'unknown';
}

/** `expo-hinge`, as `Foldable.HINGE` provides it. A test passes a stand-in. */
export interface ExpoHinge {
  /** Null on a device without a hinge, or an OS that cannot report one. */
  getHinge(): ExpoHingeReading | null;
  addHingeListener(listener: (event: { hinge: ExpoHingeReading | null }) => void): Subscription;
}

interface ExpoHingeModule {
  getHinge?(): ExpoHingeReading | null;
  addListener?(
    event: 'hingeChange',
    listener: (event: { hinge: ExpoHingeReading | null }) => void,
  ): Subscription;
}

const POSTURES: Readonly<Record<ExpoHingeReading['status'], HingePosture>> = {
  closed: 'closed',
  partiallyOpen: 'partially-open',
  fullyOpen: 'fully-open',
  unknown: 'unknown',
};

@Service()
export class Foldable {
  static readonly SOURCE = new InjectionToken<NativeHinge | null>('angular-native.hingeSource', {
    factory: () =>
      expoModule(
        'expo-foldables',
        () => (require('expo-foldables') as { Hinge: NativeHinge }).Hinge,
      ),
  });

  /**
   * `expo-hinge`, reached through its native module rather than its package, so an app without it
   * still builds. Null where it is not in the app.
   */
  static readonly HINGE = new InjectionToken<ExpoHinge | null>('angular-native.expoHinge', {
    factory: () => {
      const module = optional(() =>
        (
          require('expo-modules-core') as typeof import('expo-modules-core')
        ).requireOptionalNativeModule<ExpoHingeModule>('ExpoHinge'),
      );
      if (!module) return null;
      return {
        getHinge: () => module.getHinge?.() ?? null,
        addHingeListener: (listener) =>
          module.addListener?.('hingeChange', listener) ?? { remove: () => {} },
      };
    },
  });

  private readonly native = inject(Foldable.SOURCE);
  private readonly expoHinge = inject(Foldable.HINGE);
  private readonly state = signal<HingeState | undefined>(undefined);
  private readonly reading = signal<ExpoHingeReading | null>(null);
  private readonly angleState = signal<number | null>(null);
  private angleSubscription: Subscription | null = null;

  /** Whether the device reports a hinge. It can turn true shortly after launch. */
  readonly available: Signal<boolean> = computed(
    () => this.reading() !== null || this.state() !== undefined,
  );
  /**
   * `expo-foldables`' posture wherever `expo-hinge` cannot say, as on Android while the window does
   * not span the fold: `expo-foldables` works a closed device out from its angle.
   */
  readonly posture: Signal<HingePosture> = computed(() => {
    const posture = POSTURES[this.reading()?.status ?? 'unknown'] ?? 'unknown';
    return posture === 'unknown' ? (this.known()?.posture ?? 'unknown') : posture;
  });
  /**
   * Where the fold crosses the window, in window coordinates: a view that does not start at the
   * window's left edge subtracts its own offset. Null while it crosses no window, as on a closed
   * phone's cover display.
   */
  readonly fold: Signal<Fold | null> = computed(() => this.known()?.fold ?? null);
  /** The hinge angle in degrees, 0 shut and 180 flat. Null without an angle sensor. */
  readonly angle: Signal<number | null> = computed(() => {
    const reading = this.reading();
    if (reading) return reading.angle;
    this.known();
    return this.angleState();
  });
  /** Whether the fold splits the window, so content should stay off it. */
  readonly separating: Signal<boolean> = computed(() => this.fold()?.isSeparating ?? false);
  /** Half open with the fold running down the middle, like a book. */
  readonly book: Signal<boolean> = computed(() => this.halfOpen('vertical'));
  /** Half open with the fold running across, like a laptop. */
  readonly tabletop: Signal<boolean> = computed(() => this.halfOpen('horizontal'));

  constructor() {
    const subscriptions = [this.followExpoHinge(), this.followFoldables()];
    inject(DestroyRef).onDestroy(() => {
      subscriptions.forEach((subscription) => subscription?.remove());
      this.angleSubscription?.remove();
    });
  }

  private followExpoHinge(): Subscription | null {
    const expoHinge = this.expoHinge;
    if (!expoHinge) return null;
    const subscription = expoHinge.addHingeListener(({ hinge }) => this.reading.set(hinge));
    this.reading.set(expoHinge.getHinge());
    return subscription;
  }

  private followFoldables(): Subscription | null {
    const native = present(this.native);
    if (!native) return null;
    const subscription = native.addOnStateChangeListener((state) => this.update(state));
    this.update(native.getState());
    return subscription;
  }

  /**
   * The hinge's state, read as a use: a module missing from the build says what to install, unless
   * `expo-hinge` is there to answer instead.
   */
  private known(): HingeState | undefined {
    if (this.native && !present(this.native) && !this.expoHinge) this.native.getState();
    return this.state();
  }

  private update(state: HingeState | undefined): void {
    this.state.set(state);
    if (state === undefined) {
      this.stopFollowingAngle();
    } else {
      this.followAngle();
    }
  }

  private stopFollowingAngle(): void {
    this.angleSubscription?.remove();
    this.angleSubscription = null;
    this.angleState.set(null);
  }

  private followAngle(): void {
    const native = this.native;
    if (!native || this.angleSubscription || !native.isAngleAvailable) return;
    this.angleSubscription = native.addOnAngleChangeListener(
      (angle) => this.angleState.set(angle),
      { minDeltaDegrees: 0.5 },
    );
  }

  private halfOpen(orientation: Fold['orientation']): boolean {
    const fold = this.fold();
    return (
      this.posture() === 'partially-open' &&
      fold?.isSeparating === true &&
      fold.orientation === orientation
    );
  }
}
