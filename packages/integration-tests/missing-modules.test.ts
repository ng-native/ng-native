/**
 * What a service does when its Expo module is not in the app.
 *
 * On a platform the module exists for, a missing module is a mistake the developer can fix - the
 * package was never installed, or the app was not rebuilt after it was - so the service throws a
 * `MissingModuleError` that names the module and says what to run. Anywhere the module cannot
 * exist - an iOS-only module on Android, the web, and Node, where there is no platform at all - the
 * service goes inert, as code shared across platforms needs it to.
 *
 * The platform is `react-native`'s, reached through the same bare `require` the modules are, which
 * a test defines on the global; see `expo-sources.test.ts`.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  runInInjectionContext,
  type Injector,
  type InjectionToken,
  type Type,
} from '@angular/core';
import { mount } from '@ng-native/platform';
import { cleanup, createFakeFabric, injectService } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { MissingModuleError } from '@ng-native/expo';
import { AppInfo } from '@ng-native/expo/app-info';
import { AppleSignIn } from '@ng-native/expo/apple-sign-in';
import { assets } from '@ng-native/expo/assets';
import { BackgroundTask } from '@ng-native/expo/background-task';
import { Battery } from '@ng-native/expo/battery';
import { Biometrics } from '@ng-native/expo/biometrics';
import { Brightness } from '@ng-native/expo/brightness';
import { Browser } from '@ng-native/expo/browser';
import { Camera } from '@ng-native/expo/camera';
import { Clipboard } from '@ng-native/expo/clipboard';
import { Crypto } from '@ng-native/expo/crypto';
import { database } from '@ng-native/expo/database';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { FileSystem } from '@ng-native/expo/file-system';
import { Foldable } from '@ng-native/expo/foldable';
import { Fonts, loadFonts } from '@ng-native/expo/fonts';
import { Haptics } from '@ng-native/expo/haptics';
import { ImageEditor } from '@ng-native/expo/image-editor';
import { ImagePicker } from '@ng-native/expo/image-picker';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { LanguageModel } from '@ng-native/expo/language-model';
import { Locale } from '@ng-native/expo/locale';
import { Location } from '@ng-native/expo/location';
import { MapView } from '@ng-native/expo/map-view';
import { MediaLibrary } from '@ng-native/expo/media-library';
import { Network } from '@ng-native/expo/network';
import { Notifications } from '@ng-native/expo/notifications';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { audioPlayer } from '@ng-native/expo/audio';
import { videoPlayer } from '@ng-native/expo/video';
import { ScreenCapture } from '@ng-native/expo/screen-capture';
import { Accelerometer } from '@ng-native/expo/sensors';
import { SplashScreen } from '@ng-native/expo/splash-screen';
import { SecureStorage } from '@ng-native/expo/secure-store';
import { Storage } from '@ng-native/expo/async-storage';
import { StoreReview } from '@ng-native/expo/store-review';
import { Tracking } from '@ng-native/expo/tracking';
import { Updates } from '@ng-native/expo/updates';
import { Watch } from '@ng-native/expo/watch';

type Platform = 'ios' | 'android' | 'web';

/** A device on `platform` whose app has none of the Expo modules in it. */
function on<T>(platform: Platform, run: () => T): T {
  const host = globalThis as Record<string, unknown>;
  host['require'] = (id: string) => {
    if (id === 'react-native') return { Platform: { OS: platform } };
    throw new Error(`Cannot find module '${id}'`);
  };
  try {
    return run();
  } finally {
    delete host['require'];
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

/** A token's own default factory, run directly, as `expo-sources.test.ts` explains. */
const factoryOf =
  <T>(token: InjectionToken<T>) =>
  (): T => {
    const provider = (token as unknown as { ɵprov?: { factory(): T } }).ɵprov;
    assert.ok(provider?.factory, 'the token still carries its default factory');
    return provider.factory();
  };

/** An injection context from a real mount, which a resource needs. */
let app: Injector;
before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/counter.ts', import.meta.url)),
  );
  app = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector;
});

