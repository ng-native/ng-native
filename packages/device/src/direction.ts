/**
 * Which way round the world is: left to right, or right to left.
 *
 * The cascade already mirrors the *paint*. `direction: rtl` flips padding, text alignment and the
 * order boxes are laid out in, and Yoga inherits that down the shadow tree without anyone asking,
 * so a stylesheet needs nothing from this file.
 *
 * What the cascade cannot do is tell TypeScript which way round the world is, and this library
 * computes position in TypeScript in several places: `anchor.ts` resolves an `align` of `start`
 * against an edge, the slider maps a drag's x delta onto a value, and the drawer, the sheet and
 * the sidebar all name an edge. Every one of those is a decision made before a style exists, so
 * every one of them needs an answer here rather than in CSS. It is the same reason Angular's CDK
 * ships `Directionality` rather than leaving direction to the stylesheet.
 *
 * A directive can override it for a subtree the way `[dir]` does, by providing a
 * `DirectionContext` in `Direction`'s place.
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
import { reactNative } from './react-native.ts';

export type LayoutDirection = 'ltr' | 'rtl';

export interface DirectionSource {
  current(): LayoutDirection;
  subscribe(listener: (direction: LayoutDirection) => void): () => void;
}

export function directionSource(): DirectionSource {
  const native = reactNative();
  if (!native) return { current: () => 'ltr', subscribe: () => () => {} };

  return {
    current: () => (native.I18nManager.isRTL ? 'rtl' : 'ltr'),
    // Nothing to subscribe to, and that is the platform rather than a gap here. React Native
    // settles the direction while the native side starts up, from the device's own locale;
    // `I18nManager.forceRTL` only takes effect after a restart, so `isRTL` cannot change under a
    // running app. The listener stays in the shape because the browser source genuinely does have
    // one - `document.dir` is a mutable attribute - and because a consumer should not have to know
    // which platform it is on to read a signal.
    subscribe: () => () => {},
  };
}

/**
 * The read side of a direction, which is all a consumer ever wants.
 *
 * Named separately from the service because a subtree's direction is not the device's:
 * a directive that overrides it for a subtree provides this in `Direction`'s place, exactly as
 * CDK's `Dir` implements `Directionality`. Everything that injects `Direction` gets whichever is
 * closest, and neither needs to know which it got.
 */
export interface DirectionContext {
  readonly current: Signal<LayoutDirection>;
  readonly rtl: Signal<boolean>;
}

@Service()
export class Direction implements DirectionContext {
  /** Overridden in a test to flip the world, and by `mount` to read the document instead. */
  static readonly SOURCE = new InjectionToken<DirectionSource>('angular-native.directionSource', {
    factory: directionSource,
  });

  private readonly source = inject(Direction.SOURCE);

  /** Whether the service is here: on every OS, where it answers what the OS reports. */
  readonly available: Signal<boolean> = signal(true).asReadonly();
  private readonly direction = signal<LayoutDirection>(this.source.current());

  readonly current: Signal<LayoutDirection> = this.direction.asReadonly();

  /** The same fact as a boolean, because most callers branch on it rather than switch. */
  readonly rtl: Signal<boolean> = computed(() => this.direction() === 'rtl');

  constructor() {
    inject(DestroyRef).onDestroy(
      this.source.subscribe((direction) => this.direction.set(direction)),
    );
  }
}
