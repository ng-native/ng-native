/**
 * `FirebaseMessaging`, over a fake of its native module and of `expo-notifications`: registering
 * the Firebase Installation ID with FCM, with the APNs token on iOS, and again when that token
 * rolls. And its config plugin, which turns registration by installation ID on.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';
import {
  ApplicationRef,
  EnvironmentInjector,
  ErrorHandler,
  createEnvironmentInjector,
  runInInjectionContext,
  type Type,
} from '@angular/core';
import type { DevicePushToken } from 'expo-notifications';
import { OS } from '@ng-native/device';
import { Permission } from '@ng-native/expo';
import { Notifications, type NativeNotifications } from '@ng-native/expo/notifications';
import { FirebaseMessaging, type NativeFirebaseMessaging } from '@ng-native/firebase-messaging';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What `Notifications` asks of `expo-notifications` to hand over a push token, and its roll. */
function fakeNotifications(token: DevicePushToken, granted = true) {
  let roll: ((token: DevicePushToken) => void) | undefined;
  const asked: string[] = [];
  const status = { status: granted ? 'granted' : 'denied', granted, canAskAgain: true };
  const subscription = { remove() {} };
  const native = {
    addNotificationReceivedListener: () => subscription,
    addNotificationResponseReceivedListener: () => subscription,
    addNotificationsDroppedListener: () => subscription,
    addPushTokenListener: (listener: (token: DevicePushToken) => void) => {
      roll = listener;
      return subscription;
    },
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => status,
    requestPermissionsAsync: async () => (asked.push('permission'), status),
    getDevicePushTokenAsync: async () => (asked.push('token'), token),
  } as unknown as NativeNotifications;
  return { native, asked, roll: (next: DevicePushToken) => roll?.(next) };
}

function fakeFirebase(ids = ['fid-1']) {
  const registered: (string | null)[] = [];
  const native: NativeFirebaseMessaging = {
    register: async (apnsToken) => void registered.push(apnsToken),
    getInstallationId: async () => ids[Math.min(registered.length, ids.length) - 1] ?? ids[0]!,
  };
  return { native, registered };
}

let root: EnvironmentInjector;
before(async () => {
  const mod = await compileFixture('fixtures/counter.ts');
  root = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector.get(
    EnvironmentInjector,
  );
});

function setup(
  firebase: NativeFirebaseMessaging | null,
  notifications: NativeNotifications | null,
  os: 'ios' | 'android' = 'ios',
) {
  const handled: unknown[] = [];
  const foreground = new Set<() => void>();
  const injector = createEnvironmentInjector(
    [
      { provide: FirebaseMessaging.SOURCE, useValue: firebase },
      { provide: Notifications.SOURCE, useValue: notifications },
      { provide: Notifications, useFactory: () => new Notifications() },
      { provide: OS, useValue: os },
      {
        provide: Permission.FOREGROUND,
        useValue: (listener: () => void) => (
          foreground.add(listener),
          () => void foreground.delete(listener)
        ),
      },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => handled.push(error) } },
    ],
    root,
  );
  const messaging = runInInjectionContext(injector, () => new FirebaseMessaging());
  const flush = async () => {
    root.get(ApplicationRef).tick();
    await settle();
  };
  /** The app coming back to the front. */
  const comeBack = async () => {
    foreground.forEach((listener) => listener());
    await settle();
  };
  return { messaging, flush, handled, comeBack, destroy: () => injector.destroy() };
}

