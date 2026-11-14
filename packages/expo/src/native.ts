import { computed, signal, untracked, type Signal } from '@angular/core';

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

/** The platforms an Expo module is written for, and the desktop OSes a desktop host serves. */
export type ModulePlatform = 'ios' | 'android' | 'macos' | 'web';

/** Whether `platform` is one of Apple's OSes, which share most of what iOS's native modules do. */
export const isApple = (platform: ModulePlatform | null): boolean =>
  platform === 'ios' || platform === 'macos';

/** The OSes whose modules are the desktop host's TurboModules, never an Expo module. */
const DESKTOP_PLATFORMS: ReadonlySet<ModulePlatform> = new Set(['macos']);

/**
 * Where a module exists, as `expoModule` takes it: the platforms its Expo module is written for,
 * as a list, or that and the name of the desktop host's TurboModule that implements the same slice
 * on a desktop OS.
 */
export type ModuleOptions =
  | readonly ModulePlatform[]
  | {
      /** The platforms the Expo module is written for. iOS and Android when left out. */
      readonly platforms?: readonly ModulePlatform[];
      /**
       * The desktop host's TurboModule that stands in for the Expo module on a desktop OS:
       * `'NgNativeHaptics'`. Or, for a package that is not emptied on a desktop OS because the
       * desktop host registers the native module its JavaScript uses, the loader to call there.
       * Naming either counts the desktop OSes among the module's platforms, so a desktop host
       * without it throws a `MissingModuleError` rather than going inert.
       */
      readonly desktop?: string | (() => unknown);
    };

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
          : DESKTOP_PLATFORMS.has(platform)
            ? `${module} has no module in this build of the desktop host. Rebuild it with "npm run macos": ` +
              `the desktop host contains only the native modules it was built with.`
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
  'expo-calendar': 'CalendarNext',
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
 * the developer can fix, so using what this answers throws a `MissingModuleError` that says how -
 * rather than leave a feature that silently does nothing. Using it, not asking for it: see
 * `missing`. Anywhere it cannot exist - an iOS-only module on Android, the
 * web, and Node, where a test runs with no platform at all - this answers null, and the service
 * goes inert, as code shared across platforms needs it to.
 *
 * `load` answering null or undefined counts as missing too: `requireOptionalNativeModule` answers
 * null rather than throwing. So does a package whose native half is not in the build, which `load`
 * is not called for: see `nativeHalfMissing`.
 *
 * On a desktop OS `load` is never called, because every `expo-*` package is an empty module there.
 * The module is the desktop host's TurboModule `options.desktop` names, which implements the same
 * slice, or what its desktop loader answers, and where it gives neither the service is inert.
 */
export function expoModule<T>(
  module: string,
  load: () => T | null | undefined,
  options: ModuleOptions = {},
): T | null {
  const platform = currentPlatform();
  const { platforms = ['ios', 'android'], desktop } = Array.isArray(options)
    ? { platforms: options as readonly ModulePlatform[] }
    : (options as Exclude<ModuleOptions, readonly ModulePlatform[]>);
  if (platform !== null && DESKTOP_PLATFORMS.has(platform)) {
    return desktopModule<T>(module, platform, desktop);
  }
  let failure: unknown;
  try {
    const loaded = nativeHalfMissing(module, platform) ? null : load();
    if (loaded != null) return loaded;
  } catch (error) {
    failure = error;
  }
  if (platform === null || !platforms.includes(platform)) return null;
  return missing(new MissingModuleError(module, platform, failure));
}

/**
 * The desktop host's TurboModule named `desktop`, on a desktop OS, where every `expo-*` package is
 * an empty module and an Expo loader is never called. Null when the call names none, so the
 * service is inert; the stand-in that says to rebuild the desktop host when it names one the
 * desktop host does not have.
 */
function desktopModule<T>(
  module: string,
  platform: ModulePlatform,
  desktop?: string | (() => unknown),
): T | null {
  if (!desktop) return null;
  let failure: unknown;
  try {
    const found = typeof desktop === 'function' ? desktop() : turboModule(desktop);
    if (found != null) return found as T;
  } catch (error) {
    failure = error;
  }
  return missing(new MissingModuleError(module, platform, failure));
}

