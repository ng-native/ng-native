/**
 * Reaching an Expo module without importing one.
 *
 * A static `import ... from 'expo-battery'` makes the file unloadable by Node, which is what used
 * to force every service into two files: the behaviour somewhere the test suite could reach, and
 * the binding somewhere it could not. A `require` inside a function has neither problem. Metro
 * still resolves the string literal at build time, so the module is bundled exactly as before and
 * an app that has not installed it still gets a build error rather than a surprise at runtime;
 * Node never evaluates the call at all, because nothing in a test asks for the real platform.
 *
 * The `catch` is doing two jobs, and only one of them is Node. In an ESM test `require` is not
 * defined, so calling it throws `ReferenceError` and the service goes inert - the same state as
 * a device that has no such sensor. On a device the throw is a module that is present but not
 * linked, which is the same answer for the same reason.
 */
/**
 * Calls a listener the app gave. What it throws, or rejects with when it is asynchronous, goes to
 * `report`, so one failing listener does not stop what calls it.
 */
export function isolated(call: () => unknown, report: (failure: unknown) => void): void {
  try {
    const done = call();
    if (done instanceof Promise) done.catch(report);
  } catch (failure) {
    report(failure);
  }
}

export function optional<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

/** The platforms an Expo module is written for. */
export type ModulePlatform = 'ios' | 'android' | 'web';

/**
 * A module the app needs and does not have: the package is not installed, or it is and the app was
 * not rebuilt since, so its native half is not in the binary. Development builds and Expo Go carry
 * only the native modules they were built with.
 */
export class MissingModuleError extends Error {
  override readonly name = 'MissingModuleError';
  /** The package, as it is installed: `expo-haptics`. */
  readonly module: string;

  constructor(module: string, platform: ModulePlatform, cause?: unknown, message?: string) {
    super(
      message ??
        (platform === 'web'
          ? `${module} is not installed. Install it with "npx expo install ${module}", then restart the dev server.`
          : `${module} is not in this build of the app. Install it with "npx expo install ${module}", ` +
            `then rebuild the app ("npx expo run:${platform}", or a new EAS build): a development ` +
            `build, and Expo Go, contain only the native modules they were built with.`),
      { cause },
    );
    this.module = module;
  }
}

/**
 * The `MissingModuleError` to throw where `expoModule` answered null: the module is installed or not, but there is
 * nothing to load it on. In Node, where a test runs, that is every native module, and "install it"
 * would be advice to do what is already done; `inTest` says what a test does instead. On a platform
 * the module does not support, it says that.
 */
export function unavailable(module: string, inTest: string): MissingModuleError {
  const platform = currentPlatform();
  const message =
    platform === null
      ? `[angular-native] ${module} has no native module to load in Node, where a test runs. ${inTest}`
      : `[angular-native] ${module} is not available on ${platform}.`;
  // The platform is only read for the default message, which this replaces.
  return new MissingModuleError(module, platform ?? 'web', undefined, message);
}

/** The platform the app is running on, or null in Node, where there is none to ask. */
export function currentPlatform(): ModulePlatform | null {
  return optional(
    () => (require('react-native') as { Platform: { OS: string } }).Platform.OS as ModulePlatform,
  );
}

/**
 * For each Expo package whose JavaScript requires a native module as it is evaluated, and so
 * throws when its native half is not in the build, one of those native modules. Any one of them
 * says whether the package's native half is there, and each of these is registered on both iOS and
 * Android.
 */
const NATIVE_MODULES: Readonly<Record<string, string>> = {
  'expo-application': 'ExpoApplication',
  'expo-asset': 'ExpoAsset',
  'expo-audio': 'ExpoAudio',
  'expo-background-task': 'ExpoBackgroundTask',
  'expo-battery': 'ExpoBattery',
  'expo-brightness': 'ExpoBrightness',
  'expo-clipboard': 'ExpoClipboard',
  'expo-crypto': 'ExpoCrypto',
  'expo-device': 'ExpoDevice',
  'expo-document-picker': 'ExpoDocumentPicker',
  'expo-file-system': 'FileSystem',
  'expo-foldables': 'ExpoFoldables',
  'expo-font': 'ExpoFontLoader',
  'expo-image-manipulator': 'ExpoImageManipulator',
  'expo-image-picker': 'ExponentImagePicker',
  'expo-keep-awake': 'ExpoKeepAwake',
  'expo-local-authentication': 'ExpoLocalAuthentication',
  'expo-local-llm': 'ExpoLocalLlm',
  'expo-localization': 'ExpoLocalization',
  'expo-location': 'ExpoLocation',
  'expo-media-library': 'ExpoMediaLibrary',
  'expo-network': 'ExpoNetwork',
  'expo-notifications': 'ExpoNotificationPresenter',
  'expo-screen-capture': 'ExpoScreenCapture',
  'expo-screen-orientation': 'ExpoScreenOrientation',
  'expo-secure-store': 'ExpoSecureStore',
  'expo-sensors': 'ExponentAccelerometer',
  'expo-sqlite': 'ExpoSQLite',
  'expo-store-review': 'ExpoStoreReview',
  'expo-tracking-transparency': 'ExpoTrackingTransparency',
  'expo-updates': 'ExpoUpdates',
  'expo-video': 'ExpoVideo',
  'expo-web-browser': 'ExpoWebBrowser',
};

/**
 * Whether `module`'s native half is missing from the build on `platform`, asked of Expo before its
 * JavaScript is evaluated. That JavaScript throws while it is being evaluated when its native module
 * is not there, and Metro reports that as fatal, before any `catch` here, whenever it is not inside
 * another module's load: in a service's factory, say. Not on the web, where a package registers its
 * module only once it is evaluated.
 */
function nativeHalfMissing(module: string, platform: ModulePlatform | null): boolean {
  const name = NATIVE_MODULES[module];
  if (!name || platform === null || platform === 'web') return false;
  const core = optional(() => require('expo-modules-core') as typeof import('expo-modules-core'));
  return core !== null && !core.requireOptionalNativeModule(name);
}

/**
 * The Expo module a service needs.
 *
 * Where the module exists for the platform the app is on, a module that is missing is a mistake
 * the developer can fix, so this throws a `MissingModuleError` that says how - rather than leave a
 * feature that silently does nothing. Anywhere it cannot exist - an iOS-only module on Android, the
 * web, and Node, where a test runs with no platform at all - this answers null, and the service
 * goes inert, as code shared across platforms needs it to.
 *
 * `load` answering null or undefined counts as missing too: `requireOptionalNativeModule` answers
 * null rather than throwing. So does a package whose native half is not in the build, which `load`
 * is not called for: see `nativeHalfMissing`.
 */
export function expoModule<T>(
  module: string,
  load: () => T | null | undefined,
  platforms: readonly ModulePlatform[] = ['ios', 'android'],
): T | null {
  const platform = currentPlatform();
  let failure: unknown;
  try {
    const loaded = nativeHalfMissing(module, platform) ? null : load();
    if (loaded != null) return loaded;
  } catch (error) {
    failure = error;
  }
  if (platform === null || !platforms.includes(platform)) return null;
  throw new MissingModuleError(module, platform, failure);
}
