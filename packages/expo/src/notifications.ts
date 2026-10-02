/**
 * `Notifications`, bound to `expo-notifications`: everything the module does, as one injectable
 * service.
 *
 * ```ts
 * import { Notifications, TriggerType } from '@ng-native/expo/notifications';
 *
 * private readonly notifications = inject(Notifications);
 *
 * async remind(): Promise<void> {
 *   if (!(await this.notifications.permission.ensure())) return;
 *   await this.notifications.schedule({
 *     content: { title: 'Time to stretch' },
 *     trigger: { type: TriggerType.DAILY, hour: 9, minute: 0 },
 *   });
 * }
 *
 * constructor() {
 *   const tapped = this.notifications.take();
 *   if (tapped) this.router.navigateByUrl(routeFor(tapped));
 * }
 * ```
 *
 * The listeners are the part a hook used to be the only way to reach, and they are signals here.
 * *Received* is a notification arriving while the app is in front; the app usually decides whether
 * to show anything. *Responded* is the user having tapped one, which is a navigation instruction
 * and must not be missed - including the one that launched the app, which arrived before anything
 * was listening.
 *
 * The rest - permission, scheduling, what is on screen, the badge, Android's channels, the action
 * buttons of categories, the foreground handler, push tokens and topics, background tasks - is the
 * module's own functions under shorter names, with its own types. Without the module installed,
 * or in a test that provides nothing, every query answers empty and every change does nothing.
 * The push token methods ask for the permission first, since a token nobody can be shown anything
 * with fails silently: the push simply never arrives.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import type {
  DevicePushToken,
  Notification,
  NotificationResponse,
  SchedulableTriggerInputTypes,
} from 'expo-notifications';
import { expoModule } from './native.ts';
import { Permission, UNAVAILABLE } from './permissions.ts';

type Expo = typeof import('expo-notifications');

/**
 * The module's functions this service calls. The real module is one; a test provides a fake that
 * delivers notifications nobody sent.
 */
export type NativeNotifications = Pick<
  Expo,
  | 'addNotificationReceivedListener'
  | 'addNotificationResponseReceivedListener'
  | 'addNotificationsDroppedListener'
  | 'addPushTokenListener'
  | 'getLastNotificationResponseAsync'
  | 'clearLastNotificationResponseAsync'
  | 'getPermissionsAsync'
  | 'requestPermissionsAsync'
  | 'scheduleNotificationAsync'
  | 'cancelScheduledNotificationAsync'
  | 'cancelAllScheduledNotificationsAsync'
  | 'getAllScheduledNotificationsAsync'
  | 'getNextTriggerDateAsync'
  | 'getPresentedNotificationsAsync'
  | 'dismissNotificationAsync'
  | 'dismissAllNotificationsAsync'
  | 'getBadgeCountAsync'
  | 'setBadgeCountAsync'
  | 'getNotificationChannelsAsync'
  | 'getNotificationChannelAsync'
  | 'setNotificationChannelAsync'
  | 'deleteNotificationChannelAsync'
  | 'getNotificationChannelGroupsAsync'
  | 'getNotificationChannelGroupAsync'
  | 'setNotificationChannelGroupAsync'
  | 'deleteNotificationChannelGroupAsync'
  | 'getNotificationCategoriesAsync'
  | 'setNotificationCategoryAsync'
  | 'deleteNotificationCategoryAsync'
  | 'setNotificationHandler'
  | 'getExpoPushTokenAsync'
  | 'getDevicePushTokenAsync'
  | 'unregisterForNotificationsAsync'
  | 'setAutoServerRegistrationEnabledAsync'
  | 'subscribeToTopicAsync'
  | 'unsubscribeFromTopicAsync'
  | 'registerTaskAsync'
  | 'unregisterTaskAsync'
>;

type Args<K extends keyof NativeNotifications> = Parameters<NativeNotifications[K]>;

/**
 * The kinds of trigger a schedule takes, as `expo-notifications`' own enum. Importing the enum
 * from the module loads the module, which a test in Node cannot; these are the same strings,
 * typed as the enum, so `{ type: TriggerType.DAILY, hour: 9, minute: 0 }` is accepted either way.
 */
export const TriggerType = {
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
} as unknown as typeof SchedulableTriggerInputTypes;

@Service()
export class Notifications {
  /** Overridden in a test to deliver a notification nobody sent. */
  static readonly SOURCE = new InjectionToken<NativeNotifications | null>(
    'angular-native.notificationsSource',
    {
      factory: () => expoModule('expo-notifications', () => require('expo-notifications') as Expo),
    },
  );

  private readonly native = inject(Notifications.SOURCE);
  private readonly received = signal<Notification | null>(null);
  private readonly responded = signal<NotificationResponse | null>(null);
  private readonly rolled = signal<DevicePushToken | null>(null);
  private readonly drops = signal(0);
  private readonly handled = new Set<string>();

  /**
   * The permission to show notifications. `ensure()` asks only if it has not been answered; for
   * iOS's finer options (provisional, critical alerts), use {@link requestPermission}.
   */
  readonly permission: Permission;

