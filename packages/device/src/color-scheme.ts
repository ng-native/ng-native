/**
 * Light or dark, as the user set it, or as the app sets it over them.
 *
 * Styling should use `@media (prefers-color-scheme: dark)`, which the engine resolves without
 * anything being injected. This is for the decisions CSS cannot make: which asset to load, which
 * status bar style to ask for, which of two native components to render.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

export type Scheme = 'light' | 'dark';

export interface ColorSchemeSource {
  current(): Scheme;
  subscribe(listener: (scheme: Scheme) => void): () => void;
  /** Put the whole app in one scheme, or back in the system's with null. */
  set?(scheme: Scheme | null): void;
}

/**
 * Every source's listeners, told of a scheme the app sets. React Native takes it at once but
 * reports it only when its root view next changes appearance, and on iOS a full-screen modal takes
 * that view out of the window, so the change arrived when the modal closed. The platform's own
 * report, when it comes, repeats the same scheme.
 */
const setListeners = new Set<() => void>();

/**
 * Android's `NgNativeColorScheme`, from `@ng-native/components`: on Android 12 and later it sets the
 * per-app night mode. React Native sets only AppCompat's default night mode, which an activity
 * that handles `uiMode` itself (Expo's does) loses to the system's scheme shortly after launch,
 * and native views would draw in the system's scheme under the app's CSS.
 */
function nightModeModule(): { setColorScheme?(scheme: string): void } | undefined {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return modules?.['NgNativeColorScheme'] as { setColorScheme?(scheme: string): void } | undefined;
}

export function colorSchemeSource(): ColorSchemeSource {
  const native = reactNative();
  if (!native) return { current: () => 'light', subscribe: () => () => {} };

  // `null` means the platform has no preference, which is light.
  const read = () => (native.Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
  return {
    current: read,
    subscribe: (listener) => {
      // Each scheme once: the platform's report repeats one the app set, and it also reports
      // appearance changes that are not the scheme.
      let last = read();
      const onChange = () => {
        const scheme = read();
        if (scheme === last) return;
        last = scheme;
        listener(scheme);
      };
      const subscription = native.Appearance.addChangeListener(onChange);
      setListeners.add(onChange);
      return () => {
        subscription.remove();
        setListeners.delete(onChange);
      };
    },
    set: (scheme) => {
      native.Appearance.setColorScheme?.(scheme ?? 'unspecified');
      nightModeModule()?.setColorScheme?.(scheme ?? 'unspecified');
      // Back to the system's waits for the platform's report: React Native resolves it from a
      // native cache that a full-screen modal on iOS can leave stale.
      if (scheme !== null) for (const listener of [...setListeners]) listener();
    },
  };
}

@Service()
export class ColorScheme {
  /** Overridden in a test to switch the theme. */
  static readonly SOURCE = new InjectionToken<ColorSchemeSource>(
    'angular-native.colorSchemeSource',
    { factory: colorSchemeSource },
  );

  private readonly source = inject(ColorScheme.SOURCE);

  /** Whether the service is here: on every OS, where it answers what the OS reports. */
  readonly available: Signal<boolean> = signal(true).asReadonly();
  private readonly scheme = signal<Scheme>(this.source.current());

  readonly current: Signal<Scheme> = this.scheme.asReadonly();

  /**
   * Put the whole app in `scheme`, whatever the system says, or back in the system's with null:
   * an in-app theme switch. The native chrome follows as well as the CSS, since it is the window's
   * own appearance that changes, and `current` and `prefers-color-scheme` follow the change.
   * In an Android 12+ build with `@ng-native/components`' native module, the system keeps the
   * scheme across launches until it is set again or handed back with null. On iOS, on earlier
   * Android and in Expo Go each launch starts in the system's.
   */
  set(scheme: Scheme | null): void {
    this.source.set?.(scheme);
  }

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe((scheme) => this.scheme.set(scheme)));
  }
}
