/**
 * The status bar: what colour its text is, whether it is there at all, and how tall it is.
 *
 * React Native only offers this as a component. `<StatusBar />` applies its style by *rendering*,
 * and does it through a stack of entries so that a screen pushed on top can change the bar and
 * the screen underneath gets its own back when that one leaves. None of the rendering survives
 * without React - but the statics underneath do, and the stack is exactly what a navigation-driven
 * app needs, so it is the part worth keeping.
 *
 * `expo-status-bar` is the same statics with a React component around them, so nothing here needs
 * that package installed.
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
import { mergeClaims } from './merge-claims.ts';
import { reactNative } from './react-native.ts';
import { WindowClaims, onWindowFront, sharedBySource } from './window-claims.ts';

/**
 * Dark text for a light bar, light text for a dark one. `default` is whatever the OS picks, which on
 * Android is light text whatever the scheme. `auto` is dark text in the light color scheme and
 * light text in the dark one, and follows `ColorScheme`, an in-app theme switch included.
 */
export type StatusBarStyle = 'default' | 'light' | 'dark' | 'auto';

/** A style the platform takes: `auto` is resolved against the color scheme before it gets there. */
export type PlatformStatusBarStyle = Exclude<StatusBarStyle, 'auto'>;

/** What a claim asks for. Anything absent is left as whatever the claim underneath said. */
export interface StatusBarState {
  readonly style?: StatusBarStyle;
  readonly hidden?: boolean;
  readonly animated?: boolean;
  /**
   * Android only: the bar's own background. iOS has no such thing.
   *
   * @deprecated Has no effect. Android apps on Expo SDK 57 draw edge-to-edge, where the status bar
   * has no background of its own and React Native ignores the change. Draw a view behind the bar
   * instead. Never sent on iOS.
   */
  readonly backgroundColor?: string;
  /**
   * Android only: whether content draws underneath the bar.
   *
   * @deprecated Has no effect. Android apps on Expo SDK 57 draw edge-to-edge, so content is always
   * underneath the bar and React Native ignores the change. Never sent on iOS.
   */
  readonly translucent?: boolean;
}

/** Where the bar actually is. A fake stands in for the platform in tests. */
export interface StatusBarSource {
  setStyle(style: PlatformStatusBarStyle, animated?: boolean): void;
  setHidden(hidden: boolean, animation?: 'none' | 'fade' | 'slide'): void;
  setBackgroundColor(color: string, animated?: boolean): void;
  setTranslucent(translucent: boolean): void;
  /** Android reports one; iOS does not, where the safe-area inset is the number that matters. */
  readonly height: number | undefined;
  /**
   * Android: react-native-screens sets the bar again each time a screen appears, from that screen's
   * own props or, with none, to light text and shown. So a claim has to ride on every screen too.
   */
  readonly screensSetBar?: boolean;
  /** Calls `listener` when a window comes to the front, to be given the whole bar again. */
  onWindowFront?(listener: () => void): () => void;
}

/** RN spells the styles for its own platforms; `light` means light *content*, as CSS would. */
const BAR_STYLES = { default: 'default', light: 'light-content', dark: 'dark-content' } as const;

const NONE: StatusBarSource = {
  setStyle: () => {},
  setHidden: () => {},
  setBackgroundColor: () => {},
  setTranslucent: () => {},
  height: undefined,
};

/** One per React Native, so every app the runtime mounts claims the same bar. */
export function statusBarSource(): StatusBarSource {
  const native = reactNative();
  if (!native) return NONE;
  return sharedBySource(native, () => nativeSource(native));
}

function nativeSource(native: NonNullable<ReturnType<typeof reactNative>>): StatusBarSource {
  const { StatusBar } = native;
  const android = native.Platform?.OS === 'android';
  // Android 16 draws an app targeting SDK 35 or later edge-to-edge whatever its theme says. Before
  // it, a theme can opt out, and React Native's own answer is the flag its status bar module
  // checks. That answer is not enough on its own: Expo Go on Android 16 reports false.
  const info = native.TurboModuleRegistry?.get('DeviceInfo') as
    { getConstants?(): { isEdgeToEdge?: boolean } } | null | undefined;
  // React Native 0.88 draws every Android app edge-to-edge, and removed both setters with it.
  const settable = typeof StatusBar.setBackgroundColor === 'function';
  const edgeToEdge =
    android &&
    (!settable ||
      Number(native.Platform.Version) >= 36 ||
      info?.getConstants?.().isEdgeToEdge === true);
  const warned = new Set<string>();
  return {
    setStyle: (style, animated) => StatusBar.setBarStyle(BAR_STYLES[style], animated),
    setHidden: (hidden, animation) => StatusBar.setHidden(hidden, animation),
    setBackgroundColor: (color, animated) => {
      if (!android) return;
      if (edgeToEdge) warnNoEffect('backgroundColor', warned);
      StatusBar.setBackgroundColor?.(color, animated);
    },
    setTranslucent: (translucent) => {
      if (!android) return;
      if (edgeToEdge) warnNoEffect('translucent', warned);
      StatusBar.setTranslucent?.(translucent);
    },
    get height() {
      return StatusBar.currentHeight;
    },
    screensSetBar: android,
    onWindowFront,
  };
}

declare const ngDevMode: unknown;

/**
 * Says, once per option and in development only, that Android ignores it. React Native's own
 * module returns early with "current activity is edge-to-edge", which only shows in logcat.
 */