  constructor() {
    const native = this.native;
    this.permission = Permission.of(
      () => native?.getPermissionsAsync() ?? Promise.resolve(UNAVAILABLE),
      () => native?.requestPermissionsAsync() ?? Promise.resolve(UNAVAILABLE),
    );
    if (!native) return;
    const subscriptions = [
      native.addNotificationReceivedListener((notification) => this.received.set(notification)),
      native.addNotificationResponseReceivedListener((response) => this.responded.set(response)),
      // Android drops notifications when too many arrive at once while the app is not running;
      // this is the only word that any went missing.
      native.addNotificationsDroppedListener(() => this.drops.update((count) => count + 1)),
      // A device push token can be rolled by the platform while the app is running; the old one
      // then fails silently rather than delivering anything. This is the only way to find out.
      native.addPushTokenListener((token) => this.rolled.set(token)),
    ];
    inject(DestroyRef).onDestroy(() => subscriptions.forEach((one) => one.remove()));
    // The response that launched the app happened before anything was listening, so it has to be
    // asked for rather than waited for. Without this a cold start from a notification does
    // nothing, which is the single most common way this is got wrong. A platform that cannot say
    // is the same as a launch without a notification.
    void native
      .getLastNotificationResponseAsync()
      .then((response) => {
        if (response && this.responded() === null) this.responded.set(response);
      })
      .catch(() => {});
  }

  /** The most recent notification that arrived while the app was in front. */
  readonly latest: Signal<Notification | null> = this.received.asReadonly();

  /**
   * The most recent notification the user tapped, including the one that launched the app.
   *
   * A router usually wants `take()` instead: this stays set, so a screen that reacts to it will
   * react again every time it is created.
   */
  readonly response: Signal<NotificationResponse | null> = this.responded.asReadonly();

  /**
   * The response, once.
   *
   * Routing on a tap is a one-off, and the signal is not: an effect on it fires again whenever
   * its component is recreated, which sends the user back to a screen they navigated away from.
   */
  take(): NotificationResponse | null {
    const response = this.responded();
    if (!response) return null;

    const id = response.notification.request.identifier + response.actionIdentifier;
    if (this.handled.has(id)) return null;
    this.handled.add(id);
    return response;
  }

  /** Forgets the tap, here and in the module, so the next launch does not see it again. */
  async clearResponse(): Promise<void> {
    this.responded.set(null);
    await this.native?.clearLastNotificationResponseAsync();
  }

  /** How many times Android has reported notifications dropped. Zero on iOS. */
  readonly dropped: Signal<number> = this.drops.asReadonly();

  /** Asks with iOS's finer options. The answer also updates {@link permission}. */
  async requestPermission(...options: Args<'requestPermissionsAsync'>): Promise<boolean> {
    if (!this.native) return false;
    await this.native.requestPermissionsAsync(...options);
    return this.permission.check();
  }

  /** Schedules a local notification, or shows it now with a null trigger. Null without the module. */
  async schedule(...request: Args<'scheduleNotificationAsync'>): Promise<string | null> {
    return (await this.native?.scheduleNotificationAsync(...request)) ?? null;
  }

  async cancel(identifier: string): Promise<void> {
    await this.native?.cancelScheduledNotificationAsync(identifier);
  }

  async cancelAll(): Promise<void> {
    await this.native?.cancelAllScheduledNotificationsAsync();
  }

  /** Every local notification still waiting for its trigger. */
  async scheduled(): Promise<Awaited<ReturnType<Expo['getAllScheduledNotificationsAsync']>>> {
    return (await this.native?.getAllScheduledNotificationsAsync()) ?? [];
  }

  /** When a trigger would next fire, in milliseconds since the epoch; null if it never will. */
  async nextTriggerDate(...trigger: Args<'getNextTriggerDateAsync'>): Promise<number | null> {
    return (await this.native?.getNextTriggerDateAsync(...trigger)) ?? null;
  }

  /** The notifications in the notification centre that are the app's. */
  async presented(): Promise<Notification[]> {
    return (await this.native?.getPresentedNotificationsAsync()) ?? [];
  }

  async dismiss(identifier: string): Promise<void> {
    await this.native?.dismissNotificationAsync(identifier);
  }

  /** Clears every notification the app has on screen. A failure is ignored. */
  dismissAll(): void {
    void this.native?.dismissAllNotificationsAsync().catch(() => {});
  }

  async badge(): Promise<number> {
    return (await this.native?.getBadgeCountAsync()) ?? 0;
  }

  /**
   * iOS shows this on the icon; Android shows it where the launcher supports it. A failure is
   * ignored.
   */
  setBadge(count: number): void {
    void this.native?.setBadgeCountAsync(count).catch(() => {});
  }

  /** Android's notification channels. Empty on iOS, which has none. */
  async channels(): Promise<Awaited<ReturnType<Expo['getNotificationChannelsAsync']>>> {
    return (await this.native?.getNotificationChannelsAsync()) ?? [];
  }

