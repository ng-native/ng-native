/**
 * `expoModule` on a desktop OS. Every `expo-*` package resolves to an empty module there, so an
 * Expo module's loader is never called: the module is the desktop host's TurboModule the call
 * names with `desktop`, or nothing.
 *
 * The platform is `react-native`'s, reached through the same bare `require` the modules are, which
 * a test defines on the global and removes again.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DESKTOP_MODULES, MissingModuleError, expoModule } from '@ng-native/expo';
import { Storage } from '@ng-native/expo/async-storage';

/** A device on `os` whose desktop host registers the TurboModules in `registered`. */
function on(os: string, registered: Record<string, object> = {}): void {
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id === 'react-native') {
      return {
        Platform: { OS: os },
        TurboModuleRegistry: { get: (name: string) => registered[name] ?? null },
      };
    }
    throw new Error(`Cannot find module '${id}'`);
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

/** A loader that records being called, and answers a module. */
function loader() {
  const calls: string[] = [];
  return { calls, load: () => (calls.push('load'), { from: 'expo' }) };
}

describe('expoModule on macOS', () => {
  it('never calls the Expo loader', () => {
    on('macos');
    const { calls, load } = loader();
    expoModule('expo-haptics', load);
    expoModule('expo-haptics', load, ['ios', 'android', 'web']);
    expoModule('expo-haptics', load, { desktop: 'NgNativeHaptics' });
    assert.deepEqual(calls, []);
  });

  it('is null for a module with no desktop source, so the service is inert', () => {
    on('macos', { NgNativeBrightness: { from: 'desktop' } });
    assert.equal(expoModule('expo-brightness', loader().load), null);
    assert.equal(expoModule('expo-brightness', loader().load, { platforms: ['ios'] }), null);
  });

  it("answers the desktop host's TurboModule the call names", () => {
    const desktop = { from: 'desktop' };
    on('macos', { NgNativeHaptics: desktop });
    assert.equal(
      expoModule('expo-haptics', loader().load, { desktop: 'NgNativeHaptics' }),
      desktop,
    );
  });

  it('says to rebuild the desktop host when the named module is not in it', () => {
    on('macos');
    const found = expoModule('expo-haptics', loader().load, { desktop: 'NgNativeHaptics' });
    assert.ok(found, 'a stand-in, which throws when it is used');
    assert.throws(
      () => (found as Record<string, unknown>)['impactAsync'],
      (error: unknown) =>
        error instanceof MissingModuleError &&
        error.module === 'expo-haptics' &&
        /npm run macos/.test(error.message) &&
        !/npx expo run:/.test(error.message),
    );
  });
});

describe('expoModule with an options object', () => {
  it('takes platforms as the array form does', () => {
    on('android');
    const { calls, load } = loader();
    assert.deepEqual(expoModule('expo-x', load, { platforms: ['ios', 'android'] }), {
      from: 'expo',
    });
    on('web');
    assert.equal(
      expoModule('expo-x', () => null, { platforms: ['ios', 'android'] }),
      null,
      'inert where the module cannot exist',
    );
    on('ios');
    const missing = expoModule<object>('expo-x', () => null, { platforms: ['ios'] });
    assert.throws(() => (missing as unknown as Record<string, unknown>)['a'], MissingModuleError);
    assert.deepEqual(calls, ['load']);
  });

  it('still loads the Expo module on iOS and Android when it names a desktop one', () => {
    on('ios', { NgNativeHaptics: { from: 'desktop' } });
    assert.deepEqual(expoModule('expo-x', loader().load, { desktop: 'NgNativeHaptics' }), {
      from: 'expo',
    });
  });
});

/**
 * The Expo modules whose services have a desktop source in v1, and the desktop host's TurboModule
 * that implements each one's slice: `NgNative` and the package's name after `expo-`. A call needs
 * no `desktop` option of its own for these.
 */
