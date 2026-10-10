/**
 * `ongoingNotification`, which keeps an Android ongoing notification in step with a signal: what a
 * Live Activity is on iOS. Android draws it from data, not a layout, and draws the time itself: a
 * `timer` counts with no update from the app. Where the content qualifies, Android 16 promotes it to
 * a Live Update, with a chip in the status bar.
 *
 * A tap on one of its actions is stored by this package's native half, in the app's process or a
 * new one Android starts for it, and handed to `onTaps` once, when the app is running. Off Android
 * there is no such module, and `start()` answers false.
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

/** A moment: a `Date`, or milliseconds since the epoch. */
type Moment = Date | number;

/** A button under the notification: one whose tap `onTaps` is handed, or one that opens a link. */
export type OngoingNotificationAction =
  | {
      readonly title: string;
      /** What a tap hands `onTaps`. */
      readonly target: string;
    }
  | {
      readonly title: string;
      /** Opens the app at this link when tapped. */
      readonly url: string;
    };

/** What the notification shows. */
export interface OngoingNotificationContent {
  readonly title: string;
  readonly text?: string;
  /** Time Android counts by itself: up from `since`, or down to `until`. */
  readonly timer?: { readonly since: Moment } | { readonly until: Moment };
  /** A bar filled to `value` of `max`, 1 unless given as a `ui-progress` is, or a moving one. */
  readonly progress?:
    { readonly value: number; readonly max?: number } | { readonly indeterminate: true };
  /** A few characters for the status bar chip of a Live Update, where Android shows one. */
  readonly chip?: string;
  /** Up to three, which is what Android shows. */
  readonly actions?: readonly OngoingNotificationAction[];
}

export interface OngoingNotificationOptions {
  /**
   * The notification channel, which the user sees by `name` in the app's notification settings.
   * It is created when it does not exist yet.
   */
  readonly channel: { readonly id: string; readonly name: string };
  /** Tells this notification from another on the same channel. The channel's id unless given. */
  readonly id?: string;
  /** Opens the app at this link when the notification itself is tapped. */
  readonly url?: string;
  /**
   * Called with the targets of the actions tapped since the last call, oldest first, including
   * those tapped while the app was not running. A handler that throws goes to the `ErrorHandler`.
   */
  readonly onTaps?: (taps: readonly string[]) => void;
}

/**
 * The content as the native module takes it: each moment in milliseconds, the bar in the whole
 * numbers Android draws, and every action with a target, which is what Android tells it by.
 */
type NativeContent = Omit<OngoingNotificationContent, 'timer' | 'progress' | 'actions'> & {
  readonly timer?: { readonly since: number } | { readonly until: number };
  readonly progress?:
    { readonly value: number; readonly max: number } | { readonly indeterminate: true };
  readonly actions?: readonly { title: string; target: string; url?: string }[];
};

/** This package's native module on Android. A test provides a stand-in. */
export interface NativeOngoingNotifications {
  /** Asks for the notification permission where it is needed, then shows or replaces `id`. */
  show(
    id: string,
    content: NativeContent,
    options: Pick<OngoingNotificationOptions, 'channel' | 'url'>,
  ): Promise<{ readonly promoted: boolean }>;
  cancel(id: string): void;
  isActive(id: string): boolean;
  /** The targets tapped on `id` and not yet taken, which are then taken. */
  takeTaps(id: string): readonly string[];
  openPromotionSettings(): void;
  /** An action was tapped or a notification swiped away, on any id. */
  onChange(listener: () => void): () => void;
}

type ExpoModule = Omit<NativeOngoingNotifications, 'onChange'> & {
  addListener(event: 'onChange', listener: () => void): { remove(): void };
};

/** Null off Android, and in a build made before this package had a native half. */
export const ONGOING_NOTIFICATIONS = new InjectionToken<NativeOngoingNotifications | null>(
  'angular-native.ongoingNotifications',
  {
    factory: () => {
      const module = (
        globalThis as { expo?: { modules?: { NgNativeOngoingNotification?: ExpoModule } } }
      ).expo?.modules?.NgNativeOngoingNotification;
      if (!module) return null;
      return {
        show: (id, content, options) => module.show(id, content, options),
        cancel: (id) => module.cancel(id),
        isActive: (id) => module.isActive(id),
        takeTaps: (id) => module.takeTaps(id),
        openPromotionSettings: () => module.openPromotionSettings(),
        onChange: (listener) => {
          const subscription = module.addListener('onChange', listener);
          return () => subscription.remove();
        },
      };
    },
  },
);

