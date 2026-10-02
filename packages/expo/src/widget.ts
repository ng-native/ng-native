/**
 * `widget`, which keeps a home screen widget from `expo-widgets` in step with a signal, and hands the
 * app the taps on its buttons.
 *
 * A widget button runs in the widget extension, not in the app, which iOS keeps suspended, so a
 * tap's own event is lost unless the app is running. The widget's layout records each tap in its
 * own props instead, as `taps`, and `widget` collects them when the app next runs: at once while it
 * is running, and when it comes back to the foreground. It takes the widget `createWidget` makes in
 * the app's layout file, so this package imports `expo-widgets` only for its tap events.
 */
import {
  DestroyRef,
  ErrorHandler,
  InjectionToken,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { optional } from './native.ts';

/** One entry of a widget's timeline, as `expo-widgets` stores it. */
export interface WidgetEntry<T extends object> {
  readonly date: Date;
  /** The entry's props, with the targets of the buttons tapped since the app last collected them. */
  readonly props: T & { readonly taps?: readonly string[] };
}

/** What `createWidget` answers. */
export interface NativeWidget<T extends object> {
  updateSnapshot(props: T): void;
  getTimeline(): Promise<readonly WidgetEntry<T>[]>;
  reload(): void;
}

/** When to collect taps, and when to ask iOS to redraw the widget. */
export interface WidgetEvents {
  /** A widget button was tapped while the app was running. */
  onTap(listener: () => void): () => void;
  onForeground(listener: () => void): () => void;
  onBackground(listener: () => void): () => void;
}

export interface WidgetOptions {
  /**
   * Called with the targets of the buttons tapped since the last call, oldest first. A tap is
   * handed over once. A handler that throws goes to the `ErrorHandler`, and its taps are still
   * cleared.
   */
  readonly onTaps?: (taps: readonly string[]) => void;
}

/** A home screen widget kept in step with a signal. */
export interface WidgetRef {
  /** Collects the taps now, then shows the signal's value. */
  sync(): Promise<void>;
  /** Asks iOS to redraw the widget. */
  reload(): void;
}

type ReactNative = typeof import('react-native');
type ExpoWidgets = {
  addUserInteractionListener(listener: () => void): { remove(): void };
};

/** Overridden in a test to tap a widget that is not there. */
export const WIDGET_EVENTS = new InjectionToken<WidgetEvents>('angular-native.widgetEvents', {
  factory: () => {
    const widgets = optional(() => require('expo-widgets') as ExpoWidgets);
    const native = optional(() => require('react-native') as ReactNative);
    const onState = (wanted: string) => (listener: () => void) => {
      const subscription = native?.AppState.addEventListener('change', (state) => {
        if (state === wanted) listener();
      });
      return () => subscription?.remove();
    };
    return {
      onTap: (listener) => {
        const subscription = widgets?.addUserInteractionListener(listener);
        return () => subscription?.remove();
      },
      onForeground: onState('active'),
      onBackground: onState('background'),
    };
  },
});

/**
 * Shows `props` on the widget and follows the signal, and hands taps on its buttons to `onTaps`.
 * Taps recorded while the app was not running are collected before anything is written, since a
 * write replaces the props that hold them; while it collects, the signal's changes wait, and are
 * written when it is done. Going to the background asks iOS to redraw the widget,
 * which it otherwise does on its own schedule. Destroying the injector stops both. Call it in an
 * injection context.
 */
export function widget<T extends object>(
  native: NativeWidget<T>,
  props: Signal<T>,
  options: WidgetOptions = {},
): WidgetRef {
  const errors = inject(ErrorHandler);
  const events = inject(WIDGET_EVENTS);
  const ready = signal(false);
  let syncing: Promise<void> | null = null;

  const write = () => native.updateSnapshot(untracked(props));

  const queued = async () => (await native.getTimeline()).at(-1)?.props.taps ?? [];

  const collect = async () => {
    let handed = 0;
    for (let taps = await queued(); taps.length > handed; taps = await queued()) {
      try {
        options.onTaps?.(taps.slice(handed));
      } catch (failure) {
        errors.handleError(failure);
      }
      handed = taps.length;
    }
  };

  const sync = () => {
    syncing ??= collect()
      .then(write)
      .catch((failure: unknown) => errors.handleError(failure))
      .finally(() => {
        syncing = null;
        ready.set(true);
      });
    return syncing;
  };

  effect(() => {
    const next = props();
    if (ready() && !syncing) untracked(() => native.updateSnapshot(next));
  });

  const stops = [
    events.onTap(() => void sync()),
    events.onForeground(() => void sync()),
    events.onBackground(() => native.reload()),
  ];
  inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  void sync();

  return { sync, reload: () => native.reload() };
}
