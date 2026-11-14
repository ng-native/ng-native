/**
 * Every service against the one absence convention.
 *
 * - Each exposes `available` as a `Signal<boolean>`, whatever the OS.
 * - Where a service is absent, `available()` is false and every call is inert: it answers its return
 *   type's empty value (`[]`, `null`, `false` or nothing), or a promise of one, and never throws or
 *   hangs. A call that hands back a handle to stop what it started answers one that does nothing.
 *
 * Absent is each OS a service has no meaning on, or no module for: a Mac, where every `expo-*`
 * package is an empty module and no service names a desktop module yet, the web for a module not
 * written for it, iOS for Android's bars. Each service's public methods are read from its source,
 * so a method added later is checked too.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isSignal, type ProviderToken } from '@angular/core';
import { cleanup, injectService } from '@ng-native/testing';
import {
  Accessibility,
  AppState,
  ColorScheme,
  DeepLinks,
  DevMenu,
  Dialogs,
  Direction,
  HardwareBack,
  Keyboard,
  LayoutAnimation,
  NavigationBar,
  OS,
  SafeArea,
  Screen,
  Sharing,
  StatusBar,
  Vibration,
} from '@ng-native/device';
import { AddressSearch } from '@ng-native/expo/address-search';
import { AppInfo } from '@ng-native/expo/app-info';
import { AppleSignIn } from '@ng-native/expo/apple-sign-in';
import { Storage } from '@ng-native/expo/async-storage';
import { BackgroundTask } from '@ng-native/expo/background-task';
import { Battery } from '@ng-native/expo/battery';
import { Biometrics } from '@ng-native/expo/biometrics';
import { Brightness } from '@ng-native/expo/brightness';
import { Browser } from '@ng-native/expo/browser';
import { Calendar } from '@ng-native/expo/calendar';
import { Clipboard } from '@ng-native/expo/clipboard';
import { Crypto } from '@ng-native/expo/crypto';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { FileSystem } from '@ng-native/expo/file-system';
import { Foldable } from '@ng-native/expo/foldable';
import { Fonts } from '@ng-native/expo/fonts';
import { Haptics } from '@ng-native/expo/haptics';
import { ImageEditor } from '@ng-native/expo/image-editor';
import { ImagePicker } from '@ng-native/expo/image-picker';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { LanguageModel } from '@ng-native/expo/language-model';
import { Locale } from '@ng-native/expo/locale';
import { Location } from '@ng-native/expo/location';
import { MediaLibrary } from '@ng-native/expo/media-library';
import { Network } from '@ng-native/expo/network';
import { Notifications } from '@ng-native/expo/notifications';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { ScreenCapture } from '@ng-native/expo/screen-capture';
import { SecureStorage } from '@ng-native/expo/secure-store';
import { Accelerometer } from '@ng-native/expo/sensors';
import { SplashScreen } from '@ng-native/expo/splash-screen';
import { StoreReview } from '@ng-native/expo/store-review';
import { TextRecognition } from '@ng-native/expo/text-recognition';
import { Tracking } from '@ng-native/expo/tracking';
import { Updates } from '@ng-native/expo/updates';
import { Watch } from '@ng-native/expo/watch';
import { FirebaseMessaging } from '@ng-native/firebase-messaging';
import { NativeScript } from '@ng-native/nativescript';

type Os = 'ios' | 'android' | 'macos' | 'web';

/**
 * Each service: its token, the source file and class that declare its methods, and the OSes it is
 * absent on whatever the app installs. An Expo-backed service is absent on the web unless its
 * module is written for it, and on a Mac until it names a desktop module.
 */
interface Entry {
  readonly token: ProviderToken<unknown>;
  readonly file: string;
  readonly cls: string;
  readonly absentOn: readonly Os[];
  /**
   * Made with its module or not at all, so on an OS its module is written for, a test without the
   * module is a misconfiguration that throws as the service is made or first read.
   */
  readonly madeWithModule?: boolean;
}

const device = (token: ProviderToken<unknown>, file: string, absentOn: readonly Os[] = []) => ({
  token,
  file: `device/src/${file}.ts`,
  cls: (token as { name: string }).name,
  absentOn,
});
const expo = (
  token: ProviderToken<unknown>,
  file: string,
  options: { cls?: string; absentOn?: readonly Os[]; madeWithModule?: boolean } = {},
): Entry => ({
  token,
  file: `expo/src/${file}.ts`,
  cls: options.cls ?? (token as { name: string }).name,
  absentOn: options.absentOn ?? ['macos', 'web'],
  madeWithModule: options.madeWithModule,
});

