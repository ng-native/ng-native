import {
  DestroyRef,
  ErrorHandler,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';

export type LiveActivityDismissal = 'default' | 'immediate' | { readonly after: Date };

interface Subscription {
  remove(): void;
}

export interface NativeLiveActivity<T extends object> {
  getId(): string;
  update(props: T, staleDate?: Date): Promise<void>;
  end(dismissalPolicy?: LiveActivityDismissal, props?: T, contentDate?: Date): Promise<void>;
  getPushToken(): Promise<string | null>;
  addPushTokenListener(listener: (event: { pushToken: string }) => void): Subscription;
}

export interface LiveActivityFactory<T extends object> {
  start(props: T, url?: string, staleDate?: Date): NativeLiveActivity<T>;
  getInstances(): NativeLiveActivity<T>[];
}

export interface LiveActivityRef {
  readonly active: Signal<boolean>;
  readonly id: Signal<string | null>;
  readonly pushToken: Signal<string | null>;
  readonly error: Signal<unknown>;
  start(options?: { url?: string }): boolean;
  end(dismissal?: LiveActivityDismissal): Promise<void>;
}

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
          error.set(new Error('Live Activities need iOS 16.2 or newer.'));
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
