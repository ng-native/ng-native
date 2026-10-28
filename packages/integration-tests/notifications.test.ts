/**
 * `Notifications`, over a fake of `expo-notifications` that records every call.
 *
 * The listeners are the part React was holding - and in particular the difference between a
 * notification *arriving* and a user *tapping* one, which is a navigation instruction. The rest is
 * the module's own functions, each checked to reach the module under its own name, and to answer
 * empty rather than throw when the module is not there.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import type { DevicePushToken, Notification, NotificationResponse } from 'expo-notifications';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  Notifications,
  TriggerType,
  type NativeNotifications,
} from '@ng-native/expo/notifications';
import { serviceWith } from './injected.ts';

const presentedOne = { request: { identifier: 'p', content: {} } };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const responseTo = (id: string, action = 'default'): NotificationResponse =>
  ({
    notification: { request: { identifier: id, content: {} } },
    actionIdentifier: action,
  }) as never;

type Kind = 'received' | 'response' | 'dropped' | 'pushToken';

function platform(
  launched: NotificationResponse | null = null,
  options: { permission?: boolean; expoToken?: string; deviceToken?: DevicePushToken } = {},
) {
  const { permission = true, expoToken = 'ExponentPushToken[abc]', deviceToken } = options;
  const calls: unknown[][] = [];
  const listeners: Partial<Record<Kind, (value: never) => void>> = {};
  const subscribe = (kind: Kind) => (listener: (value: never) => void) => {
    listeners[kind] = listener;
    return { remove: () => void calls.push(['remove', kind]) };
  };
  const record =
    (name: string, answer?: unknown) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer;
    };
  const status = {
    status: permission ? 'granted' : 'denied',
    granted: permission,
    canAskAgain: true,
    expires: 'never',
  };
  const native = {
    addNotificationReceivedListener: subscribe('received'),
    addNotificationResponseReceivedListener: subscribe('response'),
    addNotificationsDroppedListener: subscribe('dropped'),
    addPushTokenListener: subscribe('pushToken'),
    getLastNotificationResponseAsync: record('getLastNotificationResponseAsync', launched),
    clearLastNotificationResponseAsync: record('clearLastNotificationResponseAsync'),
    getPermissionsAsync: record('getPermissionsAsync', status),
    requestPermissionsAsync: record('requestPermissionsAsync', status),
    scheduleNotificationAsync: record('scheduleNotificationAsync', 'scheduled-1'),
    cancelScheduledNotificationAsync: record('cancelScheduledNotificationAsync'),
    cancelAllScheduledNotificationsAsync: record('cancelAllScheduledNotificationsAsync'),
    getAllScheduledNotificationsAsync: record('getAllScheduledNotificationsAsync', ['s']),
    getNextTriggerDateAsync: record('getNextTriggerDateAsync', 1_000),
    getPresentedNotificationsAsync: record('getPresentedNotificationsAsync', [presentedOne]),
    dismissNotificationAsync: record('dismissNotificationAsync'),
    dismissAllNotificationsAsync: record('dismissAllNotificationsAsync'),
    getBadgeCountAsync: record('getBadgeCountAsync', 4),
    setBadgeCountAsync: record('setBadgeCountAsync', true),
    getNotificationChannelsAsync: record('getNotificationChannelsAsync', ['c']),
    getNotificationChannelAsync: record('getNotificationChannelAsync', 'channel'),
    setNotificationChannelAsync: record('setNotificationChannelAsync', 'channel'),
    deleteNotificationChannelAsync: record('deleteNotificationChannelAsync'),
    getNotificationChannelGroupsAsync: record('getNotificationChannelGroupsAsync', ['g']),
    getNotificationChannelGroupAsync: record('getNotificationChannelGroupAsync', 'group'),
    setNotificationChannelGroupAsync: record('setNotificationChannelGroupAsync', 'group'),
    deleteNotificationChannelGroupAsync: record('deleteNotificationChannelGroupAsync'),
    getNotificationCategoriesAsync: record('getNotificationCategoriesAsync', ['k']),
    setNotificationCategoryAsync: record('setNotificationCategoryAsync', 'category'),
    deleteNotificationCategoryAsync: record('deleteNotificationCategoryAsync', true),
    setNotificationHandler: (handler: unknown) =>
      void calls.push(['setNotificationHandler', handler]),
    getExpoPushTokenAsync: record('getExpoPushTokenAsync', { type: 'expo', data: expoToken }),
    getDevicePushTokenAsync: record(
      'getDevicePushTokenAsync',
      deviceToken ?? { type: 'ios', data: 'x' },
    ),
    unregisterForNotificationsAsync: record('unregisterForNotificationsAsync'),
    setAutoServerRegistrationEnabledAsync: record('setAutoServerRegistrationEnabledAsync'),
    subscribeToTopicAsync: record('subscribeToTopicAsync'),
    unsubscribeFromTopicAsync: record('unsubscribeFromTopicAsync'),
    registerTaskAsync: record('registerTaskAsync', null),
    unregisterTaskAsync: record('unregisterTaskAsync', null),
  } as unknown as NativeNotifications;
  return Object.assign(native, {
    calls,
    emit: (kind: Kind, value?: unknown) => listeners[kind]?.(value as never),
  });
}

const serviceOn = (native: NativeNotifications | null) =>
  serviceWith(Notifications.SOURCE, native, () => new Notifications());

describe('notifications', () => {
  it('separates one arriving from one being tapped', () => {
    const native = platform();
    const notifications = serviceOn(native);

    native.emit('received', { request: { identifier: 'a', content: {} } });
    assert.equal(notifications.latest()?.request.identifier, 'a');
    assert.equal(notifications.response(), null, 'arriving is not the user asking for anything');
  });

  it('swallows a native call that fails, rather than leaving an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const failing = Object.assign(platform(), {
        getLastNotificationResponseAsync: () => Promise.reject(new Error('no launch response')),
        dismissAllNotificationsAsync: () => Promise.reject(new Error('dismiss failed')),
        setBadgeCountAsync: () => Promise.reject(new Error('badge failed')),
      });
      const notifications = serviceOn(failing);
      notifications.dismissAll();
      notifications.setBadge(3);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(unhandled, []);
      assert.equal(notifications.response(), null);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('picks up the one that launched the app, which nothing was listening for', async () => {
    // A cold start from a notification: the tap happened before any listener existed. Missing
    // this is the single most common way notification routing is got wrong.
    const notifications = serviceOn(platform(responseTo('launch')));
    await settle();
    assert.equal(notifications.response()?.notification.request.identifier, 'launch');
  });

  it('does not let the launch response overwrite one the user just made', async () => {
    const native = platform(responseTo('launch'));
    const notifications = serviceOn(native);
    native.emit('response', responseTo('newer'));

    await settle();
    assert.equal(notifications.response()?.notification.request.identifier, 'newer');
  });

  it('hands a response over exactly once', async () => {
    // Routing on a tap is a one-off and the signal is not: an effect on it fires again whenever
    // its component is recreated, sending the user back to a screen they navigated away from.
    const notifications = serviceOn(platform(responseTo('launch')));
    await settle();

    assert.equal(notifications.take()?.notification.request.identifier, 'launch');
    assert.equal(notifications.take(), null);
  });

  it('hands over the text typed into a reply action', () => {
    const native = platform();
    const notifications = serviceOn(native);
    native.emit('response', { ...responseTo('chat', 'reply'), userText: 'On my way' });
    const reply: string | undefined = notifications.take()?.userText;
    assert.equal(reply, 'On my way');
  });

  it('hands over a second tap on the same notification', () => {
    // Same notification, tapped again after the app was backgrounded. It is a new instruction.
    const native = platform();
    const notifications = serviceOn(native);

    native.emit('response', responseTo('a'));
    assert.ok(notifications.take());

    native.emit('response', responseTo('a', 'reply'));
    assert.ok(notifications.take(), 'a different action on the same notification');
  });

  it('clears the response here and in the module', async () => {
    const native = platform(responseTo('launch'));
    const notifications = serviceOn(native);
    await settle();
    await notifications.clearResponse();
    assert.equal(notifications.response(), null);
    assert.ok(native.calls.some(([name]) => name === 'clearLastNotificationResponseAsync'));
  });

  it('counts the drops Android reports', () => {
    const native = platform();
    const notifications = serviceOn(native);
    assert.equal(notifications.dropped(), 0);
    native.emit('dropped');
    native.emit('dropped');
    assert.equal(notifications.dropped(), 2);
  });

  it('stops listening when the app is destroyed', () => {
    const native = platform();
    const injector = Injector.create({
      providers: [{ provide: Notifications.SOURCE, useValue: native }],
    });
    runInInjectionContext(injector, () => new Notifications());
    injector.destroy();
    const removed = native.calls.filter(([name]) => name === 'remove').map(([, kind]) => kind);
    assert.deepEqual(removed.sort(), ['dropped', 'pushToken', 'received', 'response']);
  });

  it('takes nothing before anything has ever arrived', () => {
    // The ordinary case for most of an app's life: no tap has happened yet, launch or otherwise.
    assert.equal(serviceOn(platform()).take(), null);
  });
});

describe('the rest of the module', () => {
  it('reaches every function of the module under its own name, with its arguments', async () => {
    const native = platform();
    const n = serviceOn(native);
    const handler = { handleNotification: async () => ({}) as never };
    const results = {
      schedule: await n.schedule({ content: { title: 'Hi' }, trigger: null }),
      scheduled: await n.scheduled(),
      next: await n.nextTriggerDate({ seconds: 5 } as never),
      presented: await n.presented(),
      badge: await n.badge(),
      channels: await n.channels(),
      channel: await n.channel('alerts'),
      setChannel: await n.setChannel('alerts', { name: 'Alerts', importance: 4 }),
      channelGroups: await n.channelGroups(),
      channelGroup: await n.channelGroup('g1'),
      setChannelGroup: await n.setChannelGroup('g1', { name: 'Group' }),
      categories: await n.categories(),
      setCategory: await n.setCategory('message', [{ identifier: 'reply', buttonTitle: 'Reply' }]),
      deleteCategory: await n.deleteCategory('message'),
    };
    await n.cancel('s1');
    await n.cancelAll();
    await n.dismiss('p1');
    n.dismissAll();
    n.setBadge(2);
    await n.deleteChannel('alerts');
    await n.deleteChannelGroup('g1');
    n.setHandler(handler);
    await n.unregister();
    await n.setAutoServerRegistration(false);
    await n.subscribeToTopic('news');
    await n.unsubscribeFromTopic('news');
    await n.registerTask('notification-task');
    await n.unregisterTask('notification-task');
    await settle();

    assert.deepEqual(results, {
      schedule: 'scheduled-1',
      scheduled: ['s'],
      next: 1_000,
      presented: [presentedOne],
      badge: 4,
      channels: ['c'],
      channel: 'channel',
      setChannel: 'channel',
      channelGroups: ['g'],
      channelGroup: 'group',
      setChannelGroup: 'group',
      categories: ['k'],
      setCategory: 'category',
      deleteCategory: true,
    });
    const called = (name: string) => native.calls.filter(([one]) => one === name);
    assert.deepEqual(called('scheduleNotificationAsync'), [
      ['scheduleNotificationAsync', { content: { title: 'Hi' }, trigger: null }],
    ]);
    assert.deepEqual(called('cancelScheduledNotificationAsync'), [
      ['cancelScheduledNotificationAsync', 's1'],
    ]);
    assert.deepEqual(called('setNotificationChannelAsync'), [
      ['setNotificationChannelAsync', 'alerts', { name: 'Alerts', importance: 4 }],
    ]);
    assert.deepEqual(called('setNotificationCategoryAsync'), [
      ['setNotificationCategoryAsync', 'message', [{ identifier: 'reply', buttonTitle: 'Reply' }]],
    ]);
    assert.deepEqual(called('setBadgeCountAsync'), [['setBadgeCountAsync', 2]]);
    const [[, installed]] = called('setNotificationHandler') as [[string, typeof handler]];
    assert.equal(installed.handleNotification.length, 1, 'wrapped to fill in a push s data');
    assert.deepEqual(Object.keys(installed), Object.keys(handler));
    for (const [name, arg] of [
      ['cancelAllScheduledNotificationsAsync'],
      ['dismissNotificationAsync', 'p1'],
      ['dismissAllNotificationsAsync'],
      ['deleteNotificationChannelAsync', 'alerts'],
      ['deleteNotificationChannelGroupAsync', 'g1'],
      ['deleteNotificationCategoryAsync', 'message'],
      ['unregisterForNotificationsAsync'],
      ['setAutoServerRegistrationEnabledAsync', false],
      ['subscribeToTopicAsync', 'news'],
      ['unsubscribeFromTopicAsync', 'news'],
      ['registerTaskAsync', 'notification-task'],
      ['unregisterTaskAsync', 'notification-task'],
    ] as const) {
      assert.deepEqual(called(name), [arg === undefined ? [name] : [name, arg]], name);
    }
  });

  it('asks with iOS s finer options, and the permission follows the answer', async () => {
    const native = platform();
    const n = serviceOn(native);
    assert.equal(await n.requestPermission({ ios: { allowProvisional: true } }), true);
    assert.deepEqual(
      native.calls.find(([name]) => name === 'requestPermissionsAsync'),
      ['requestPermissionsAsync', { ios: { allowProvisional: true } }],
    );
    assert.equal(n.permission.granted(), true);
  });

  it('is inert rather than broken with no module installed', async () => {
    const n = serviceOn(null);
    assert.equal(n.response(), null);
    assert.equal(n.take(), null);
    assert.equal(await n.permission.ensure(), false);
    assert.equal(await n.requestPermission(), false);
    assert.equal(await n.schedule({ content: {}, trigger: null }), null);
    assert.deepEqual(await n.scheduled(), []);
    assert.equal(await n.nextTriggerDate({ seconds: 5 } as never), null);
    assert.deepEqual(await n.presented(), []);
    assert.equal(await n.badge(), 0);
    assert.deepEqual(await n.channels(), []);
    assert.equal(await n.channel('alerts'), null);
    assert.equal(await n.setChannel('alerts', { name: 'Alerts', importance: 4 }), null);
    assert.deepEqual(await n.channelGroups(), []);
    assert.equal(await n.channelGroup('g'), null);
    assert.deepEqual(await n.categories(), []);
    assert.equal(await n.setCategory('message', []), null);
    assert.equal(await n.deleteCategory('message'), false);
    n.dismissAll();
    n.setBadge(0);
    n.setHandler(null);
    await n.cancel('s');
    await n.cancelAll();
    await n.clearResponse();
    await n.registerTask('task');
    assert.equal(n.dropped(), 0);
    assert.equal(n.devicePushToken(), null);
  });
});

describe('trigger types', () => {
  it('are the module s own enum, so a schedule can be written without loading the module', () => {
    // The enum lives in a file Node cannot load, so its compiled lines are read as text.
    const require = createRequire(import.meta.url);
    const types = readFileSync(
      require.resolve('expo-notifications/build/Notifications.types.js'),
      'utf8',
    );
    const expo = Object.fromEntries(
      [...types.matchAll(/SchedulableTriggerInputTypes\["(\w+)"\] = "(\w+)"/g)].map(
        ([, key, value]) => [key, value],
      ),
    );
    assert.ok(Object.keys(expo).length > 0, 'found the enum');
    assert.deepEqual({ ...TriggerType }, expo);
  });
});

describe('push tokens', () => {
  it('hands back the Expo push token', async () => {
    const n = serviceOn(platform(null, { expoToken: 'ExponentPushToken[xyz]' }));
    assert.equal(await n.getExpoPushToken(), 'ExponentPushToken[xyz]');
  });

  it('passes a projectId through to the module', async () => {
    const native = platform();
    await serviceOn(native).getExpoPushToken('my-project');
    assert.deepEqual(
      native.calls.find(([name]) => name === 'getExpoPushTokenAsync'),
      ['getExpoPushTokenAsync', { projectId: 'my-project' }],
    );
  });

  it('hands back the native device token, for a backend that talks to APNs/FCM directly', async () => {
    const n = serviceOn(platform(null, { deviceToken: { type: 'android', data: 'fcm-token' } }));
    assert.deepEqual(await n.getDevicePushToken(), { type: 'android', data: 'fcm-token' });
  });

  it('is null when the permission was refused, without asking for a token', async () => {
    const native = platform(null, { permission: false });
    const n = serviceOn(native);
    assert.equal(await n.getExpoPushToken(), null);
    assert.equal(await n.getDevicePushToken(), null);
    assert.ok(!native.calls.some(([name]) => String(name).endsWith('PushTokenAsync')));
  });

  it('is null with no module installed, for both kinds of token', async () => {
    const n = serviceOn(null);
    assert.equal(await n.getExpoPushToken(), null);
    assert.equal(await n.getDevicePushToken(), null);
  });

  it('observes the device token changing while the app runs', () => {
    const native = platform();
    const n = serviceOn(native);
    assert.equal(n.devicePushToken(), null, 'nothing has rolled yet');

    native.emit('pushToken', { type: 'ios', data: 'rolled-token' });
    assert.deepEqual(n.devicePushToken(), { type: 'ios', data: 'rolled-token' });
  });
});

describe("a push's data on iOS", () => {
  // expo-notifications on iOS fills content.data for a push only from userInfo.body, which is
  // where Expo's push service puts it. FCM and plain APNs put the sender's keys at the top of
  // userInfo, so they reach JS only as trigger.payload.
  const fcm = (id: string, content: object = { title: 'Hi', data: null }) => ({
    request: {
      identifier: id,
      content,
      trigger: {
        type: 'push',
        payload: {
          aps: { alert: { body: 'Hi' } },
          url: 'myapp://item?id=1',
          'gcm.message_id': '1',
          'google.c.a.e': '1',
          'google.c.sender.id': '2',
          // FCM's image, from the message's apns.fcm_options.
          fcm_options: { image: 'https://example.com/a.png' },
        },
      },
    },
  });
  const sent = { url: 'myapp://item?id=1' };
  const tapped = (id: string) => ({ notification: fcm(id), actionIdentifier: 'default' });

  it('is content.data for one that arrives, is tapped, or launched the app', async () => {
    const native = platform(tapped('launch') as never);
    const n = serviceOn(native);
    await settle();
    assert.deepEqual(n.response()?.notification.request.content.data, sent);

    native.emit('received', fcm('a'));
    assert.deepEqual(n.latest()?.request.content.data, sent);
    native.emit('response', tapped('b'));
    assert.deepEqual(n.take()?.notification.request.content.data, sent);
  });

  it('is content.data for one on screen, and for the foreground handler', async () => {
    const native = Object.assign(platform(), {
      getPresentedNotificationsAsync: async () => [fcm('a', { title: 'Hi' })],
    });
    const n = serviceOn(native);
    assert.deepEqual((await n.presented())[0]?.request.content.data, sent);

    const seen: unknown[] = [];
    n.setHandler({
      handleNotification: async (notification) => {
        seen.push(notification.request.content.data);
        return {} as never;
      },
      handleError: (id, error) => {
        const info = (error as { info?: { notification: Notification } } | undefined)?.info;
        seen.push(info ? info.notification.request.content.data : id);
      },
    });
    const [, installed] = native.calls.find(([name]) => name === 'setNotificationHandler')!;
    const handler = installed as {
      handleNotification(n: unknown): Promise<unknown>;
      handleError(id: string, error: unknown): void;
    };
    await handler.handleNotification(fcm('b'));
    // What expo-notifications passes when the handler took too long: a NotificationTimeoutError.
    const timedOut = Object.assign(new Error('timed out'), {
      info: { id: 'c', notification: fcm('c') },
    });
    handler.handleError('c', timedOut);
    // Its own errors are CodedErrors, whose info is declared but unset.
    const unavailable = Object.assign(new Error('unavailable'), {
      code: 'ERR_UNAVAILABLE',
      info: undefined,
    });
    handler.handleError('d', unavailable);
    // And whatever the app's handleNotification rejected with is passed on as it is.
    handler.handleError('e', 'not an error');
    handler.handleError('f', undefined);
    assert.deepEqual(seen, [sent, sent, 'd', 'e', 'f']);
  });

  it('keeps the callbacks of a handler that is a class, and their this', async () => {
    const calls: unknown[] = [];
    class Handler {
      readonly name = 'mine';
      async handleNotification(notification: Notification) {
        calls.push([this.name, notification.request.content.data]);
        return {} as never;
      }
      handleSuccess(id: string) {
        calls.push([this.name, 'success', id]);
      }
      handleError(id: string) {
        calls.push([this.name, 'error', id]);
      }
    }
    const native = platform();
    serviceOn(native).setHandler(new Handler());
    const [, installed] = native.calls.find(([name]) => name === 'setNotificationHandler')!;
    const handler = installed as {
      handleNotification(n: unknown): Promise<unknown>;
      handleSuccess?(id: string): void;
      handleError?(id: string, error: unknown): void;
    };
    await handler.handleNotification(fcm('a'));
    handler.handleSuccess?.('a');
    handler.handleError?.('b', new Error('failed'));
    assert.deepEqual(calls, [
      ['mine', sent],
      ['mine', 'success', 'a'],
      ['mine', 'error', 'b'],
    ]);
  });

  it('leaves a handler without an error callback without one', () => {
    const native = platform();
    serviceOn(native).setHandler({ handleNotification: async () => ({}) as never });
    const [, installed] = native.calls.find(([name]) => name === 'setNotificationHandler')!;
    assert.equal((installed as { handleError?: unknown }).handleError, undefined);
  });

  it("leaves out the keys Expo's push service adds, when the module found no data", () => {
    // What Expo's service sends besides aps, as in expo-notifications' own iOS tests. The module
    // takes only an object body as content.data.
    const expo = { experienceId: '@me/app', projectId: 'f192', scopeKey: '@me/app' };
    const native = platform();
    const n = serviceOn(native);
    for (const [payload, data] of [
      [{ aps: {}, body: 'plain string body', ...expo }, { body: 'plain string body' }],
      [{ aps: {}, ...expo }, {}],
      [{ aps: {}, experienceId: '@me/app', projectId: 'f192' }, {}],
      [{ aps: {}, scopeKey: '@me/app', projectId: 'f192' }, {}],
      // From any other sender, a projectId is the sender's own, and so is a key FCM's only contain.
      [
        { aps: {}, projectId: 'p1', 'app.google.id': 'g' },
        { projectId: 'p1', 'app.google.id': 'g' },
      ],
    ] as const) {
      native.emit('received', {
        request: { identifier: 'e', content: { data: null }, trigger: { type: 'push', payload } },
      });
      assert.deepEqual(n.latest()?.request.content.data, data);
    }
  });

  it("leaves Expo's own push, Android's and a local one as the module made them", () => {
    const native = platform();
    const n = serviceOn(native);
    const expo = {
      request: {
        identifier: 'e',
        content: { data: sent },
        trigger: { type: 'push', payload: { aps: {}, body: sent, experienceId: '@me/app' } },
      },
    };
    const android = {
      request: {
        identifier: 'd',
        content: { data: sent },
        trigger: { type: 'push', remoteMessage: { data: sent } },
      },
    };
    const androidWithoutData = {
      request: {
        identifier: 'n',
        content: { data: null },
        trigger: { type: 'push', remoteMessage: { data: {} } },
      },
    };
    const local = {
      request: { identifier: 'l', content: { data: null }, trigger: { type: 'timeInterval' } },
    };
    for (const one of [expo, android, androidWithoutData, local]) {
      native.emit('received', one);
      assert.deepEqual(n.latest(), one, one.request.identifier);
    }
  });
});

describe('where expo-notifications will not load: Expo Go on Android', () => {
  // `expo-notifications` subscribes to push tokens as it is imported, and in Expo Go on Android,
  // which has had no push since SDK 53, that throws. So the import itself fails there, and Metro
  // reports it as a fatal error before a `catch` around the `require` runs.
  const module = { addNotificationReceivedListener() {} };

  /** The token's own default factory on a device, and what it warned and asked `require` for. */
  function source(platform: 'ios' | 'android', expoGo: boolean) {
    const host = globalThis as Record<string, unknown>;
    const warnings: string[] = [];
    const required: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    host['require'] = (id: string) => {
      required.push(id);
      if (id === 'react-native') return { Platform: { OS: platform } };
      if (id === 'expo') return { isRunningInExpoGo: () => expoGo };
      if (id === 'expo-modules-core') return { requireOptionalNativeModule: () => ({}) };
      if (id === 'expo-notifications') return module;
      throw new Error(`Cannot find module '${id}'`);
    };
    try {
      const provider = (Notifications.SOURCE as unknown as { ɵprov: { factory(): unknown } }).ɵprov;
      return { native: provider.factory(), warnings, required };
    } finally {
      delete host['require'];
      console.warn = warn;
    }
  }

  it('starts with no module behind it, never importing the package, and says why', async () => {
    const { native, warnings, required } = source('android', true);
    assert.equal(native, null);
    assert.ok(!required.includes('expo-notifications'), 'the import is what throws');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Expo Go on Android/);
    assert.match(warnings[0]!, /development build/);

    // With none, the service is what it is on the web: it starts, and answers nothing.
    const n = serviceWith(Notifications.SOURCE, null, () => new Notifications());
    assert.equal(n.latest(), null);
    assert.equal(n.devicePushToken(), null);
    assert.equal(await n.cancelAll(), undefined);
  });

  it("loads it in the app's own build on Android, and in Expo Go on iOS", () => {
    for (const [platform, expoGo] of [
      ['android', false],
      ['ios', true],
    ] as const) {
      const { native, warnings } = source(platform, expoGo);
      assert.equal(native, module, `${platform}, Expo Go ${expoGo}`);
      assert.deepEqual(warnings, []);
    }
  });
});