const SERVICES: Readonly<Record<string, Entry>> = {
  Accessibility: device(Accessibility, 'accessibility'),
  AppState: device(AppState, 'app-state'),
  ColorScheme: device(ColorScheme, 'color-scheme'),
  DeepLinks: device(DeepLinks, 'deep-links'),
  DevMenu: device(DevMenu, 'dev-menu'),
  Dialogs: device(Dialogs, 'dialogs'),
  Direction: device(Direction, 'direction'),
  HardwareBack: device(HardwareBack, 'hardware-back', ['ios', 'macos', 'web']),
  Keyboard: device(Keyboard, 'keyboard', ['macos', 'web']),
  LayoutAnimation: device(LayoutAnimation, 'layout-animation'),
  NavigationBar: device(NavigationBar, 'navigation-bar', ['ios', 'macos', 'web']),
  SafeArea: device(SafeArea, 'safe-area'),
  Screen: device(Screen, 'screen'),
  Sharing: device(Sharing, 'sharing'),
  StatusBar: device(StatusBar, 'status-bar', ['macos', 'web']),
  Vibration: device(Vibration, 'vibration', ['macos']),
  AddressSearch: expo(AddressSearch, 'address-search'),
  AppInfo: expo(AppInfo, 'app-info'),
  AppleSignIn: expo(AppleSignIn, 'apple-sign-in', { absentOn: ['android', 'macos', 'web'] }),
  BackgroundTask: expo(BackgroundTask, 'background-task'),
  Battery: expo(Battery, 'battery'),
  Biometrics: expo(Biometrics, 'biometrics'),
  Brightness: expo(Brightness, 'brightness'),
  Browser: expo(Browser, 'browser'),
  Calendar: expo(Calendar, 'calendar'),
  Clipboard: expo(Clipboard, 'clipboard'),
  Crypto: expo(Crypto, 'crypto'),
  DocumentPicker: expo(DocumentPicker, 'document-picker'),
  FileSystem: expo(FileSystem, 'file-system'),
  Foldable: expo(Foldable, 'foldable'),
  Fonts: expo(Fonts, 'fonts', { cls: 'FontRegistry' }),
  Haptics: expo(Haptics, 'haptics'),
  ImageEditor: expo(ImageEditor, 'image-editor'),
  ImagePicker: expo(ImagePicker, 'image-picker'),
  KeepAwake: expo(KeepAwake, 'keep-awake'),
  LanguageModel: expo(LanguageModel, 'language-model'),
  Locale: expo(Locale, 'locale'),
  Location: expo(Location, 'location'),
  MediaLibrary: expo(MediaLibrary, 'media-library'),
  Network: expo(Network, 'network'),
  Notifications: expo(Notifications, 'notifications'),
  DeviceOrientation: expo(DeviceOrientation, 'orientation'),
  ScreenCapture: expo(ScreenCapture, 'screen-capture'),
  Storage: expo(Storage, 'store', { cls: 'Store', absentOn: ['web'] }),
  SecureStorage: expo(SecureStorage, 'store', { cls: 'Store' }),
  Accelerometer: expo(Accelerometer, 'sensors', { cls: 'Sensor' }),
  SplashScreen: expo(SplashScreen, 'splash-screen', { cls: 'Splash', madeWithModule: true }),
  StoreReview: expo(StoreReview, 'store-review'),
  // Vision's: a missing module on iOS or macOS is a build without it, which says so.
  TextRecognition: expo(TextRecognition, 'text-recognition', { absentOn: ['android', 'web'] }),
  Tracking: expo(Tracking, 'tracking'),
  Updates: expo(Updates, 'updates'),
  Watch: expo(Watch, 'watch', { absentOn: ['android', 'macos', 'web'] }),
  FirebaseMessaging: {
    token: FirebaseMessaging,
    file: 'firebase-messaging/src/firebase-messaging.ts',
    cls: 'FirebaseMessaging',
    absentOn: ['macos', 'web'],
  },
  NativeScript: {
    token: NativeScript,
    file: 'nativescript/src/native-script.ts',
    cls: 'NativeScript',
    absentOn: ['macos', 'web'],
    madeWithModule: true,
  },
};

/**
 * Calls that are not inert by design, each with why.
 *
 * - Randomness and digests have no empty value that is safe to hand back, so `Crypto` throws where
 *   it has no module rather than answer one.
 * - A model can be unavailable with its module there (not downloaded, not enabled), and a call then
 *   rejects with the reason, so code already handles it; absence is one more reason.
 * - A message to a watch fails on an iPhone with none paired, so code already handles it; absence
 *   is the same answer.
 */
const NOT_INERT: Readonly<Record<string, readonly string[]>> = {
  Crypto: [
    'randomUUID',
    'digestString',
    'digest',
    'randomBytes',
    'randomBytesAsync',
    'randomValues',
  ],
  LanguageModel: ['generate', 'generateObject', 'stream', 'session'],
  Watch: ['send', 'sendData', 'sendFile'],
};

/**
 * Calls whose return type is a record or a status, with the value that says nothing happened, or
 * that the service is not here, as a check on what the call answers.
 */
const EMPTY_ANSWERS: Readonly<Record<string, (answer: unknown) => boolean>> = {
  'Biometrics.authenticate': (answer) => (answer as { success: boolean }).success === false,
  'BackgroundTask.status': (answer) => answer === 1, // BackgroundTaskStatus.Restricted
  'LanguageModel.refresh': (answer) => answer === 'notInstalled',
  'Watch.status': (answer) =>
    JSON.stringify(answer) ===
    JSON.stringify({ paired: false, installed: false, reachable: false }),
  'TextRecognition.recognize': (answer) => (answer as { text: string }).text === '',
  'FileSystem.cache': (answer) => (answer as { exists: boolean }).exists === false,
  'FileSystem.document': (answer) => (answer as { exists: boolean }).exists === false,
  'FileSystem.file': (answer) => (answer as { exists: boolean }).exists === false,
};