/** The TurboModule registered as `name`, or null. */
function turboModule(name: string): unknown {
  const registry = (require('react-native') as typeof import('react-native'))
    .TurboModuleRegistry as { get(name: string): unknown };
  return registry.get(name);
}

/** What Angular asks of any injected value, and `await` of any value: never the module's. */
const ASKED_OF_ANY = new Set(['then', 'ngOnDestroy', 'name']);

/**
 * A module that is not there, which throws `error` when it is used rather than when it is asked
 * for. Thrown from a token's factory or a service's constructor, the error would be the one the
 * first injection sees: Angular leaves the token marked as being made, and every injection after
 * it fails with NG0200, "Circular dependency", which names nothing to install.
 *
 * Not thenable, and quiet to a symbol, so awaiting it or logging it does not throw, nor Angular
 * asking an injected value whether it has an `ngOnDestroy` or is its own not-found marker, by
 * `name`.
 */
function missing<T>(error: MissingModuleError): T {
  const fail = (): never => {
    throw error;
  };
  // A function, so calling it, or a member read off it, is a use that says so too.
  const standIn = new Proxy(function standIn() {}, {
    get: (_, key) => (typeof key === 'symbol' || ASKED_OF_ANY.has(key) ? undefined : fail()),
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
    ownKeys: fail,
    deleteProperty: fail,
    defineProperty: fail,
    getOwnPropertyDescriptor: fail,
  });
  missingErrors.set(standIn, error);
  return standIn as T;
}

/** The error each stand-in for a missing module throws when it is used. */
const missingErrors = new WeakMap<object, MissingModuleError>();

/** Whether `value` is the stand-in for a module missing from the build. */
const isMissing = (value: unknown): boolean =>
  typeof value === 'function' && missingErrors.has(value);

/**
 * The module, or null where it is missing from the build: for what a service does as it is made,
 * a listener or a first read, which is skipped then rather than thrown, so the service is made and
 * what the app calls on it is what says the module is missing. See `missing`. A factory that
 * builds over the module hands the stand-in on where it is missing (`if (!present(expo)) return
 * expo as never`), for the same reason.
 */
export function present<T>(value: T | null | undefined): T | null {
  return value == null || isMissing(value) ? null : value;
}

/**
 * Whether a service's module is here, as its `available` signal: false where it is null, and where
 * it is missing from the build. Fixed for the life of the app, since a build's modules do not change.
 */
export function presence(native: unknown): Signal<boolean> {
  return signal(present(native) !== null).asReadonly();
}

/**
 * The answer to an asynchronous question, as a signal: false until it is answered, and false when
 * asking fails. The question is first asked when the answer is first read, so a service nobody asks
 * calls nothing native, and again each time the returned `ask` is called after that.
 */
export function asked(question: () => Promise<boolean> | null | undefined): {
  readonly answer: Signal<boolean>;
  ask(): void;
} {
  const answer = signal(false);
  let started = false;
  const send = () => {
    let pending: Promise<boolean> | null | undefined;
    try {
      pending = question();
    } catch {
      pending = null;
    }
    void Promise.resolve(pending ?? false).then(
      (yes) => answer.set(yes === true),
      () => answer.set(false),
    );
  };
  const read = computed(() => {
    if (!started) {
      started = true;
      untracked(send);
    }
    return answer();
  });
  return {
    answer: read,
    ask: () => {
      if (started) send();
    },
  };
}

/**
 * As `expoModule`, throwing at once where the module is missing: for a function an app calls
 * itself, a player, a database or the splash screen, where no token is left marked and a failure
 * after the call would be caught and lost.
 */
export function expoModuleNow<T>(
  module: string,
  load: () => T | null | undefined,
  options?: ModuleOptions,
): T | null {
  const found = expoModule(module, load, options);
  const error = found && missingErrors.get(found as object);
  if (error) throw error;
  return found;
}
