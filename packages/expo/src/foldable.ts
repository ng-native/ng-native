/**
 * `Foldable`, bound to `expo-foldables`: the hinge of a foldable device, an iPhone Duo or an
 * Android foldable.
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
import { expoModule } from './native.ts';

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

@Service()
export class Foldable {
  static readonly SOURCE = new InjectionToken<NativeHinge | null>('angular-native.hingeSource', {
    factory: () =>
      expoModule(
        'expo-foldables',
        () => (require('expo-foldables') as { Hinge: NativeHinge }).Hinge,
      ),
  });

  private readonly native = inject(Foldable.SOURCE);
  private readonly state = signal<HingeState | undefined>(undefined);
  private readonly angleState = signal<number | null>(null);
  private angleSubscription: Subscription | null = null;

  /** Whether the device reports a hinge. It can turn true shortly after launch. */
  readonly available: Signal<boolean> = computed(() => this.state() !== undefined);
  readonly posture: Signal<HingePosture> = computed(() => this.state()?.posture ?? 'unknown');
  /**
   * Where the fold crosses the window, in window coordinates: a view that does not start at the
   * window's left edge subtracts its own offset. Null while it crosses no window, as on a closed
   * phone's cover display.
   */
  readonly fold: Signal<Fold | null> = computed(() => this.state()?.fold ?? null);
  /** The hinge angle in degrees, 0 shut and 180 flat. Null without an angle sensor. */
  readonly angle: Signal<number | null> = this.angleState.asReadonly();
  /** Whether the fold splits the window, so content should stay off it. */
  readonly separating: Signal<boolean> = computed(() => this.fold()?.isSeparating ?? false);
  /** Half open with the fold running down the middle, like a book. */
  readonly book: Signal<boolean> = computed(() => this.halfOpen('vertical'));
  /** Half open with the fold running across, like a laptop. */
  readonly tabletop: Signal<boolean> = computed(() => this.halfOpen('horizontal'));

  constructor() {
    const native = this.native;
    if (!native) return;
    const stateSubscription = native.addOnStateChangeListener((state) => this.update(state));
    this.update(native.getState());
    inject(DestroyRef).onDestroy(() => {
      stateSubscription.remove();
      this.angleSubscription?.remove();
    });
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