function warnNoEffect(option: 'backgroundColor' | 'translucent', warned: Set<string>): void {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
  if (warned.has(option)) return;
  warned.add(option);
  console.warn(
    `[angular-native] StatusBar ${option} has no effect: Android draws the app edge-to-edge, ` +
      'so content is always under the status bar. See https://ng-native.com/guide/android-edge-to-edge',
  );
}

/**
 * A stack, not a setter.
 *
 * A modal that makes the bar light has to put back whatever the screen behind it asked for when
 * it is dismissed, and nothing else in an app remembers what that was. `push` returns the
 * function that drops the claim, so a screen can hand it straight to `DestroyRef.onDestroy`.
 */
@Service()
export class StatusBar {
  /** Overridden in a test to watch the bar without one on screen. */
  static readonly SOURCE = new InjectionToken<StatusBarSource>('angular-native.statusBarSource', {
    factory: statusBarSource,
  });

  private readonly source = inject(StatusBar.SOURCE);
  /** This app, among the apps claiming the bar: its scheme is what an `auto` style it claims follows. */
  private readonly owner: Owner = { scheme: inject(ColorScheme) };
  /** Every app's claims on this bar: the window is the runtime's, not an app's. */
  private readonly window = sharedBySource(this.source, () => new StatusBarWindow(this.source));

  /** What is actually showing: every claim in order, later ones winning per property. */
  readonly state: Signal<StatusBarState> = this.window.state;

  /**
   * How tall it is, in points. Android reports it; iOS does not, and on iOS the number a layout
   * wants is the safe-area top inset, which `SafeArea` has.
   */
  readonly height: Signal<number> = signal(this.source.height ?? 0).asReadonly();

  /**
   * What a screen with no style or visibility of its own carries, so the claim is still what shows
   * when it appears. Empty but on Android, where a screen appearing sets the bar from its own props
   * and falls back to light text otherwise. The router passes it on.
   */
  readonly forScreens: Signal<{
    readonly style?: PlatformStatusBarStyle;
    readonly hidden?: boolean;
  }> = computed(() => {
    if (!this.source.screensSetBar) return {};
    const { style, hidden } = this.state();
    return { style: style && this.window.resolve(style), hidden };
  });

  constructor() {
    // Straight from the source rather than through an effect, so an `auto` bar changes in the same
    // turn as the scheme. The scheme is the listener's own: `ColorScheme.current` may not have
    // heard yet.
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
  set(state: StatusBarState): void {
    this.window.claims.setBase(this.owner, state);
    this.window.apply();
  }

  /** A claim on top of whatever is there. Call the returned function to drop it. */
  push(state: StatusBarState): () => void {
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
class StatusBarWindow {
  readonly claims = new WindowClaims<StatusBarState, Owner>();
  readonly state: Signal<StatusBarState> = computed(() =>
    mergeClaims(this.claims.all().map((claim) => claim.value)),
  );

  /** The properties a claim has had the platform change, which no claim names any more. */
  private readonly changed = new Set<'style' | 'hidden' | 'translucent'>();

  private readonly source: StatusBarSource;

  constructor(source: StatusBarSource) {
    this.source = source;
    // Lives as long as the source, which is the runtime's.
    source.onWindowFront?.(() => this.apply(true));
  }

  /** `style` for the platform, `auto` by the scheme of the app whose claim the style is. */
  resolve(style: StatusBarStyle, scheme?: Scheme): PlatformStatusBarStyle {
    return resolve(style, scheme ?? this.styleOwner()?.scheme.current() ?? 'light');
  }

  schemeChanged(owner: Owner, scheme: Scheme): void {
    const { style, animated } = untracked(this.state);
    if (style !== 'auto' || untracked(() => this.styleOwner()) !== owner) return;
    this.source.setStyle(this.resolve(style, scheme), animated);
  }

  /**
   * Push the merged state at the platform.
   *
   * Written whole rather than diffed: the platform's own setters are the cheap part. A property
   * the last claim to name it has dropped goes back to the platform's own, once. Not the
   * background color, whose own the theme decides. Read untracked, so an effect that sets the bar
   * does not also subscribe to it and run again on every later claim. A window come to the front
   * is given what is claimed, with nothing animated and nothing put back.
   */
  apply(front = false): void {
    const { style, hidden, animated, backgroundColor, translucent } = untracked(this.state);
    const animate = front ? undefined : animated;
    if (this.changes('style', style)) {
      this.source.setStyle(
        untracked(() => this.resolve(style ?? 'default')),
        animate,
      );
    }
    if (this.changes('hidden', hidden)) {
      this.source.setHidden(hidden ?? false, animate ? 'fade' : undefined);
    }
    if (backgroundColor !== undefined) this.source.setBackgroundColor(backgroundColor, animate);
    if (this.changes('translucent', translucent)) {
      this.source.setTranslucent(translucent ?? false);
    }
  }

  /** The app whose claim the style in force comes from. */
  private styleOwner(): Owner | undefined {
    return this.claims.last((state) => state.style !== undefined)?.owner;
  }

  /** Whether to tell the platform: a claim names `property`, or the last one to has dropped. */
  private changes(property: 'style' | 'hidden' | 'translucent', value: unknown): boolean {
    if (value === undefined) return this.changed.delete(property);
    this.changed.add(property);
    return true;
  }
}

/** Dark text on the light scheme's light background, light text on the dark one's. */
function resolve(style: StatusBarStyle, scheme: Scheme): PlatformStatusBarStyle {
  if (style !== 'auto') return style;
  return scheme === 'dark' ? 'light' : 'dark';
}
