/**
 * Which windows open again after a reload or a relaunch, and what they rendered.
 *
 * The desktop host keeps a window that has a key across a reload, and closes it unless the
 * reloaded app opens that key again within a few seconds. So `AppWindows` writes down each window
 * with a key as it opens and forgets it as it closes, and a starting app opens every one it finds:
 * the main window, a route window at the path it was last opened at, and a `restoreKey` component
 * window with its inputs. A relaunch takes the same path, with the frames the host autosaved.
 *
 * A component is written down by the name `provideRestorableWindows` gives it, since a class name
 * does not survive minifying.
 */
import {
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import { injectOs } from './os.ts';
import { reactNative } from './react-native.ts';
import type { WindowOptions } from './app-windows.ts';

/** One window to open again. */
export type RestoredWindow =
  | { readonly kind: 'main' }
  | {
      readonly kind: 'route';
      readonly outlet: string;
      readonly path: string;
      readonly options: WindowOptions;
    }
  | {
      readonly kind: 'component';
      readonly key: string;
      /** The name `provideRestorableWindows` gave the component. */
      readonly component: string;
      readonly inputs?: Readonly<Record<string, unknown>>;
      readonly options: WindowOptions;
    };

/** Where the windows to open again are kept between one run of the app and the next. */
export interface WindowRestoreStore {
  read(): readonly RestoredWindow[];
  write(windows: readonly RestoredWindow[]): void;
}

const SETTINGS_KEY = 'ngNative.windows';

/** React Native's `Settings`, the app's user defaults, on macOS; null elsewhere. */
function settingsStore(): WindowRestoreStore | null {
  // iPadOS restores its scenes itself, so only the desktop host is asked to.
  if (injectOs() !== 'macos') return null;
  const settings = reactNative()?.Settings;
  if (!settings) return null;
  return {
    read: () => {
      const saved = settings.get(SETTINGS_KEY);
      return Array.isArray(saved) ? (saved as RestoredWindow[]) : [];
    },
    write: (windows) => settings.set({ [SETTINGS_KEY]: windows }),
  };
}

/** The store `AppWindows` keeps its windows in. Overridden in a test with one in memory. */
export const WINDOW_RESTORE_STORE = new InjectionToken<WindowRestoreStore | null>(
  'angular-native.windowRestoreStore',
  { factory: settingsStore },
);

/** The components a `restoreKey` window may render, named by `provideRestorableWindows`. */
export const RESTORABLE_WINDOWS = new InjectionToken<Readonly<Record<string, Type<unknown>>>[]>(
  'angular-native.restorableWindows',
);

/**
 * Name the components that `AppWindows.open(component, { restoreKey })` may open, so the window
 * opens again after a reload or a relaunch: `provideRestorableWindows({ note: NoteWindow })`. Its
 * inputs are written down too, so they have to survive `JSON.stringify`.
 */
export function provideRestorableWindows(
  components: Readonly<Record<string, Type<unknown>>>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: RESTORABLE_WINDOWS, useValue: components, multi: true },
  ]);
}
