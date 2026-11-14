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

/**
 * The host contract for `NgNativeClipboard`: `getStringAsync`, `setStringAsync` and
 * `hasStringAsync`, and an `ngNativeClipboard` event on `DeviceEventEmitter` each time the
 * pasteboard's change count moves, from this app or another, with no payload: the contents are
 * read only when asked for. A TurboModule cannot hand back `addClipboardListener`'s subscription,
 * so the change listener is the emitter's.
 */
describe('the clipboard on macOS', () => {
  it('counts the changes the desktop host sends on its emitter', async () => {
    const listeners = new Set<(event: unknown) => void>();
    const emitted: string[] = [];
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
      return {
        Platform: { OS: 'macos' },
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeClipboard'
              ? {
                  getStringAsync: async () => 'copied',
                  setStringAsync: async () => true,
                  hasStringAsync: async () => true,
                }
              : null,
        },
        DeviceEventEmitter: {
          addListener: (event: string, listener: (event: unknown) => void) => {
            emitted.push(event);
            listeners.add(listener);
            return { remove: () => void listeners.delete(listener) };
          },
        },
      };
    };
    const { Clipboard } = await import('@ng-native/expo/clipboard');
    const { injectService } = await import('@ng-native/testing');
    const clipboard = injectService(Clipboard);
    assert.equal(clipboard.available(), true);
    assert.deepEqual(emitted, ['ngNativeClipboard']);
    for (const listener of listeners) listener({});
    for (const listener of listeners) listener({});
    assert.equal(clipboard.changes(), 2);
    assert.equal(await clipboard.read(), 'copied');
  });
});

/**
 * The host contract for the whole-app updater on `NgNativeUpdates` (Sparkle, in a `dmg` build):
 * the `isAppUpdaterAvailable` property, `isAppUpdateAvailable()` answering at once,
 * `checkForAppUpdateAsync()` showing Sparkle's check and resolving whether there was an updater to
 * ask, and an `appUpdateAvailable` event on `DeviceEventEmitter` with `{ available }` whenever that
 * changes. In development and in `app` and `mas` builds the property is false and the rest is
 * inert.
 */
describe('the app updater on macOS', () => {
  function host(updater: boolean, startsAvailable = false) {
    const listeners = new Set<(event: unknown) => void>();
    const calls: string[] = [];
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
      return {
        Platform: { OS: 'macos' },
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeUpdates'
              ? {
                  isEnabled: false,
                  isAppUpdaterAvailable: updater,
                  isAppUpdateAvailable: () => updater && startsAvailable,
                  checkForAppUpdateAsync: async () => (calls.push('check'), updater),
                  checkForUpdateAsync: async () => ({ isAvailable: false }),
                  fetchUpdateAsync: async () => ({ isNew: false }),
                  reloadAsync: async () => {},
                }
              : null,
        },
        DeviceEventEmitter: {
          addListener: (event: string, listener: (event: unknown) => void) => {
            calls.push(`listen ${event}`);
            listeners.add(listener);
            return { remove: () => void listeners.delete(listener) };
          },
        },
      };
    };
    return { calls, send: (body: unknown) => listeners.forEach((listener) => listener(body)) };
  }

  it('follows Sparkle: what it found at launch, what it finds later, and a check on demand', async () => {
    const sparkle = host(true, true);
    const { Updates } = await import('@ng-native/expo/updates');
    const { injectService } = await import('@ng-native/testing');
    const updates = injectService(Updates);
    assert.equal(updates.appUpdateAvailable(), true);
    sparkle.send({ available: false });
    assert.equal(updates.appUpdateAvailable(), false);
    sparkle.send({ available: true });
    assert.equal(updates.appUpdateAvailable(), true);
    assert.equal(await updates.checkForAppUpdate(), true);
    assert.deepEqual(sparkle.calls, ['listen appUpdateAvailable', 'check']);
  });

  it('is inert in a build with no updater, and never asks the host to check', async () => {
    const none = host(false);
    const { Updates } = await import('@ng-native/expo/updates');
    const { injectService } = await import('@ng-native/testing');
    const updates = injectService(Updates);
    assert.equal(updates.appUpdateAvailable(), false);
    assert.equal(await updates.checkForAppUpdate(), false);
    assert.deepEqual(none.calls, []);
  });
});

/**
 * The host contract for `NgNativeDocumentPicker`: `getDocumentAsync` as Expo's, plus
 * `saveDocumentAsync({ suggestedName, contents, types })`, which writes the file where the user
 * chose and answers its `file://` url or null when dismissed, with `contents` as text or as
 * `{ base64 }` for bytes; and `pickDirectoryAsync()`, which answers `{ uri }` or null when
 * dismissed.
 */
describe('the file dialogs on macOS', () => {
  function host() {
    const saved: unknown[] = [];
    let folder: { uri: string } | null = { uri: 'file:///Users/me/Exports' };
    (globalThis as Record<string, unknown>)['require'] = (id: string) => {
      if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
      return {
        Platform: { OS: 'macos' },
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeDocumentPicker'
              ? {
                  getDocumentAsync: async () => ({ canceled: true, assets: null }),
                  saveDocumentAsync: async (options: unknown) => {
                    saved.push(options);
                    return 'file:///Users/me/export.csv';
                  },
                  pickDirectoryAsync: async () => folder,
                }
              : null,
        },
      };
    };
    return { saved, dismiss: () => void (folder = null) };
  }

  it('saves through the save panel, with bytes as base64', async () => {
    const panel = host();
    const { DocumentPicker } = await import('@ng-native/expo/document-picker');
    const { injectService } = await import('@ng-native/testing');
    const picker = injectService(DocumentPicker);
    assert.equal(
      await picker.save({ suggestedName: 'a.csv', contents: 'a,b', types: ['text/csv'] }),
      'file:///Users/me/export.csv',
    );
    await picker.save({ suggestedName: 'a.bin', contents: new Uint8Array([0, 255, 104, 105]) });
    assert.deepEqual(panel.saved, [
      { suggestedName: 'a.csv', contents: 'a,b', types: ['text/csv'] },
      { suggestedName: 'a.bin', contents: { base64: 'AP9oaQ==' }, types: [] },
    ]);
  });

  it('picks a folder as its url, and answers null when dismissed', async () => {
    const panel = host();
    const { DocumentPicker } = await import('@ng-native/expo/document-picker');
    const { injectService } = await import('@ng-native/testing');
    const picker = injectService(DocumentPicker);
    assert.equal((await picker.pickDirectory())?.uri, 'file:///Users/me/Exports');
    panel.dismiss();
    assert.equal(await picker.pickDirectory(), null);
  });
});
