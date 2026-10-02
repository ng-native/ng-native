/**
 * `liveActivity`, which keeps an iOS Live Activity in step with a signal: on the lock screen and in
 * the Dynamic Island, through `expo-widgets`.
 *
 * It takes the factory `createLiveActivity` makes in the app's layout file, so this package
 * imports nothing of `expo-widgets` itself and adds no peer. Off iOS, `expo-widgets` starts a
 * stand-in with no id, and `start()` answers false.
 */
import {
  DestroyRef,
  ErrorHandler,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';

/**
 * How an ended activity leaves the lock screen: `'default'` keeps it, with its final props, for up
 * to four hours; `'immediate'` removes it; `{ after }` keeps it until then.
 */
export type LiveActivityDismissal = 'default' | 'immediate' | { readonly after: Date };

interface Subscription {
  remove(): void;
}

/** One running activity, as `expo-widgets`' `LiveActivity` is. */
export interface NativeLiveActivity<T extends object> {
  getId(): string;
  update(props: T, staleDate?: Date): Promise<void>;
  end(dismissalPolicy?: LiveActivityDismissal, props?: T, contentDate?: Date): Promise<void>;
  getPushToken(): Promise<string | null>;
  addPushTokenListener(listener: (event: { pushToken: string }) => void): Subscription;
}

/** What `createLiveActivity` answers: starts activities of one kind, and lists the running ones. */
export interface LiveActivityFactory<T extends object> {
  start(props: T, url?: string, staleDate?: Date): NativeLiveActivity<T>;
  getInstances(): NativeLiveActivity<T>[];
}

/** A Live Activity kept in step with a signal. */
export interface LiveActivityRef {
  /** Whether an activity of this kind is running and following the signal. */
  readonly active: Signal<boolean>;
  /** The running activity's id, or null. */
  readonly id: Signal<string | null>;
  /** The token a server sends the activity's updates to over APNs, once iOS issues one. */
  readonly pushToken: Signal<string | null>;
  /**
   * Why the last start or update did not happen. A start the system refuses, as when Live
   * Activities are turned off in Settings, is only kept here; a failed update also goes to the
   * `ErrorHandler`.
   */
  readonly error: Signal<unknown>;
  /**
   * Shows the activity with the signal's value, or picks up one already running. Answers whether it
   * is running now; `url` opens the app at that link when the activity is tapped.
   */
  start(options?: { url?: string }): boolean;
  /** Ends every activity of this kind with the signal's value. */
  end(dismissal?: LiveActivityDismissal): Promise<void>;
}

/**
 * Keeps a Live Activity of the factory's kind in step with `props`: once started, every change to the
 * signal updates it. One left running from before the app started is picked up rather than started
 * again, since iOS caps how many an app runs. Destroying the injector stops the updates and leaves
 * the activity running, as it outlives the app. Call it in an injection context.
 */
export function liveActivity<T extends object>(
  factory: LiveActivityFactory<T>,
  props: Signal<T>,
): LiveActivityRef {
  const errors = inject(ErrorHandler);
  const active = signal(false);
  const id = signal<string | null>(null);
  const pushToken = signal<string | null>(null);
  const error = signal<unknown>(null);
  let current: NativeLiveActivity<T> | null = null;
  let tokenSubscription: Subscription | null = null;

  const report = (failure: unknown) => {
    error.set(failure);
    errors.handleError(failure);
  };

  const running = (): NativeLiveActivity<T>[] => {
    try {
      return factory.getInstances();
    } catch (failure) {
      error.set(failure);
      return [];
    }
  };

  const forget = () => {
    tokenSubscription?.remove();
    tokenSubscription = null;
    current = null;
    active.set(false);
    id.set(null);
    pushToken.set(null);
  };

  const adopt = (activity: NativeLiveActivity<T>) => {
    current = activity;
    active.set(true);
    id.set(activity.getId());
    error.set(null);
    tokenSubscription = activity.addPushTokenListener((event) => pushToken.set(event.pushToken));
    activity.getPushToken().then(
      (token) => current === activity && token !== null && pushToken.set(token),
      () => {},
    );
  };

  const existing = running()[0];
  if (existing) adopt(existing);

  effect(() => {
    const next = props();
    const activity = current;
    if (activity) untracked(() => activity.update(next).catch(report));
  });

  inject(DestroyRef).onDestroy(() => {
    tokenSubscription?.remove();
    tokenSubscription = null;
  });

  return {
    active: active.asReadonly(),
    id: id.asReadonly(),
    pushToken: pushToken.asReadonly(),
    error: error.asReadonly(),
    start(options = {}) {
      if (current) return true;
      const value = untracked(props);
      try {
        const already = running()[0];
        const activity = already ?? factory.start(value, options.url);
        if (!activity.getId()) {
          error.set(new Error('Live Activities are only on iOS 16.2 and later.'));
          return false;
        }
        adopt(activity);
        if (already) already.update(value).catch(report);
        return true;
      } catch (failure) {
        error.set(failure);
        return false;
      }
    },
    async end(dismissal = 'default') {
      const value = untracked(props);
      const activities = new Set(running());
      if (current) activities.add(current);
      forget();
      await Promise.all([...activities].map((activity) => activity.end(dismissal, value))).catch(
        report,
      );
    },
  };
}
