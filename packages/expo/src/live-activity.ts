/**
 * iOS Live Activities and home-screen widgets, through `expo-widgets`: `createLiveActivity` and
 * `createWidget` draw one from an Angular component's template, and `liveActivity` keeps an
 * activity in step with a signal, on the lock screen and in the Dynamic Island. Off iOS,
 * `expo-widgets` starts a stand-in with no id, and `start()` answers false.
 */
import {
  DestroyRef,
  ErrorHandler,
  effect,
  inject,
  signal,
  untracked,
  type InputSignal,
  type Signal,
  type Type,
} from '@angular/core';
import { expoModule, isolated } from './native.ts';
import { WIDGET_EVENTS, type WidgetTap } from './widget.ts';

/** A widget layout: an Angular component whose `props` input the layout draws from. */
export type WidgetLayout<T extends object> = Type<{ readonly props: InputSignal<T> }>;

/**
 * A Live Activity drawn by `layout`, an Angular component, as `expo-widgets`' `createLiveActivity`
 * makes one. `name` matches the activity's name in the `expo-widgets` plugin's config.
 *
 * ```ts
 * export const scoreActivity = createLiveActivity('Score', ScoreLayout);
 * ```
 *
 * `@ng-native/metro`'s transformer compiles the layout's template, at build time, to the source the
 * widget extension evaluates, and drops the class, so the app never runs it: the extension does,
 * with no Angular. So the class holds only its inputs, members holding a modifier from
 * `@expo/ui/swift-ui/modifiers`, and members holding a literal, and its template is inline.
 */
export function createLiveActivity<T extends object>(
  name: string,
  layout: WidgetLayout<T>,
): import('expo-widgets').LiveActivityFactory<T> {
  const expo = widgets();
  if (!expo) return STAND_IN as never;
  return expo.createLiveActivity<T>(name, compiled('createLiveActivity', name, layout));
}

/**
 * A home-screen widget drawn by `layout`, as `expo-widgets`' `createWidget` makes one. The layout
 * reads what the widget is drawn in, such as its `widgetFamily`, from an `environment` input beside
 * `props`. Compiled as `createLiveActivity`'s layout is.
 */
export function createWidget<T extends object>(
  name: string,
  layout: WidgetLayout<T>,
): import('expo-widgets').Widget<T> {
  const expo = widgets();
  if (!expo) return WIDGET_STAND_IN as never;
  return expo.createWidget<T>(name, compiled('createWidget', name, layout));
}

/** `expo-widgets`, which answers with stand-ins itself where there are no widgets; null in Node. */
function widgets() {
  return expoModule(
    'expo-widgets',
    () => require('expo-widgets') as typeof import('expo-widgets'),
    ['ios', 'android', 'web'],
  );
}

/** The layout's source, which the transformer put in place of the class. */
function compiled(call: string, name: string, layout: unknown): never {
  if (typeof layout === 'string') return layout as never;
  throw new Error(
    `${call}('${name}', ...) takes a layout @ng-native/metro's transformer compiles, and it did not run on this file.`,
  );
}

/** What there is in Node, where no widget can be drawn: an activity that never starts. */
const STAND_IN = {
  start: () => ({ getId: () => '' }),
  getInstances: () => [],
};

/** A widget in Node: it draws nothing and holds no timeline, and `widget()` keeps it in step. */
const WIDGET_STAND_IN = {
  updateSnapshot: () => {},
  getTimeline: async () => [],
  reload: () => {},
};

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

export interface LiveActivityOptions {
  /**
   * Called with the target of a `ui-button` tapped on a running activity of this kind, as `widget`
   * hands over a widget's. iOS runs the tap in the app, starting it in the background if it has
   * to; a tap that starts the app is held until this is listening. A handler that throws, or
   * rejects, goes to the `ErrorHandler`.
   */
  readonly onTaps?: (taps: readonly string[]) => void;
}

const NO_TOKEN = signal<string | null>(null).asReadonly();

/**
 * The token a server starts a Live Activity with over APNs, with the app not running: null until
 * iOS issues one, then the latest. The app has one, for every kind of activity; the push names the
 * kind. It needs iOS 17.2, and `enablePushNotifications` in the `expo-widgets` plugin's config. Call
 * it in an injection context.
 */
export function pushToStartToken(): Signal<string | null> {
  return inject(WIDGET_EVENTS).pushToStartToken?.() ?? NO_TOKEN;
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
 * the activity running, as it outlives the app. Taps on its buttons go to `onTaps`. Call it in an
 * injection context.
 */
export function liveActivity<T extends object>(
  factory: LiveActivityFactory<T>,
  props: Signal<T>,
  options: LiveActivityOptions = {},
): LiveActivityRef {
  const errors = inject(ErrorHandler);
  const { onTaps } = options;
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

  const stopTaps = onTaps && listenForTaps(onTaps);

  /**
   * Every widget's and activity's taps arrive here: an activity's names it by its id. Those made
   * before this was listening are taken once it is, so one that also arrives as it happens is
   * handed over once.
   */
  function listenForTaps(hand: (taps: readonly string[]) => void): () => void {
    const events = inject(WIDGET_EVENTS);
    const key = (tap: WidgetTap) => `${tap.source} ${tap.target} ${tap.timestamp}`;
    const taken = new Set<string>();
    const handOver = (targets: readonly string[]) =>
      isolated(
        () => hand(targets),
        (failure) => errors.handleError(failure),
      );
    const stop = events.onTap((tap) => {
      if (taken.delete(key(tap))) return;
      if (running().some((activity) => activity.getId() === tap.source)) handOver([tap.target]);
    });
    const held = events.takeHeld?.(running().map((activity) => activity.getId())) ?? [];
    for (const tap of held) taken.add(key(tap));
    // Not yet: the caller's own fields may not be set while this one is.
    if (held.length) queueMicrotask(() => handOver(held.map((tap) => tap.target)));
    return stop;
  }

  inject(DestroyRef).onDestroy(() => {
    stopTaps?.();
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
          error.set(new Error('Live Activities are only on iOS.'));
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