describe('FirebaseMessaging', () => {
  it('registers with the APNs token on iOS, as the hex expo-notifications hands over', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging } = setup(firebase.native, native);

    assert.equal(messaging.installationId(), null);
    assert.equal(await messaging.register(), 'fid-1');
    assert.deepEqual(firebase.registered, ['a1b2']);
    assert.equal(messaging.installationId(), 'fid-1');
  });

  it("registers on Android without fetching FCM's deprecated registration token", async () => {
    const firebase = fakeFirebase();
    const { native, asked } = fakeNotifications({ type: 'android', data: 'fcm-token' });
    const { messaging } = setup(firebase.native, native, 'android');

    assert.equal(await messaging.register(), 'fid-1');
    assert.deepEqual(firebase.registered, [null]);
    assert.deepEqual(asked, []);
  });

  it('does not register on Android without the notification permission', async () => {
    const firebase = fakeFirebase();
    const { native, asked } = fakeNotifications({ type: 'android', data: 'fcm-token' }, false);
    const { messaging } = setup(firebase.native, native, 'android');

    assert.equal(await messaging.register(), null);
    assert.deepEqual(firebase.registered, []);
    assert.deepEqual(asked, ['permission'], 'it asked, and was refused');
  });

  it('registers again on Android when the token rolls, with no APNs token', async () => {
    const firebase = fakeFirebase(['fid-1', 'fid-2']);
    const notifications = fakeNotifications({ type: 'android', data: 'fcm-token' });
    const { messaging, flush } = setup(firebase.native, notifications.native, 'android');
    await messaging.register();

    notifications.roll({ type: 'android', data: 'fcm-token-2' });
    await flush();
    assert.deepEqual(firebase.registered, [null, null]);
    assert.equal(messaging.installationId(), 'fid-2');
  });

  it('does not register without the notification permission', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' }, false);
    const { messaging } = setup(firebase.native, native);

    assert.equal(await messaging.register(), null);
    assert.deepEqual(firebase.registered, []);
    assert.equal(messaging.installationId(), null);
  });

  it('answers null without the native module, and asks nothing', async () => {
    const { native, asked } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging } = setup(null, native);

    assert.equal(await messaging.register(), null);
    assert.equal(await messaging.getInstallationId(), null);
    assert.deepEqual(asked, [], 'nor asks for a permission it has no use for');
  });

  it("reads the native module from Expo's registry by default, and null where it is not", () => {
    const host = globalThis as { expo?: unknown };
    const saved = host.expo;
    const factory = (FirebaseMessaging.SOURCE as unknown as { ɵprov: { factory(): unknown } }).ɵprov
      .factory;
    const firebase = fakeFirebase();
    try {
      host.expo = { modules: { NgNativeFirebaseMessaging: firebase.native } };
      assert.equal(factory(), firebase.native);
      host.expo = { modules: {} };
      assert.equal(factory(), null);
    } finally {
      host.expo = saved;
    }
  });

  it('reads the FID without registering', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging } = setup(firebase.native, native);

    assert.equal(await messaging.getInstallationId(), 'fid-1');
    assert.deepEqual(firebase.registered, []);
    assert.equal(messaging.installationId(), null, 'only a registration sets it');
  });

  it('registers again with a rolled token, and sets the FID it answers', async () => {
    const firebase = fakeFirebase(['fid-1', 'fid-2']);
    const notifications = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, flush } = setup(firebase.native, notifications.native);
    await messaging.register();

    notifications.roll({ type: 'ios', data: 'c3d4' });
    await flush();
    assert.deepEqual(firebase.registered, ['a1b2', 'c3d4']);
    assert.equal(messaging.installationId(), 'fid-2');
  });

  it('hands a failed registration on a roll to the ErrorHandler, since nothing awaits it', async () => {
    const firebase = fakeFirebase();
    const notifications = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, flush, handled } = setup(firebase.native, notifications.native);
    await messaging.register();
    const refused = new Error('SERVICE_NOT_AVAILABLE');
    firebase.native.register = async () => Promise.reject(refused);

    notifications.roll({ type: 'ios', data: 'c3d4' });
    await flush();
    assert.deepEqual(handled, [refused]);
  });

  it('reads the FID again when the app comes back to the front, for one Firebase replaced', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, comeBack } = setup(firebase.native, native);
    await messaging.register();

    firebase.native.getInstallationId = async () => 'fid-new';
    await comeBack();
    assert.equal(messaging.installationId(), 'fid-new');
    assert.deepEqual(firebase.registered, ['a1b2'], 'reading it registers nothing');
  });

  it('reads nothing on coming back before the app registered', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, comeBack } = setup(firebase.native, native);
    let reads = 0;
    firebase.native.getInstallationId = async () => (reads++, 'fid-1');

    await comeBack();
    assert.equal(reads, 0);
    assert.equal(messaging.installationId(), null);
  });

  it('hands a failed read on coming back to the ErrorHandler, and keeps the FID it had', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, comeBack, handled } = setup(firebase.native, native);
    await messaging.register();
    const refused = new Error('SERVICE_NOT_AVAILABLE');
    firebase.native.getInstallationId = async () => Promise.reject(refused);

    await comeBack();
    assert.deepEqual(handled, [refused]);
    assert.equal(messaging.installationId(), 'fid-1');
  });

  it('stops listening for the app coming back once its injector is destroyed', async () => {
    const firebase = fakeFirebase();
    const { native } = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { messaging, comeBack, destroy } = setup(firebase.native, native);
    await messaging.register();
    destroy();

    firebase.native.getInstallationId = async () => 'fid-new';
    await comeBack();
    assert.equal(messaging.installationId(), 'fid-1');
  });

  it('does not register on a roll the app never asked to register for', async () => {
    const firebase = fakeFirebase();
    const notifications = fakeNotifications({ type: 'ios', data: 'a1b2' });
    const { flush } = setup(firebase.native, notifications.native);

    notifications.roll({ type: 'ios', data: 'c3d4' });
    await flush();
    assert.deepEqual(firebase.registered, []);
  });
});