const inContext = (run: () => unknown) => () => runInInjectionContext(app, run);

/**
 * Each service, how it reaches its module, the module, and where a missing one throws. A service
 * is inert on the web, which not every module supports; a database or a player cannot be inert,
 * so a missing module throws there too.
 */
const SERVICES: readonly [string, () => unknown, string, (readonly Platform[])?][] = [
  ['AppInfo', factoryOf(AppInfo.SOURCE), 'expo-application'],
  ['AppleSignIn', factoryOf(AppleSignIn.SOURCE), 'expo-apple-authentication', ['ios']],
  ['assets', inContext(() => assets(() => [])), 'expo-asset'],
  ['BackgroundTask', factoryOf(BackgroundTask.SOURCE), 'expo-background-task'],
  ['Battery', factoryOf(Battery.SOURCE), 'expo-battery'],
  ['Biometrics', factoryOf(Biometrics.SOURCE), 'expo-local-authentication'],
  ['Brightness', factoryOf(Brightness.SOURCE), 'expo-brightness'],
  ['Browser', factoryOf(Browser.SOURCE), 'expo-web-browser'],
  ['Camera', factoryOf(Camera.SOURCE), 'expo-camera'],
  ['Clipboard', factoryOf(Clipboard.SOURCE), 'expo-clipboard'],
  ['Crypto', factoryOf(Crypto.SOURCE), 'expo-crypto'],
  ['database', () => database('app.db').ready(), 'expo-sqlite', ['ios', 'android', 'web']],
  ['DocumentPicker', factoryOf(DocumentPicker.SOURCE), 'expo-document-picker'],
  ['FileSystem', factoryOf(FileSystem.SOURCE), 'expo-file-system'],
  ['Foldable', factoryOf(Foldable.SOURCE), 'expo-foldables'],
  ['Fonts', factoryOf(Fonts), 'expo-font'],
  ['Haptics', factoryOf(Haptics.SOURCE), 'expo-haptics'],
  ['ImageEditor', factoryOf(ImageEditor.SOURCE), 'expo-image-manipulator'],
  ['ImagePicker', factoryOf(ImagePicker.SOURCE), 'expo-image-picker'],
  ['KeepAwake', factoryOf(KeepAwake.SOURCE), 'expo-keep-awake'],
  ['LanguageModel', factoryOf(LanguageModel.SOURCE), 'expo-local-llm', ['ios']],
  ['Locale', factoryOf(Locale.SOURCE), 'expo-localization'],
  ['Location', factoryOf(Location.SOURCE), 'expo-location'],
  ['MapView', factoryOf(MapView.SOURCE), 'expo-maps'],
  ['MediaLibrary', factoryOf(MediaLibrary.SOURCE), 'expo-media-library'],
  ['Network', factoryOf(Network.SOURCE), 'expo-network'],
  ['Notifications', factoryOf(Notifications.SOURCE), 'expo-notifications'],
  ['DeviceOrientation', factoryOf(DeviceOrientation.SOURCE), 'expo-screen-orientation'],
  [
    'videoPlayer',
    () => videoPlayer('https://example.com/a.mp4'),
    'expo-video',
    ['ios', 'android', 'web'],
  ],
  [
    'audioPlayer',
    () => audioPlayer('https://example.com/a.mp3'),
    'expo-audio',
    ['ios', 'android', 'web'],
  ],
  ['ScreenCapture', factoryOf(ScreenCapture.SOURCE), 'expo-screen-capture'],
  ['Accelerometer', factoryOf(Accelerometer), 'expo-sensors'],
  ['SplashScreen', () => factoryOf(SplashScreen)().hold(), 'expo-splash-screen'],
  ['Storage', factoryOf(Storage), '@react-native-async-storage/async-storage'],
  ['SecureStorage', factoryOf(SecureStorage), 'expo-secure-store'],
  ['StoreReview', factoryOf(StoreReview.SOURCE), 'expo-store-review'],
  ['Tracking', factoryOf(Tracking.SOURCE), 'expo-tracking-transparency'],
  ['Updates', factoryOf(Updates.SOURCE), 'expo-updates'],
  ['Watch', factoryOf(Watch.SOURCE), 'react-native-watch-connectivity', ['ios']],
];