/** Arguments a call needs before it can reach the question of whether its module is there. */
const ARGUMENTS: Readonly<Record<string, (service: Record<string, unknown>) => unknown[]>> = {
  'NavigationBar.set': () => [{}],
  'NavigationBar.push': () => [{}],
  'StatusBar.set': () => [{}],
  'StatusBar.push': () => [{}],
  'FileSystem.write': (files) => [(files['cache'] as (name: string) => unknown)('a.txt'), 'a'],
};

/** The public methods a class declares in `file`: not private, protected, static or a getter. */
function publicMethods(file: string, cls: string): string[] {
  const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === cls) {
      for (const member of node.members) {
        const hidden = ts
          .getModifiers(member as ts.HasModifiers)
          ?.some((modifier) =>
            [
              ts.SyntaxKind.PrivateKeyword,
              ts.SyntaxKind.ProtectedKeyword,
              ts.SyntaxKind.StaticKeyword,
            ].includes(modifier.kind),
          );
        if (hidden || !ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        names.push(member.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** A device on `os` with React Native and nothing else in the app. */
function on(os: Os | null): void {
  const host = globalThis as Record<string, unknown>;
  if (os === null) {
    delete host['require'];
    return;
  }
  host['require'] = (id: string) => {
    if (id === 'react-native') {
      return {
        Platform: { OS: os },
        AppState: { addEventListener: () => ({ remove() {} }) },
        TurboModuleRegistry: { get: () => null },
      };
    }
    throw new Error(`Cannot find module '${id}'`);
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
  cleanup();
});

/**
 * Whether `value` is a return type's empty value: `[]`, `null`, `false` or nothing, `''` or `0` for
 * a string or a number, a signal holding one of those, or a handle to something that never started.
 */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === '' || value === 0) {
    return true;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (isSignal(value)) return isEmpty(value());
  if (typeof value === 'function') {
    // A stop or remove handle, which must do nothing.
    (value as () => unknown)();
    return true;
  }
  return false;
}

/** What a call answers, settled. An inert call never waits, so one still pending after a second hangs. */
async function settled(value: unknown): Promise<unknown> {
  if (!(value instanceof Promise)) return value;
  const hung = Symbol('hung');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      value,
      new Promise((resolve) => (timer = setTimeout(() => resolve(hung), 1000))),
    ]);
    assert.notEqual(result, hung, 'an inert call never hangs');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

describe('every service', () => {
  for (const [name, { token, madeWithModule }] of Object.entries(SERVICES)) {
    it(`${name}: available is a Signal<boolean> on every OS`, () => {
      for (const os of ['ios', 'android', 'macos', 'web'] as const) {
        // Without its module where it is written for, a test is a misconfiguration.
        if (madeWithModule && (os === 'ios' || os === 'android')) continue;
        on(os);
        try {
          const service = injectService(token, { providers: [{ provide: OS, useValue: os }] });
          const available = (service as { available: unknown }).available;
          assert.ok(isSignal(available), `${name}.available is a signal on ${os}`);
          assert.equal(typeof available(), 'boolean', `${name}.available() on ${os}`);
        } finally {
          on(null);
          cleanup();
        }
      }
    });
  }

  for (const [name, { token, file, cls, absentOn }] of Object.entries(SERVICES)) {
    for (const os of absentOn) {
      it(`${name}: absent on ${os}, with every call inert`, async () => {
        on(os);
        try {
          const service = injectService(token, {
            providers: [{ provide: OS, useValue: os }],
          }) as Record<string, unknown>;
          // An answer that comes in a turn after the first read must come in false too.
          (service['available'] as () => boolean)();
          await settled(new Promise((resolve) => setTimeout(resolve)));
          assert.equal((service['available'] as () => boolean)(), false, `${name}.available()`);
          for (const method of publicMethods(file, cls)) {
            if (NOT_INERT[name]?.includes(method)) continue;
            const key = `${name}.${method}`;
            const args = ARGUMENTS[key]?.(service) ?? [];
            let answer: unknown;
            assert.doesNotThrow(
              () =>
                (answer = (service[method] as (...a: unknown[]) => unknown).call(service, ...args)),
              `${key}() throws`,
            );
            const value = await settled(answer).catch((error: unknown) => {
              assert.fail(`${key}() rejects: ${String(error)}`);
            });
            const empty = EMPTY_ANSWERS[key] ?? isEmpty;
            assert.ok(empty(value), `${key}() answers ${String(value)}`);
          }
        } finally {
          on(null);
        }
      });
    }
  }

  it('reads methods from every source, so a rename is not a silent pass', () => {
    const counted = Object.values(SERVICES).reduce(
      (sum, { file, cls }) => sum + publicMethods(file, cls).length,
      0,
    );
    assert.ok(counted > 100, `found ${counted} methods`);
  });
});
