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
import { reactNative } from './react-native.ts';

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
  /** Android only: the bar's own background. iOS has no such thing. */
  readonly backgroundColor?: string;
  /** Android only: whether content draws underneath the bar. */
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
}

/** RN spells the styles for its own platforms; `light` means light *content*, as CSS would. */
const BAR_STYLES = { default: 'default', light: 'light-content', dark: 'dark-content' } as const;

export function statusBarSource(): StatusBarSource {
  const native = reactNative();
  if (!native) {
    return {
      setStyle: () => {},
      setHidden: () => {},
      setBackgroundColor: () => {},
      setTranslucent: () => {},
      height: undefined,
    };
  }

  const { StatusBar } = native;
  return {
    setStyle: (style, animated) => StatusBar.setBarStyle(BAR_STYLES[style], animated),
    setHidden: (hidden, animation) => StatusBar.setHidden(hidden, animation),
    setBackgroundColor: (color, animated) => StatusBar.setBackgroundColor(color, animated),
    setTranslucent: (translucent) => StatusBar.setTranslucent(translucent),
    get height() {
      return StatusBar.currentHeight;
    },
  };
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
  private readonly scheme = inject(ColorScheme);
  private readonly stack = signal<readonly StatusBarState[]>([{}]);

  /** What is actually showing: every claim in order, later ones winning per property. */
  readonly state: Signal<StatusBarState> = computed(() =>
    this.stack().reduce((merged, entry) => ({ ...merged, ...entry }), {}),
  );

  /**
   * How tall it is, in points. Android reports it; iOS does not, and on iOS the number a layout
   * wants is the safe-area top inset, which `SafeArea` has.
   */
  readonly height: Signal<number> = signal(this.source.height ?? 0).asReadonly();

  constructor() {
    // Straight from the source rather than through an effect, so an `auto` bar changes in the same
    // turn as the scheme. The scheme is the listener's own: `ColorScheme.current` may not have
    // heard yet.
    const stop = inject(ColorScheme.SOURCE).subscribe((scheme) => {
      const { style, animated } = untracked(this.state);
      if (style === 'auto') this.source.setStyle(resolve(style, scheme), animated);
    });
    inject(DestroyRef).onDestroy(stop);
  }

  /** The base claim, for an app that sets the bar once at startup. */
  set(state: StatusBarState): void {
    this.stack.update((entries) => [state, ...entries.slice(1)]);
    this.apply();
  }

  /** A claim on top of whatever is there. Call the returned function to drop it. */
  push(state: StatusBarState): () => void {
    const entry = { ...state };
    this.stack.update((entries) => [...entries, entry]);
    this.apply();

    return () => {
      this.stack.update((entries) => entries.filter((one) => one !== entry));
      this.apply();
    };
  }

  /** The properties a claim has had the platform change, which no claim names any more. */
  private readonly changed = new Set<'style' | 'hidden' | 'translucent'>();

  /**
   * Push the merged state at the platform.
   *
   * Written whole rather than diffed: the platform's own setters are the cheap part. A property
   * the last claim to name it has dropped goes back to the platform's own, once. Not the
   * background color, whose own the theme decides. Read untracked, so an effect that sets the bar
   * does not also subscribe to it and run again on every later claim.
   */
  private apply(): void {
    const { style, hidden, animated, backgroundColor, translucent } = untracked(this.state);
    if (this.changes('style', style)) {
      this.source.setStyle(resolve(style ?? 'default', untracked(this.scheme.current)), animated);
    }
    if (this.changes('hidden', hidden)) {
      this.source.setHidden(hidden ?? false, animated ? 'fade' : undefined);
    }
    if (backgroundColor !== undefined) this.source.setBackgroundColor(backgroundColor, animated);
    if (this.changes('translucent', translucent)) {
      this.source.setTranslucent(translucent ?? false);
    }
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