/** What a throw says: the module, and the two commands that fix it. */
function fixes(module: string, platform: Platform) {
  return (error: unknown) => {
    assert.ok(error instanceof MissingModuleError, `a MissingModuleError, not ${String(error)}`);
    assert.equal(error.module, module);
    assert.match(error.message, new RegExp(`npx expo install ${module.replace(/[/@]/g, '\\$&')}`));
    if (platform === 'web') {
      assert.match(error.message, /restart the dev server/);
      assert.doesNotMatch(
        error.message,
        /npx expo run:/,
        'there is no native build to redo on the web',
      );
    } else assert.match(error.message, new RegExp(`npx expo run:${platform}`));
    return true;
  };
}

describe('a service whose module is missing', () => {
  for (const [name, reach, module, platforms = ['ios', 'android']] of SERVICES) {
    it(`${name}: throws with what to run where ${module} exists, and is inert elsewhere`, async () => {
      for (const platform of ['ios', 'android', 'web'] as const) {
        const attempt = async () => {
          const reached = on(platform, reach);
          // A player or a database reaches its module on creation; the rest do so in the factory.
          if (reached instanceof Promise) await reached;
        };
        if (platforms.includes(platform)) await assert.rejects(attempt, fixes(module, platform));
        else await assert.doesNotReject(attempt, `${name} is inert on ${platform}`);
      }
    });
  }

  it('is inert in Node, where there is no platform to ask', () => {
    for (const [name, reach] of SERVICES) {
      if (name === 'database' || name === 'videoPlayer' || name === 'audioPlayer') continue;
      assert.doesNotThrow(reach, name);
    }
  });
});

/**
 * The native modules each Expo package's JavaScript requires as it is evaluated, read from the
 * copy `@ng-native/expo` resolves: its `build`, and its `src`, which some packages ship as their
 * entry point in place of a build. Such a package throws while it is being evaluated when its native
 * half is not in the build, and Metro reports that as fatal whenever it is not inside another
 * module's load, as in a service's factory, before any `catch` can turn it into a
 * `MissingModuleError`.
 */
function requiredNativeModules(): Map<string, Set<string>> {
  const fromExpo = createRequire(fileURLToPath(new URL('../expo/package.json', import.meta.url)));
  const found = new Map<string, Set<string>>();
  for (const [, , module] of SERVICES) {
    let root: string;
    try {
      root = path.dirname(fromExpo.resolve(`${module}/package.json`));
    } catch {
      continue;
    }
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['__tests__', '__mocks__'].includes(entry.name)) walk(file);
        } else if (
          /\.(js|ts|tsx)$/.test(entry.name) &&
          !/\.d\.ts$|\.web\.|\.test\./.test(entry.name)
        ) {
          const source = readFileSync(file, 'utf8');
          const required = /requireNativeModule(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g;
          for (const [, name] of source.matchAll(required)) names.add(name!);
        }
      }
    };
    for (const dir of ['build', 'src']) {
      if (existsSync(path.join(root, dir))) walk(path.join(root, dir));
    }
    if (names.size > 0) found.set(module, names);
  }
  return found;
}

/**
 * A device on `platform` with each package's JavaScript but, where `present` says so, none of its
 * native half. Records which packages get evaluated.
 */
function withoutNativeHalf<T>(
  platform: Platform,
  present: (name: string) => boolean,
  run: () => T,
): { result: T; evaluated: string[] } {
  const evaluated: string[] = [];
  const host = globalThis as Record<string, unknown>;
  host['require'] = (id: string) => {
    if (id === 'react-native') return { Platform: { OS: platform } };
    if (id === 'expo-modules-core') {
      return { requireOptionalNativeModule: (name: string) => (present(name) ? {} : null) };
    }
    evaluated.push(id);
    throw new Error(`Cannot find native module for '${id}'`);
  };
  try {
    return { result: run(), evaluated };
  } finally {
    delete host['require'];
  }
}