/** An ongoing notification kept in step with a signal. */
export interface OngoingNotificationRef {
  /** Whether the notification is showing and following the signal. */
  readonly active: Signal<boolean>;
  /** Whether Android shows it as a Live Update, which the user can turn off for the app. */
  readonly promoted: Signal<boolean>;
  /**
   * Why the last start or update did not happen. A start the user or the system refuses, as when
   * notifications are turned off, is only kept here; a failed update also goes to the
   * `ErrorHandler`.
   */
  readonly error: Signal<unknown>;
  /**
   * Shows the notification with the signal's value, asking for the notification permission first
   * where Android needs it. Answers whether it is showing.
   */
  start(): Promise<boolean>;
  /** Removes the notification. */
  end(): void;
  /** Opens the settings screen where the user turns Live Updates on for the app. */
  openPromotionSettings(): void;
}

const milliseconds = (moment: Moment) => new Date(moment).getTime();

/** The steps of a bar, which Android takes as whole numbers. */
const STEPS = 1000;

function forNative({
  timer,
  progress,
  actions,
  ...content
}: OngoingNotificationContent): NativeContent {
  return {
    ...content,
    ...(timer && {
      timer:
        'since' in timer
          ? { since: milliseconds(timer.since) }
          : { until: milliseconds(timer.until) },
    }),
    ...(progress && {
      progress:
        'value' in progress
          ? { value: Math.round((progress.value / (progress.max ?? 1)) * STEPS), max: STEPS }
          : progress,
    }),
    ...(actions && {
      actions: actions.map((action) =>
        'url' in action ? { ...action, target: action.url } : action,
      ),
    }),
  };
}

/**
 * Keeps an ongoing notification in step with `content`: once started, every change to the signal
 * replaces what it shows, silently. One left showing from before the app started is picked up.
 * Destroying the injector stops the updates and leaves the notification, as it outlives the app.
 * Call it in an injection context.
 */
export function ongoingNotification(
  content: Signal<OngoingNotificationContent>,
  options: OngoingNotificationOptions,
): OngoingNotificationRef {
  const errors = inject(ErrorHandler);
  const native = inject(ONGOING_NOTIFICATIONS);
  const id = options.id ?? options.channel.id;
  const shown = { channel: options.channel, url: options.url };
  const active = signal(native?.isActive(id) ?? false);
  const promoted = signal(false);
  const error = signal<unknown>(null);

  let sent: OngoingNotificationContent | null = null;

  const show = async (next: OngoingNotificationContent) => {
    sent = next;
    const result = await native!.show(id, forNative(next), shown);
    promoted.set(result.promoted);
    error.set(null);
  };

  const forget = () => {
    sent = null;
    active.set(false);
    promoted.set(false);
  };

  /** Shows what the signal holds while the notification is showing, unless Android has it. */
  const follow = (next: OngoingNotificationContent) => {
    if (!untracked(active) || next === sent) return;
    show(next).catch((failure: unknown) => {
      error.set(failure);
      errors.handleError(failure);
    });
  };

  effect(() => follow(content()));

  /** The taps Android stored, and whether the user has swiped the notification away. */
  const collect = () => {
    const taps = native!.takeTaps(id);
    if (untracked(active) && !native!.isActive(id)) forget();
    if (!taps.length) return;
    try {
      options.onTaps?.(taps);
    } catch (failure) {
      errors.handleError(failure);
    }
    // Not left to the effect: React Native runs no timers while the app is in the background, so
    // the pass that would run it waits until the app is back in front.
    follow(untracked(content));
  };

  if (native) {
    inject(DestroyRef).onDestroy(native.onChange(collect));
    // Not yet: the caller's own fields may not be set while this one is.
    queueMicrotask(collect);
  }

  return {
    active: active.asReadonly(),
    promoted: promoted.asReadonly(),
    error: error.asReadonly(),
    async start() {
      if (!native) {
        error.set(
          new Error(
            'An ongoing notification needs Android, and an app built since @ng-native/expo was ' +
              'installed ("npx expo run:android", or a new EAS build).',
          ),
        );
        return false;
      }
      const first = untracked(content);
      try {
        await show(first);
        active.set(true);
        // The signal may have moved on while Android asked for the permission.
        const latest = untracked(content);
        if (latest !== first) await show(latest);
        return true;
      } catch (failure) {
        error.set(failure);
        return false;
      }
    },
    end() {
      native?.cancel(id);
      forget();
    },
    openPromotionSettings: () => native?.openPromotionSettings(),
  };
}