type MetaData = { $: Record<string, string> };
type Manifest = { manifest: { application?: { 'meta-data'?: MetaData[] }[] } };

type Mod = (config: Record<string, unknown>) => Promise<{ modResults: unknown }>;

const plugin = createRequire(import.meta.url)('@ng-native/firebase-messaging/app.plugin.cjs') as ((
  config: Record<string, unknown>,
) => { mods: { ios: Record<string, Mod>; android: Record<string, Mod> } }) & {
  infoPlist: (plist: Record<string, unknown>) => Record<string, unknown>;
  androidManifest: (manifest: Manifest) => Manifest;
  podfile: (contents: string) => string;
};

const flag = (manifest: Manifest) =>
  manifest.manifest.application?.[0]?.['meta-data']
    ?.filter((item) => item.$['android:name'] === 'firebase_messaging_installation_id_enabled')
    .map((item) => item.$['android:value']);

describe('the config plugin', () => {
  it("registers each change as Expo's mod for its file", async () => {
    const config = { name: 'App', slug: 'app', _internal: { projectRoot: process.cwd() } };
    const { mods } = plugin(config);
    const run = async (mod: Mod, modResults: unknown) =>
      (await mod({ ...config, modResults, modRequest: {} })).modResults;

    assert.deepEqual(await run(mods.ios['infoPlist']!, {}), plugin.infoPlist({}));
    const podfile = "target 'App' do\n  use_expo_modules!\nend\n";
    assert.deepEqual(await run(mods.ios['podfile']!, { contents: podfile }), {
      contents: plugin.podfile(podfile),
    });
    const manifest = () => ({ manifest: { application: [{}] } });
    assert.deepEqual(
      await run(mods.android['manifest']!, manifest()),
      plugin.androidManifest(manifest()),
    );
  });

  it("turns on registration by installation ID on iOS, and off Firebase's app delegate proxy", () => {
    assert.deepEqual(plugin.infoPlist({ CFBundleName: 'App' }), {
      CFBundleName: 'App',
      FirebaseMessagingInstallationIdEnabled: true,
      FirebaseAppDelegateProxyEnabled: false,
    });
  });

  it('turns on registration by installation ID on Android', () => {
    assert.deepEqual(flag(plugin.androidManifest({ manifest: { application: [{}] } })), ['true']);
  });

  it('turns it on over a false the app set, and adds nothing run again', () => {
    const manifest: Manifest = {
      manifest: {
        application: [
          {
            'meta-data': [
              {
                $: {
                  'android:name': 'firebase_messaging_installation_id_enabled',
                  'android:value': 'false',
                },
              },
            ],
          },
        ],
      },
    };
    assert.deepEqual(flag(plugin.androidManifest(plugin.androidManifest(manifest))), ['true']);
  });

  it('gives GoogleUtilities modules, inside the app target, so Firebase links statically', () => {
    const podfile = "target 'App' do\n\n  use_expo_modules!\n  config = use_native_modules!\nend\n";
    assert.equal(
      plugin.podfile(podfile),
      "target 'App' do\n\n  use_expo_modules!\n  pod 'GoogleUtilities', :modular_headers => true\n" +
        '  config = use_native_modules!\nend\n',
    );
  });

  it('adds nothing run again, or where the app declares GoogleUtilities itself', () => {
    const once = plugin.podfile("target 'App' do\n  use_expo_modules!\nend\n");
    assert.equal(plugin.podfile(once), once);
    const own = 'target \'App\' do\n  use_expo_modules!\n  pod "GoogleUtilities"\nend\n';
    assert.equal(plugin.podfile(own), own);
  });

  it('fails on a Podfile without Expo modules, rather than build without Firebase linking', () => {
    assert.throws(() => plugin.podfile("target 'App' do\nend\n"), /use_expo_modules!/);
  });
});
