/**
 * Android's navigation bar: the colour of its buttons, and whether it is there at all.
 *
 * The same stack of claims as `StatusBar`, so a video player can hide the bar while it is open and
 * the screen behind gets the bar back when it closes. `style: 'auto'` follows `ColorScheme`, a
 * theme the app sets included, and a fixed style holds through a scheme change.
 *
 * Driven through `expo-navigation-bar`'s native module, reached by name so nothing here imports the
 * package. Expo Go carries it; a development build has it once the app installs
 * `expo-navigation-bar`. Without it, and on iOS, which has no navigation bar, every claim is kept
 * but changes nothing.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { ColorScheme, type Scheme } from './color-scheme.ts';
import { reactNative } from './react-native.ts';

/**
 * The colour of the bar's buttons. `dark` is dark buttons, for a light screen behind them, and
 * `light` light ones, as `StatusBarStyle` names its text. `auto` is dark buttons in the light
 * colour scheme and light ones in the dark one, and follows `ColorScheme`.
 */
export type NavigationBarStyle = 'light' | 'dark' | 'auto';

/** What a claim asks for. Anything absent is left as whatever the claim underneath said. */
export interface NavigationBarState {
  readonly style?: NavigationBarStyle;
  /** Hide the bar until a swipe from the edge of the screen shows it for a moment. */
  readonly hidden?: boolean;
}

/** Where the bar actually is. A fake stands in for the platform in tests. */
export interface NavigationBarSource {
  setStyle(style: Exclude<NavigationBarStyle, 'auto'>): void;
  setHidden(hidden: boolean): void;
  /**
   * react-native-screens shows or hides the bar each time a screen appears, from that screen's own
   * `navigationBarHidden`, once any screen has set one. So a hidden claim rides on every screen too.
   */
  readonly screensSetBar?: boolean;
}

/** `expo-navigation-bar`'s native module, as much of it as this uses. */
interface NativeNavigationBar {
  setStyle?(style: 'light' | 'dark'): Promise<void>;
  setHidden?(hidden: boolean): Promise<void>;
}

const NONE: NavigationBarSource = { setStyle: () => {}, setHidden: () => {} };

export function navigationBarSource(): NavigationBarSource {
  if (reactNative()?.Platform?.OS !== 'android') return NONE;
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  const native = modules?.['ExpoNavigationBar'] as NativeNavigationBar | undefined;
  // Without the module a claim changes nothing, so it does not ride on the screens either, where
  // react-native-screens would hide the bar the next time one appears.
  if (!native) return NONE;
  return {
    setStyle: (style) => void native.setStyle?.(style)?.catch(() => {}),
    setHidden: (hidden) => void native.setHidden?.(hidden)?.catch(() => {}),
    screensSetBar: true,
  };
}

/**
 * A stack, not a setter, for the same reason as `StatusBar`'s: whatever hid the bar has to give it
 * back to whatever was there before. `push` returns the function that drops the claim.
 */
@Service()
export class NavigationBar {
  /** Overridden in a test to watch the bar without one on screen. */
  static readonly SOURCE = new InjectionToken<NavigationBarSource>(
    'angular-native.navigationBarSource',
    { factory: navigationBarSource },
  );

  private readonly source = inject(NavigationBar.SOURCE);
  private readonly scheme = inject(ColorScheme);
  private readonly stack = signal<readonly NavigationBarState[]>([{}]);

  /** What is actually showing: every claim in order, later ones winning per property. */
  readonly state: Signal<NavigationBarState> = computed(() =>
    this.stack().reduce((merged, entry) => ({ ...merged, ...entry }), {}),
  );

  /**
   * What a screen with no `navigationBarHidden` of its own carries, so the claim still holds when
   * it appears. Empty but on Android. The router passes it on.
   */
  readonly forScreens: Signal<{ readonly hidden?: boolean }> = computed(() =>
    this.source.screensSetBar ? { hidden: this.state().hidden } : {},
  );

  constructor() {
    // Straight from the source, as `StatusBar` does, so the buttons change in the same turn as the
    // scheme. Android puts the buttons back to the new scheme's own on a scheme change, so a fixed
    // style is sent again too. A bar no style claim names any more is `auto`, once one has named
    // a style.
    const stop = inject(ColorScheme.SOURCE).subscribe((scheme) => {
      const style = untracked(this.state).style ?? (this.styled ? 'auto' : undefined);
      if (style !== undefined) this.source.setStyle(resolve(style, scheme));
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /** The base claim, for an app that sets the bar once at startup. */
  set(state: NavigationBarState): void {
    this.stack.update((entries) => [state, ...entries.slice(1)]);
    this.apply();
  }

  /** A claim on top of whatever is there. Call the returned function to drop it. */
  push(state: NavigationBarState): () => void {
    const entry = { ...state };
    this.stack.update((entries) => [...entries, entry]);
    this.apply();
    return () => {
      this.stack.update((entries) => entries.filter((one) => one !== entry));
      this.apply();
    };
  }

  /** The properties a claim has had the platform change, which no claim names any more. */
  private readonly changed = new Set<keyof NavigationBarState>();

  /** Whether a claim has ever set the style, after which an unclaimed bar follows the scheme. */
  private styled = false;

  /**
   * Push the merged state at the platform. A property the last claim to name it has dropped goes
   * back, once: the style to `auto`, which then keeps following the scheme, and the bar to shown.
   */
  private apply(): void {
    const { style, hidden } = untracked(this.state);
    if (this.changes('style', style)) {
      this.styled = true;
      this.source.setStyle(resolve(style ?? 'auto', untracked(this.scheme.current)));
    }
    if (this.changes('hidden', hidden)) this.source.setHidden(hidden ?? false);
  }

  private changes(property: keyof NavigationBarState, value: unknown): boolean {
    if (value === undefined) return this.changed.delete(property);
    this.changed.add(property);
    return true;
  }
}

/** Dark buttons on the light scheme's light background, light ones on the dark one's. */
function resolve(style: NavigationBarStyle, scheme: Scheme): 'light' | 'dark' {
  if (style !== 'auto') return style;
  return scheme === 'dark' ? 'light' : 'dark';
}
