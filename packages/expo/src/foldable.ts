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

export type HingePosture = 'closed' | 'partially-open' | 'fully-open' | 'unknown';

export interface FoldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Fold {
  readonly bounds: FoldRect;
  readonly orientation: 'horizontal' | 'vertical';
  readonly isSeparating: boolean;
  readonly occlusion: 'none' | 'full';
}

export interface HingeState {
  readonly posture: HingePosture;
  readonly fold?: Fold;
}

interface Subscription {
  remove(): void;
}

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

  readonly available: Signal<boolean> = computed(() => this.state() !== undefined);
  readonly posture: Signal<HingePosture> = computed(() => this.state()?.posture ?? 'unknown');
  readonly fold: Signal<Fold | null> = computed(() => this.state()?.fold ?? null);
  readonly angle: Signal<number | null> = this.angleState.asReadonly();
  readonly separating: Signal<boolean> = computed(() => this.fold()?.isSeparating ?? false);
  readonly book: Signal<boolean> = computed(() => this.halfOpen('vertical'));
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
    this.followAngle();
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