const V1: Record<string, string> = {
  'expo-file-system': 'NgNativeFileSystem',
  'expo-secure-store': 'NgNativeSecureStore',
  'expo-clipboard': 'NgNativeClipboard',
  'expo-notifications': 'NgNativeNotifications',
  'expo-updates': 'NgNativeUpdates',
  'expo-application': 'NgNativeApplication',
  'expo-device': 'NgNativeDevice',
  'expo-localization': 'NgNativeLocalization',
  'expo-network': 'NgNativeNetwork',
  'expo-crypto': 'NgNativeCrypto',
  'expo-font': 'NgNativeFont',
  'expo-asset': 'NgNativeAsset',
  'expo-sqlite': 'NgNativeSqlite',
  'expo-keep-awake': 'NgNativeKeepAwake',
  'expo-web-browser': 'NgNativeWebBrowser',
  'expo-document-picker': 'NgNativeDocumentPicker',
  'expo-image-picker': 'NgNativeImagePicker',
  'expo-local-authentication': 'NgNativeLocalAuthentication',
  'expo-haptics': 'NgNativeHaptics',
  'expo-battery': 'NgNativeBattery',
  'expo-screen-capture': 'NgNativeScreenCapture',
  'expo-splash-screen': 'NgNativeSplashScreen',
  'expo-store-review': 'NgNativeStoreReview',
  'expo-audio': 'NgNativeAudio',
  'expo-video': 'NgNativeVideo',
  'expo-camera': 'NgNativeCamera',
  'expo-media-library': 'NgNativeMediaLibrary',
  'expo-location': 'NgNativeLocation',
  'expo-calendar': 'NgNativeCalendar',
  'expo-maps': 'NgNativeMaps',
  'expo-image-manipulator': 'NgNativeImageManipulator',
  'expo-local-llm': 'NgNativeLocalLlm',
  'expo-apple-authentication': 'NgNativeAppleAuthentication',
  'expo-tracking-transparency': 'NgNativeTrackingTransparency',
  'expo-print': 'NgNativePrint',
};

/** Mobile-only, absent for good on a desktop OS. */
const ABSENT = [
  'expo-brightness',
  'expo-screen-orientation',
  'expo-sensors',
  'expo-background-task',
  'expo-live-activity',
  'expo-navigation-bar',
];

describe('the services with a desktop source in v1', () => {
  for (const [module, desktop] of Object.entries(V1)) {
    it(`answer ${module} from ${desktop}`, () => {
      const found = { from: 'desktop' };
      on('macos', { [desktop]: found });
      assert.equal(expoModule(module, loader().load), found);
    });
  }

  it('say to rebuild the desktop host when its module is missing, on first use', () => {
    on('macos');
    const missing = expoModule<Record<string, unknown>>('expo-haptics', loader().load);
    assert.ok(missing, 'a stand-in rather than inert: the service should exist on macOS');
    assert.throws(
      () => missing['impactAsync'],
      (error: unknown) =>
        error instanceof MissingModuleError && /npm run macos/.test(error.message),
    );
  });

  it('are every one the table lists, and no more', () => {
    assert.deepEqual(DESKTOP_MODULES, V1);
  });

  it('leave a mobile-only module absent', () => {
    on('macos', Object.fromEntries(Object.values(V1).map((name) => [name, {}])));
    for (const module of ABSENT) assert.equal(expoModule(module, loader().load), null, module);
  });
});

describe('a package the desktop host serves as it is', () => {
  it('loads through the desktop loader a call gives', () => {
    on('macos');
    const { calls, load } = loader();
    assert.deepEqual(
      expoModule('a-package', () => null, { desktop: load }),
      { from: 'expo' },
    );
    assert.deepEqual(calls, ['load']);
  });

  it('keeps Storage on macOS, whose desktop host registers RNCAsyncStorage', async () => {
    const asked: string[] = [];
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id === 'react-native') return { Platform: { OS: 'macos' } };
      if (id === '@react-native-async-storage/async-storage') {
        return {
          default: { getItem: async (key: string) => (asked.push(key), JSON.stringify('dark')) },
        };
      }
      throw new Error(`Cannot find module '${id}'`);
    };
    const provider = (Storage as unknown as { ɵprov: { factory(): Storage } }).ɵprov;
    const theme = provider.factory().signal('theme', 'light');
    await new Promise((resolve) => setTimeout(resolve));
    assert.deepEqual([asked, theme()], [['theme'], 'dark']);
  });
});
