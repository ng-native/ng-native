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
  untracked,
  type Signal,
} from '@angular/core';
import { ColorScheme, type Scheme } from './color-scheme.ts';
import { mergeClaims } from './merge-claims.ts';
import { reactNative } from './react-native.ts';
import { WindowClaims, onWindowFront, sharedBySource } from './window-claims.ts';

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
  /** Calls `listener` when a window comes to the front, to be given the whole bar again. */
  onWindowFront?(listener: () => void): () => void;
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
  // One per module, so every app the runtime mounts claims the same bar.
  return sharedBySource(native, () => ({
    setStyle: (style) => void native.setStyle?.(style)?.catch(() => {}),
    setHidden: (hidden) => void native.setHidden?.(hidden)?.catch(() => {}),
    screensSetBar: true,
    onWindowFront,
  }));
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
  /** This app, among the apps claiming the bar: its scheme is what an `auto` style it claims follows. */
  private readonly owner: Owner = { scheme: inject(ColorScheme) };
  /** Every app's claims on this bar: the window is the runtime's, not an app's. */
  private readonly window = sharedBySource(this.source, () => new NavigationBarWindow(this.source));

  /** What is actually showing: every claim in order, later ones winning per property. */
  readonly state: Signal<NavigationBarState> = this.window.state;

  /**
   * What a screen with no `navigationBarHidden` of its own carries, so the claim still holds when
   * it appears. Empty but on Android. The router passes it on.
   */
  readonly forScreens: Signal<{ readonly hidden?: boolean }> = computed(() =>
    this.source.screensSetBar ? { hidden: this.state().hidden } : {},
  );

  constructor() {
    // Straight from the source, as `StatusBar` does, so the buttons change in the same turn as the
    // scheme.
    const stop = inject(ColorScheme.SOURCE).subscribe((scheme) =>
      this.window.schemeChanged(this.owner, scheme),
    );
    inject(DestroyRef).onDestroy(() => {
      stop();
      // An app that goes takes its claims with it, and leaves the bar to the apps still here.
      this.window.claims.drop(this.owner);
      this.window.apply();
    });
  }

  /** The base claim, for an app that sets the bar once at startup. */
  set(state: NavigationBarState): void {
    this.window.claims.setBase(this.owner, state);
    this.window.apply();
  }

  /** A claim on top of whatever is there. Call the returned function to drop it. */
  push(state: NavigationBarState): () => void {
    const drop = this.window.claims.push(this.owner, { ...state });
    this.window.apply();
    return () => {
      drop();
      this.window.apply();
    };
  }
}

interface Owner {
  readonly scheme: ColorScheme;
}

/** The bar, as every app on one source claims it. */
class NavigationBarWindow {
  readonly claims = new WindowClaims<NavigationBarState, Owner>();
  readonly state: Signal<NavigationBarState> = computed(() =>
    mergeClaims(this.claims.all().map((claim) => claim.value)),
  );

  /** The properties a claim has had the platform change, which no claim names any more. */
  private readonly changed = new Set<keyof NavigationBarState>();

  /** Whether a claim has ever set the style, after which an unclaimed bar follows the scheme. */
  private styled = false;

  private readonly source: NavigationBarSource;

  constructor(source: NavigationBarSource) {
    this.source = source;
    // Lives as long as the source, which is the runtime's.
    source.onWindowFront?.(() => this.apply(true));
  }

  /**
   * Android puts the buttons back to the new scheme's own on a scheme change, so a fixed style is
   * sent again too. A bar no style claim names any more is `auto`, once one has named a style, and
   * follows the scheme the listener heard.
   */
  schemeChanged(owner: Owner, scheme: Scheme): void {
    const claimed = untracked(() => this.styleOwner());
    if (claimed && claimed.owner !== owner) return;
    const style = claimed?.style ?? (this.styled ? 'auto' : undefined);
    if (style !== undefined) this.source.setStyle(resolve(style, scheme));
  }

  /**
   * Push the merged state at the platform. A property the last claim to name it has dropped goes
   * back, once: the style to `auto`, which then keeps following the scheme, and the bar to shown.
   * A window come to the front is given what is claimed, and an `auto` style once one was named.
   */
  apply(front = false): void {
    const { style, hidden } = untracked(this.state);
    if (this.changes('style', style) || (front && this.styled)) {
      this.styled = true;
      this.source.setStyle(
        resolve(
          style ?? 'auto',
          untracked(() => this.scheme()),
        ),
      );
    }
    if (this.changes('hidden', hidden)) this.source.setHidden(hidden ?? false);
  }

  /** The scheme of the app whose style is in force, or of the app that claimed last. */
  private scheme(): Scheme {
    const owner = this.styleOwner()?.owner ?? this.claims.owners().at(-1);
    return owner?.scheme.current() ?? 'light';
  }

  /** The style in force and the app whose claim it is. */
  private styleOwner(): { style: NavigationBarStyle; owner: Owner } | undefined {
    const claim = this.claims.last((state) => state.style !== undefined);
    return claim && { style: claim.value.style!, owner: claim.owner };
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
