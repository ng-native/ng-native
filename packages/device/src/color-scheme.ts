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

export function colorSchemeSource(): ColorSchemeSource {
  const native = reactNative();
  if (!native) return { current: () => 'light', subscribe: () => () => {} };

  // `null` means the platform has no preference, which is light.
  const read = () => (native.Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
  return {
    current: read,
    subscribe: (listener) => {
      const subscription = native.Appearance.addChangeListener(() => listener(read()));
      const onSet = () => listener(read());
      setListeners.add(onSet);
      return () => {
        subscription.remove();
        setListeners.delete(onSet);
      };
    },
    set: (scheme) => {
      native.Appearance.setColorScheme?.(scheme ?? 'unspecified');
      for (const listener of [...setListeners]) listener();
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
  private readonly scheme = signal<Scheme>(this.source.current());

  readonly current: Signal<Scheme> = this.scheme.asReadonly();

  /**
   * Put the whole app in `scheme`, whatever the system says, or back in the system's with null:
   * an in-app theme switch. The native chrome follows as well as the CSS, since it is the window's
   * own appearance that changes, and `current` and `prefers-color-scheme` follow the change.
   */
  set(scheme: Scheme | null): void {
    this.source.set?.(scheme);
  }

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe((scheme) => this.scheme.set(scheme)));
  }
}