  async channel(
    identifier: string,
  ): Promise<Awaited<ReturnType<Expo['getNotificationChannelAsync']>>> {
    return (await this.native?.getNotificationChannelAsync(identifier)) ?? null;
  }

  /**
   * Creates or updates an Android channel; a notification on Android 8 and later needs one to
   * show at all. Null on iOS.
   */
  async setChannel(
    ...channel: Args<'setNotificationChannelAsync'>
  ): Promise<Awaited<ReturnType<Expo['setNotificationChannelAsync']>>> {
    return (await this.native?.setNotificationChannelAsync(...channel)) ?? null;
  }

  async deleteChannel(identifier: string): Promise<void> {
    await this.native?.deleteNotificationChannelAsync(identifier);
  }

  async channelGroups(): Promise<Awaited<ReturnType<Expo['getNotificationChannelGroupsAsync']>>> {
    return (await this.native?.getNotificationChannelGroupsAsync()) ?? [];
  }

  async channelGroup(
    identifier: string,
  ): Promise<Awaited<ReturnType<Expo['getNotificationChannelGroupAsync']>>> {
    return (await this.native?.getNotificationChannelGroupAsync(identifier)) ?? null;
  }

  async setChannelGroup(
    ...group: Args<'setNotificationChannelGroupAsync'>
  ): Promise<Awaited<ReturnType<Expo['setNotificationChannelGroupAsync']>>> {
    return (await this.native?.setNotificationChannelGroupAsync(...group)) ?? null;
  }

  async deleteChannelGroup(identifier: string): Promise<void> {
    await this.native?.deleteNotificationChannelGroupAsync(identifier);
  }

  /** The categories set: each a set of action buttons a notification opts into. */
  async categories(): Promise<Awaited<ReturnType<Expo['getNotificationCategoriesAsync']>>> {
    return (await this.native?.getNotificationCategoriesAsync()) ?? [];
  }

  /**
   * Action buttons for notifications whose content names this category. A tap on one arrives as
   * a response with the button's identifier, and the typed text as `userText` for a text input.
   */
  async setCategory(
    ...category: Args<'setNotificationCategoryAsync'>
  ): Promise<Awaited<ReturnType<Expo['setNotificationCategoryAsync']>> | null> {
    return (await this.native?.setNotificationCategoryAsync(...category)) ?? null;
  }

  async deleteCategory(identifier: string): Promise<boolean> {
    return (await this.native?.deleteNotificationCategoryAsync(identifier)) ?? false;
  }

  /**
   * What a notification that arrives while the app is in front does: shown, silent, with a sound
   * or a badge. Without a handler, it is not shown. Null removes the handler.
   */
  setHandler(...handler: Args<'setNotificationHandler'>): void {
    this.native?.setNotificationHandler(...handler);
  }

  /**
   * The token to hand a backend so it can send a push through Expo's service.
   *
   * Asks for the notification permission first - a token nobody can be shown anything with is not
   * worth having. `projectId` defaults to the app's own EAS project; pass it explicitly for a bare
   * workflow app, one still without EAS Build configured, or a token fetched outside
   * `expo-notifications`' default resolution. Null without the permission or without the module.
   */
  async getExpoPushToken(projectId?: string): Promise<string | null> {
    if (!this.native || !(await this.permission.ensure())) return null;
    const token = await this.native.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  }

  /**
   * The raw APNs (iOS) or FCM (Android) token, for a backend that talks to those services
   * directly rather than through Expo's push service. Same permission and module rules as
   * {@link getExpoPushToken}.
   */
  async getDevicePushToken(): Promise<DevicePushToken | null> {
    if (!this.native || !(await this.permission.ensure())) return null;
    return this.native.getDevicePushTokenAsync();
  }

  /**
   * The device push token, each time the platform rolls it while the app is running.
   *
   * A rolled token is not the one a backend has on file, and sending to the old one fails
   * silently - this is what tells an app to register the new one. Unset until a roll happens;
   * most of an app's life this stays null.
   */
  readonly devicePushToken: Signal<DevicePushToken | null> = this.rolled.asReadonly();

  /** Stops the device receiving pushes until a token is asked for again. */
  async unregister(): Promise<void> {
    await this.native?.unregisterForNotificationsAsync();
  }

  /** Whether Expo re-registers the device token with its push service by itself. */
  async setAutoServerRegistration(enabled: boolean): Promise<void> {
    await this.native?.setAutoServerRegistrationEnabledAsync(enabled);
  }

  /** Android: receive pushes sent to an FCM topic. */
  async subscribeToTopic(topic: string): Promise<void> {
    await this.native?.subscribeToTopicAsync(topic);
  }

  async unsubscribeFromTopic(topic: string): Promise<void> {
    await this.native?.unsubscribeFromTopicAsync(topic);
  }

  /**
   * Runs a task defined with `expo-task-manager` when a notification arrives in the background.
   * The task itself is defined at the top level of `main.ts`, since it runs without the app.
   */
  async registerTask(name: string): Promise<void> {
    await this.native?.registerTaskAsync(name);
  }

  async unregisterTask(name: string): Promise<void> {
    await this.native?.unregisterTaskAsync(name);
  }
}