describe('a service whose native module is not in the build', () => {
  const native = requiredNativeModules();

  it('finds packages to check, so the checks below are not empty', () => {
    assert.ok(native.size >= 25, `only ${[...native.keys()].join(', ')}`);
    assert.ok(native.get('expo-font')?.has('ExpoFontLoader'));
    // Packages whose entry point is their TypeScript source, with no build to read.
    for (const module of [
      'expo-file-system',
      'expo-image-manipulator',
      'expo-image-picker',
      'expo-keep-awake',
    ]) {
      assert.ok(native.has(module), `${module} requires no native module`);
    }
  });

  /** Reaching the service, as a promise, on a device whose native modules are `present`. */
  const attempt = (reach: () => unknown, platform: Platform, present: (name: string) => boolean) =>
    withoutNativeHalf(platform, present, () => {
      try {
        return Promise.resolve(reach());
      } catch (error) {
        return Promise.reject(error);
      }
    });

  for (const [name, reach, module, platforms = ['ios', 'android']] of SERVICES) {
    if (!native.has(module)) continue;
    it(`${name}: never evaluates ${module} without its native module, and says what to run`, async (t) => {
      const device = platforms.includes('ios') ? 'ios' : 'android';
      const everything = attempt(reach, device, () => true);
      await everything.result.catch(() => {});
      if (!everything.evaluated.includes(module)) {
        t.skip(`${name} reaches its native module without evaluating ${module}`);
        return;
      }
      // With only the package's own native modules answering, it is evaluated: the one asked for
      // is one the package itself requires.
      const names = native.get(module)!;
      const own = attempt(reach, device, (one) => names.has(one));
      await own.result.catch(() => {});
      assert.ok(own.evaluated.includes(module), `${module} was not evaluated with its modules`);
      for (const platform of platforms.filter((one) => one !== 'web') as Platform[]) {
        const { result, evaluated } = attempt(reach, platform, () => false);
        await assert.rejects(result, fixes(module, platform));
        assert.ok(!evaluated.includes(module), `${module} was evaluated on ${platform}`);
      }
    });
  }

  it('evaluates a package on the web, which registers its native module only once evaluated', async () => {
    const { result, evaluated } = withoutNativeHalf(
      'web',
      () => false,
      () => database('app.db').ready(),
    );
    await assert.rejects(result, fixes('expo-sqlite', 'web'));
    assert.ok(evaluated.includes('expo-sqlite'));
  });
});

/**
 * `loadFonts()` is called from bootstrap code such as `registerRunnable`'s synchronous callback,
 * where a throw skips the caller's `.catch` and nothing mounts.
 */
