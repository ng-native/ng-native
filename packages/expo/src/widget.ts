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
import { isolated, optional } from './native.ts';

/** One entry of a widget's timeline, as `expo-widgets` stores it. */
export interface WidgetEntry<T extends object> {
  readonly date: Date;
  /** The entry's props, with the targets of the buttons tapped since the app last collected them. */
  readonly props: T & { readonly taps?: readonly string[] };
}

/** What `createWidget` answers. */
export interface NativeWidget<T extends object> {
  updateSnapshot(props: T): void;
  /** Replaces the timeline: each entry's props are shown from its date. */
  updateTimeline?(entries: readonly WidgetEntry<T>[]): void;
  getTimeline(): Promise<readonly WidgetEntry<T>[]>;
  reload(): void;
}

/** A tap on a button, as `expo-widgets` reports it while the app is running. */
export interface WidgetTap {
  /** The widget's name, or the id of the Live Activity. */
  readonly source: string;
  /** The button's `target`. */
  readonly target: string;
  /** When it was tapped, in milliseconds since the epoch. */
  readonly timestamp: number;
}

/** When to collect taps, and when to ask iOS to redraw the widget. */
export interface WidgetEvents {
  /** A button of a widget or a Live Activity was tapped while the app was running. */
  onTap(listener: (tap: WidgetTap) => void): () => void;
  /**
   * The taps made on Live Activities with these ids before the app was listening, each answered
   * once. A tap can start the app, and is over before its JavaScript has loaded.
   */
  takeHeld?(sources: readonly string[]): readonly WidgetTap[];
  /**
   * The token a server starts a Live Activity with over APNs: null until iOS issues one. One signal
   * for the whole app, since `expo-widgets` hands the token it has only to the first to listen.
   */
  pushToStartToken?(): Signal<string | null>;
  onForeground(listener: () => void): () => void;
  onBackground(listener: () => void): () => void;
}

export interface WidgetOptions<T extends object = object> {
  /**
   * Called with the targets of the buttons tapped since the last call, oldest first, once the write
   * that clears them from the widget has worked, so a tap is handed over once. A handler that throws, or rejects,
   * goes to the `ErrorHandler`, and its taps are still cleared.
   */
  readonly onTaps?: (taps: readonly string[]) => void;
  /**
   * What the widget shows later, with the app not running: the entries after now, each the props
   * to show from its date. Asked at every write with the signal's props, which are shown until the
   * first of them.
   */
  readonly timeline?: (props: T) => readonly WidgetEntry<T>[];
}

/** A home screen widget kept in step with a signal. */
export interface WidgetRef {
  /**
   * Why the last sync did not happen: the taps could not be read, or the widget not written. It also
   * goes to the `ErrorHandler`, and is null again once a sync works. A failing `onTaps` is not kept
   * here.
   */
  readonly error: Signal<unknown>;
  /** Collects the taps now, then shows the signal's value. */
  sync(): Promise<void>;
  /** Asks iOS to redraw the widget. */
  reload(): void;
}

type ReactNative = typeof import('react-native');
type ExpoWidgets = {
  addUserInteractionListener(listener: (tap: WidgetTap) => void): { remove(): void };
  addPushToStartTokenListener?(listener: (event: { activityPushToStartToken: string }) => void): {
    remove(): void;
  };
};

/** This package's own native module, which holds a Live Activity's taps from launch. Absent off iOS. */
type HeldTaps = { takeTaps?(sources: readonly string[]): readonly WidgetTap[] };
const heldTaps = () =>
  (globalThis as { expo?: { modules?: { NgNativeLiveActivityTaps?: HeldTaps } } }).expo?.modules
    ?.NgNativeLiveActivityTaps;

/** Overridden in a test to tap a widget that is not there. */
export const WIDGET_EVENTS = new InjectionToken<WidgetEvents>('angular-native.widgetEvents', {
  factory: () => {
    const widgets = optional(() => require('expo-widgets') as ExpoWidgets);
    const native = optional(() => require('react-native') as ReactNative);
    const destroyRef = inject(DestroyRef);
    let startToken: Signal<string | null> | undefined;
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
      takeHeld: (sources) => heldTaps()?.takeTaps?.(sources) ?? [],
      pushToStartToken: () => {
        if (startToken) return startToken;
        const token = signal<string | null>(null);
        const subscription = widgets?.addPushToStartTokenListener?.((event) =>
          token.set(event.activityPushToStartToken),
        );
        destroyRef.onDestroy(() => subscription?.remove());
        return (startToken = token.asReadonly());
      },
      onForeground: onState('active'),
      onBackground: onState('background'),
    };
  },
});

/**
 * Shows `props` on the widget and follows the signal, and hands taps on its buttons to `onTaps`.
 * A write replaces the props that hold the taps, so every write comes after the taps are read, and
 * nothing is written while they cannot be; a tap is handed over once the write that clears it has
 * worked. Going to the background asks iOS to redraw the widget, which it otherwise does on its own
 * schedule. Destroying the injector stops both. Call it in an injection context.
 */
export function widget<T extends object>(
  native: NativeWidget<T>,
  props: Signal<T>,
  options: WidgetOptions<T> = {},
): WidgetRef {
  const errors = inject(ErrorHandler);
  const events = inject(WIDGET_EVENTS);
  const error = signal<unknown>(null);
  let syncing: Promise<void> | null = null;

  /** A tap is recorded in the entry that was showing, which a timeline has several of. */
  const queued = async () =>
    (await native.getTimeline()).flatMap((entry) => entry.props.taps ?? []);

  const write = (now: T) => {
    if (options.timeline && native.updateTimeline) {
      native.updateTimeline([{ date: new Date(), props: now }, ...options.timeline(now)]);
    } else {
      native.updateSnapshot(now);
    }
  };

  /** The taps, read again until no more land, since the write after it clears them. */
  const collect = async () => {
    let taps = await queued();
    while (taps.length) {
      const more = await queued();
      if (more.length <= taps.length) break;
      taps = more;
    }
    return taps;
  };

  const hand = (taps: readonly string[]) =>
    isolated(
      () => options.onTaps?.(taps),
      (failure) => errors.handleError(failure),
    );

  const run = async () => {
    try {
      const taps = await collect();
      untracked(() => write(props()));
      error.set(null);
      if (taps.length) hand(taps);
    } catch (failure) {
      error.set(failure);
      errors.handleError(failure);
    }
  };

  /**
   * One sync at a time. One asked for during it is already covered: its write reads the signal then,
   * and nothing is awaited after it.
   */
  const sync = () => (syncing ??= run().finally(() => (syncing = null)));

  effect(() => {
    props();
    untracked(() => void sync());
  });

  const stops = [
    events.onTap(() => void sync()),
    events.onForeground(() => void sync()),
    events.onBackground(() => native.reload()),
  ];
  inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));

  return { error: error.asReadonly(), sync, reload: () => native.reload() };
}
