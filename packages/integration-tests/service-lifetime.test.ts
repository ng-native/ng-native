/**
 * A root service's native listeners end with the app that made them.
 *
 * Each of these services subscribes to the platform when it is constructed, and a root service is
 * constructed once per app. That is once for the life of the process only while the app is never
 * torn down - and an app is torn down: by a test's `unmount`, by a reload, by a host that mounts
 * and unmounts one. Every one of those left a listener behind, still firing into a service nobody
 * could reach, so the count here is of listeners still attached after the app is destroyed.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Provider, Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import {
  Accessibility,
  AppState,
  ColorScheme,
  Direction,
  Keyboard,
  Screen,
} from '@ng-native/device';
import type { Observed } from '@ng-native/expo';
import { Battery } from '@ng-native/expo/battery';
import { Clipboard } from '@ng-native/expo/clipboard';
import { LanguageModel } from '@ng-native/expo/language-model';
import { Locale } from '@ng-native/expo/locale';
import { Network } from '@ng-native/expo/network';
import { AppleSignIn } from '@ng-native/expo/apple-sign-in';
import { Notifications } from '@ng-native/expo/notifications';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { ScreenCapture } from '@ng-native/expo/screen-capture';
import { compileFixture } from './compile.ts';

/** Listeners attached and not yet removed, across every fake below. */
let live = 0;

/** Attach one listener, and return what removes it. Removing twice counts once. */
function listen(): () => void {
  live++;
  let removed = false;
  return () => {
    if (!removed) live--;
    removed = true;
  };
}

const subscription = () => ({ remove: listen() });

function observedFake<T>(first: T): Observed<T> {
  return { current: async () => first, subscribe: listen };
}

const cases: readonly { name: string; service: Type<unknown>; providers: Provider[] }[] = [
  {
    name: 'Clipboard',
    service: Clipboard,
    providers: [
      {
        provide: Clipboard.SOURCE,
        useValue: {
          getStringAsync: async () => '',
          setStringAsync: async () => true,
          addClipboardListener: subscription,
        },
      },
    ],
  },
  {
    name: 'ScreenCapture',
    service: ScreenCapture,
    providers: [
      {
        provide: ScreenCapture.SOURCE,
        useValue: { addScreenshotListener: subscription },
      },
    ],
  },
  {
    name: 'Locale',
    service: Locale,
    providers: [
      {
        provide: Locale.SOURCE,
        useValue: { locales: () => [], calendars: () => [], onChange: listen },
      },
    ],
  },
  {
    name: 'LanguageModel',
    service: LanguageModel,
    providers: [
      {
        provide: LanguageModel.SOURCE,
        useValue: {
          availability: () => 'available',
          onAvailabilityChange: subscription,
          onDownloadProgress: subscription,
          download: async () => {},
          session: () => {
            throw new Error('not in this test');
          },
        },
      },
    ],
  },
  {
    name: 'Notifications',
    service: Notifications,
    providers: [
      {
        provide: Notifications.SOURCE,
        // expo-notifications' listeners hand back a subscription to remove, not a function.
        useValue: {
          addNotificationReceivedListener: () => ({ remove: listen() }),
          addNotificationResponseReceivedListener: () => ({ remove: listen() }),
          addNotificationsDroppedListener: () => ({ remove: listen() }),
          addPushTokenListener: () => ({ remove: listen() }),
          getLastNotificationResponseAsync: async () => null,
        },
      },
    ],
  },
  {
    name: 'AppleSignIn',
    service: AppleSignIn,
    providers: [
      {
        provide: AppleSignIn.SOURCE,
        useValue: { addRevokeListener: () => ({ remove: listen() }) },
      },
    ],
  },
  {
    name: 'Battery',
    service: Battery,
    providers: [
      {
        provide: Battery.SOURCE,
        useValue: {
          level: observedFake(0.5),
          state: observedFake('charging'),
          saving: observedFake(false),
        },
      },
    ],
  },
  {
    name: 'Network',
    service: Network,
    providers: [
      {
        provide: Network.SOURCE,
        useValue: observedFake({ connected: true, type: 'wifi', reachable: true }),
      },
    ],
  },
  {
    name: 'DeviceOrientation',
    service: DeviceOrientation,
    providers: [
      {
        provide: DeviceOrientation.SOURCE,
        useValue: {
          reported: observedFake('portrait'),
          lock: async () => {},
          unlock: async () => {},
        },
      },
    ],
  },
  {
    name: 'AppState',
    service: AppState,
    providers: [
      { provide: AppState.SOURCE, useValue: { current: () => 'active', subscribe: listen } },
    ],
  },
  {
    name: 'ColorScheme',
    service: ColorScheme,
    providers: [
      { provide: ColorScheme.SOURCE, useValue: { current: () => 'light', subscribe: listen } },
    ],
  },
  {
    name: 'Accessibility',
    service: Accessibility,
    providers: [
      {
        provide: Accessibility.SOURCE,
        useValue: {
          current: async () => ({
            screenReader: false,
            reduceMotion: false,
            boldText: false,
            fontScale: 1,
          }),
          subscribe: listen,
          announce: () => {},
        },
      },
    ],
  },
  {
    name: 'Keyboard',
    service: Keyboard,
    providers: [{ provide: Keyboard.SOURCE, useValue: { subscribe: listen, dismiss: () => {} } }],
  },
  {
    name: 'Direction',
    service: Direction,
    providers: [
      { provide: Direction.SOURCE, useValue: { current: () => 'ltr', subscribe: listen } },
    ],
  },
  {
    name: 'Screen',
    service: Screen,
    providers: [
      {
        provide: Screen.SOURCE,
        useValue: {
          current: () => ({ window: { width: 1, height: 1 }, screen: { width: 1, height: 1 } }),
          subscribe: listen,
        },
      },
    ],
  },
];

describe('a root service with a native listener', () => {
  let Counter: Type<unknown>;
  before(async () => {
    const mod = await compileFixture('fixtures/counter.ts');
    Counter = mod['Counter'] as Type<unknown>;
  });

  for (const { name, service, providers } of cases) {
    it(`${name} removes its listeners when the app is destroyed`, () => {
      live = 0;
      for (let round = 0; round < 5; round++) {
        const app = mount(1, Counter, createFakeFabric(), { providers });
        app.componentRef.injector.get(service);
        assert.ok(live > 0, 'the service did subscribe, so there is something to remove');
        app.applicationRef.destroy();
        assert.equal(live, 0, `round ${round + 1}: every listener removed with the app`);
      }
    });
  }
});