describe('loadFonts without expo-font', () => {
  const sheet = { fonts: [{ family: 'Inter', source: 1 }] };

  it('rejects rather than throwing, so the caller can mount in the fallback face', async () => {
    let loading: Promise<void> | undefined;
    assert.doesNotThrow(() => {
      loading = on('ios', () => loadFonts(sheet));
    });
    await assert.rejects(loading!, fixes('expo-font', 'ios'));
  });

  it('never evaluates expo-font when its native module is not in the build', async () => {
    // Expo Go without the module: expo-font's JavaScript is there and throws while it is being
    // evaluated, which Metro reports as fatal whenever that is not inside another module's load.
    const evaluated: string[] = [];
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) => {
      evaluated.push(id);
      if (id === 'react-native') return { Platform: { OS: 'ios' } };
      if (id === 'expo-modules-core') return { requireOptionalNativeModule: () => null };
      throw new Error(`Cannot find native module 'ExpoFontLoader'`);
    };
    let loading: Promise<void> | undefined;
    try {
      assert.doesNotThrow(() => {
        loading = loadFonts(sheet);
      });
    } finally {
      delete host['require'];
    }
    await assert.rejects(loading!, fixes('expo-font', 'ios'));
    assert.ok(!evaluated.includes('expo-font'), `expo-font was evaluated: ${evaluated.join(', ')}`);
  });

  it('loads through expo-font on the web, which registers its module only once evaluated', async () => {
    const loaded: unknown[] = [];
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) => {
      if (id === 'react-native') return { Platform: { OS: 'web' } };
      if (id === 'expo-modules-core') return { requireOptionalNativeModule: () => null };
      if (id === 'expo-font') {
        return {
          loadAsync: async (map: unknown) => void loaded.push(map),
          isLoaded: () => true,
          getLoadedFonts: () => [],
        };
      }
      throw new Error(`Cannot find module '${id}'`);
    };
    try {
      await loadFonts(sheet);
    } finally {
      delete host['require'];
    }
    assert.deepEqual(loaded, [{ Inter: 1 }]);
  });

  it('resolves when no sheet declares a face, as bootstrap calls it unconditionally', async () => {
    let loading: Promise<void> | undefined;
    assert.doesNotThrow(() => {
      loading = on('ios', () => loadFonts({}, null));
    });
    await assert.doesNotReject(loading!);
  });
});

/**
 * `react-native-watch-connectivity` is a TurboModule rather than an Expo module, and asks for it with
 * `TurboModuleRegistry.getEnforcing` as it is evaluated: in Expo Go, or a build made before it was
 * installed, evaluating it throws an invariant Metro reports as fatal.
 */
describe('the watch, without its TurboModule in the build', () => {
  const device = (registered: boolean) => {
    const evaluated: string[] = [];
    const host = globalThis as Record<string, unknown>;
    host['require'] = (id: string) => {
      if (id === 'react-native') {
        return {
          Platform: { OS: 'ios' },
          TurboModuleRegistry: { get: (name: string) => (registered ? { name } : null) },
        };
      }
      evaluated.push(id);
      if (!registered) throw new Error(`'WatchConnectivity' could not be found`);
      return { watchEvents: {} };
    };
    return evaluated;
  };

  it('never evaluates the package, and says what to run', () => {
    const evaluated = device(false);
    assert.throws(factoryOf(Watch.SOURCE), fixes('react-native-watch-connectivity', 'ios'));
    assert.deepEqual(evaluated, []);
  });

  it('loads the package once the module is registered', () => {
    const evaluated = device(true);
    assert.ok(factoryOf(Watch.SOURCE)());
    assert.deepEqual(evaluated, ['react-native-watch-connectivity']);
  });
});

/**
 * In Node there is no platform, so every native module is absent whether its package is installed
 * or not. Saying "install it" there is advice to do what is already done.
 */
describe('a module in a Node test', () => {
  afterEach(cleanup);

  it('says there is nothing to load it on, and what a test does instead', async () => {
    const { Crypto } = await import('@ng-native/expo/crypto');
    const { database } = await import('@ng-native/expo/database');
    const crypto = injectService(Crypto);
    assert.throws(
      () => crypto.randomUUID(),
      (error: Error) =>
        error instanceof MissingModuleError &&
        /expo-crypto has no native module to load in Node/.test(error.message) &&
        /Crypto\.SOURCE/.test(error.message) &&
        !/install/.test(error.message),
    );
    await assert.rejects(
      database('test.db').ready(),
      (error: Error) =>
        error instanceof MissingModuleError &&
        /expo-sqlite has no native module to load in Node/.test(error.message) &&
        /new Database\(open, migrations\)/.test(error.message) &&
        !/install/.test(error.message),
    );
  });

  it('takes a stand-in through SOURCE', async () => {
    const { Crypto } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto, {
      providers: [{ provide: Crypto.SOURCE, useValue: { randomUUID: () => 'test-id' } }],
    });
    assert.equal(crypto.randomUUID(), 'test-id');
  });
});
