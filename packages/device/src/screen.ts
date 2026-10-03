/**
 * How big the screen is, and which way up.
 *
 * The engine already tracks this for media queries, but only for the cascade: it resolves `@media`
 * and viewport units and tells nobody. Component logic that has to branch on size - a two-column
 * layout above a breakpoint, a different image for a tall screen - has no way to ask, and reaching
 * for `Dimensions.get` directly gets a value that never updates on rotation.
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
import { HostEngine, type Engine } from '@ng-native/fabric';
import { reactNative } from './react-native.ts';
import { SafeArea } from './safe-area.ts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Sizes {
  /**
   * What `Dimensions` calls the window, which is not always what the app can draw in.
   *
   * On Android 15 an app draws edge to edge, painting behind the status and navigation bars, and
   * this reports the area *between* them - short by their height. `Screen.window` prefers the
   * safe-area provider's measured frame for that reason; this is the fallback for the frame before
   * the provider has laid out.
   */
  readonly window: Size;
  /** The physical display. */
  readonly screen: Size;
}

export interface ScreenSource {
  current(): Sizes;
  subscribe(listener: (sizes: Sizes) => void): () => void;
}

const NOTHING: Sizes = { window: { width: 0, height: 0 }, screen: { width: 0, height: 0 } };

/** Tailwind's `md`. Below it a phone layout, at or above it a tablet one. */
export const COMPACT_WIDTH = 768;

export function screenSource(): ScreenSource {
  const native = reactNative();
  if (!native) return { current: () => NOTHING, subscribe: () => () => {} };

  return {
    current: () => ({
      window: native.Dimensions.get('window'),
      screen: native.Dimensions.get('screen'),
    }),
    subscribe: (listener) => {
      const subscription = native.Dimensions.addEventListener('change', (sizes) =>
        listener({ window: sizes.window, screen: sizes.screen }),
      );
      return () => subscription.remove();
    },
  };
}

/**
 * The screen as the engine was told it, where there is no React Native to ask: a test, whose
 * `conditions` size what `@media` sees, so the two views of the screen agree. Null on a host whose
 * engine keeps no viewport.
 */
function engineScreenSource(): ScreenSource | null {
  const engine = inject(HostEngine, { optional: true }) as Partial<
    Pick<Engine, 'viewport' | 'watchViewport'>
  > | null;
  if (!engine?.viewport) return null;
  const current = (): Sizes => ({ window: engine.viewport!, screen: engine.viewport! });
  return {
    current,
    subscribe: (listener) => engine.watchViewport?.(() => listener(current())) ?? (() => {}),
  };
}

@Service()
export class Screen {
  /** Overridden in a test to resize the screen, or rotate it. */
  static readonly SOURCE = new InjectionToken<ScreenSource>('angular-native.screenSource', {
    factory: () => (reactNative() ? screenSource() : (engineScreenSource() ?? screenSource())),
  });

  private readonly source = inject(Screen.SOURCE);
  private readonly safeArea = inject(SafeArea);
  private readonly sizes = signal<Sizes>(this.source.current());

  /**
   * What the app can draw in: the one almost everything wants.
   *
   * Measured by the safe-area provider rather than read from `Dimensions`, because on Android 15
   * an app draws edge to edge - behind the status and navigation bars - and `Dimensions` reports
   * the area between them instead. On a 1080x2400 phone that was 838.5pt against a real drawable
   * height of 914.3, so viewport units, height media queries and anything sizing itself from this
   * were all short by the bars. The provider measures the frame it was actually handed, which is
   * the drawable area by definition and on both platforms.
   *
   * `Dimensions` is the fallback for the one frame between mounting and the provider laying out,
   * because a window of zero for that frame would be worse than a slightly wrong one. An app with
   * no `<safe-area-provider>` never gets past the fallback, which is the behaviour it had before.
   */
  readonly window: Signal<Size> = computed(() => {
    const frame = this.safeArea.frame();
    return frame ? { width: frame.width, height: frame.height } : this.sizes().window;
  });
  /** The physical display, which on Android is larger than the window. */
  readonly display: Signal<Size> = computed(() => this.sizes().screen);
  readonly orientation: Signal<'portrait' | 'landscape'> = computed(() =>
    this.window().width > this.window().height ? 'landscape' : 'portrait',
  );

  /**
   * Whether the window is narrow enough to want the phone layout.
   *
   * The one branch a component library actually needs, and the reason it is a signal rather than
   * a media query: a sidebar that is a rail on an iPad and a sheet on a phone is not two sets of
   * classes on one tree, it is two different trees. shadcn's own sidebar branches in JavaScript
   * for exactly this reason, and `@media` in the stylesheet cannot decide which components to
   * build. Where the difference *is* only classes, write `md:` and let the cascade do it - the
   * compiler answers width, height and orientation queries, so Tailwind's breakpoints work.
   *
   * `COMPACT_WIDTH` is Tailwind's `md`, which is also the number `useIsMobile` uses upstream.
   * It is close to, but not the same as, iOS's own compact/regular width class: an iPad mini in
   * portrait is 744pt, which Apple calls regular and this calls compact. Close enough to be the
   * right default and named so an app that disagrees can say so.
   */
  readonly compact: Signal<boolean> = computed(() => this.window().width < COMPACT_WIDTH);

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe((sizes) => this.sizes.set(sizes)));
  }
}
