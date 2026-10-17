/**
 * NativeScript's runtime, installed once and reached through one service.
 *
 * `@nativescript/react-native` puts every iOS SDK symbol and every Android class on the JavaScript
 * runtime over JSI. What an app has to do before it can call one differs by platform: iOS installs
 * through the package's `init()`, which also installs into the Worklets UI runtime; Android has no
 * worklet runtime yet (its `installWorkletRuntime` answers false, so `init()` throws there) and
 * installs through the TurboModule alone. This file is that difference, so a component is not.
 *
 * ```ts
 * bootstrapApplication(App, { providers: [provideNativeScript()] });
 *
 * export class DeviceName {
 *   private readonly native = inject(NativeScript);
 *   protected readonly model = this.native.call({
 *     ios: () => UIDevice.currentDevice.model,
 *     android: () => android.os.Build.MODEL,
 *   });
 * }
 * ```
 */
import {
  ErrorHandler,
  InjectionToken,
  Service,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';

export type NativeScriptPlatform = 'ios' | 'android';

/** What the service needs of NativeScript, on the platform the app is on. */
export interface NativeScriptRuntime {
  readonly platform: NativeScriptPlatform;
  /** Install the native API on the JavaScript runtime, with its classes as globals. Idempotent. */
  install(): void;
  /** Run a worklet on the platform's UI thread. */
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R>;
  /** Load a system framework whose classes the metadata names but the binary does not link. */
  loadFramework(name: string): boolean;
  /**
   * Why there is no runtime on a platform that should have one: a build without it, Expo Go, or
   * on Android a JavaScript reload. Read on each use, as installing can set it.
   */
  readonly missing?: Error;
}

/** The subset of React Native read here, described so `require` has a type. */
interface ReactNative {
  Platform: { OS: string };
  TurboModuleRegistry: { get(name: string): { install(metadataPath: string): boolean } | null };
}

/** The subset of `@nativescript/react-native`'s default export used on iOS. */
interface NativeScriptModule {
  init(metadataPath?: string, options?: { globals?: boolean }): boolean;
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R>;
  loadFramework(name: string): boolean;
}

const MISSING =
  '[angular-native] @nativescript/react-native is not in this build of the app. Install it, add ' +
  '"@ng-native/nativescript" to the plugins in app.json and rebuild ("npx expo run:ios" or ' +
  '"npx expo run:android"). Expo Go cannot load it.';

const RELOADED =
  '[angular-native] NativeScript is not installed in this JavaScript runtime: on Android it ' +
  'installs once per process, and the JavaScript was reloaded since. Restart the app.';

/**
 * The runtime for the platform the app is on, or null where there is none to install: Node, where
 * a test runs, and the web. On a device without the native half, Expo Go among them, it is one
 * that says so as it is used: the rest of the app still runs, and the feature that needs NativeScript
 * fails with what to do about it, as a missing Expo module does.
 *
 * The TurboModule is asked for before the package is required: the package's own entry fetches it
 * with `getEnforcing` as it is evaluated, which Metro reports as fatal before any `catch` here.
 */
export function nativeScriptRuntime(): NativeScriptRuntime | null {
  let rn: ReactNative;
  try {
    rn = require('react-native') as ReactNative;
  } catch {
    return null;
  }
  const platform = rn.Platform.OS;
  if (platform !== 'ios' && platform !== 'android') return null;
  const turbo = rn.TurboModuleRegistry.get('NativeScriptNativeApi');
  if (!turbo) {
    const missing = new Error(MISSING);
    return {
      platform,
      missing,
      install: () => {},
      runOnUI: () => Promise.reject(missing),
      loadFramework: () => true,
    };
  }

  if (platform === 'android') {
    const runtime: NativeScriptRuntime & { missing?: Error } = {
      platform,
      install: () => {
        turbo.install('');
        // The module installs once per process, and answers that it is installed when asked again
        // from the runtime a JavaScript reload makes, which has none of its globals.
        // ponytail: an upstream bug in @nativescript/react-native 9.1's Android module; this only
        // says so. Remove once a reload installs again.
        if (!('java' in globalThis)) runtime.missing = new Error(RELOADED);
      },
      // ponytail: Android has no worklet runtime in @nativescript/react-native 9.1, so this runs on
      // the JavaScript thread. Post to the main looper once the runtime can call back across threads.
      runOnUI: async (worklet, ...args) => {
        if (runtime.missing) throw runtime.missing;
        return worklet(...args);
      },
      // Android loads classes from the APK's classpath; there is nothing to load.
      loadFramework: () => true,
    };
    return runtime;
  }

  const ns = (require('@nativescript/react-native') as { default: NativeScriptModule }).default;
  return {
    platform,
    // Globals on: `UIDevice.currentDevice` rather than `NativeScript.getClass('UIDevice')`. The
    // package defaults them off so UIKit is not touched from the JavaScript thread by accident;
    // `runOnUI` is still the way to touch a view.
    install: () => {
      const zone = 'Zone' in globalThis;
      ns.init('', { globals: true });
      // `installGlobals` makes every enum member a global too, and CloudKit has one named `Zone`.
      // Angular's zoneless scheduler still checks for zone.js with `typeof Zone`, finds this one
      // and calls `Zone.root.run` on it, so it goes.
      // ponytail: the one clash known to break the app; ask upstream not to hoist enum members.
      if (!zone) delete (globalThis as { Zone?: unknown }).Zone;
    },
    runOnUI: (worklet, ...args) =>
      ns.runOnUI(ui.plain, worklet as (...args: unknown[]) => unknown, ...args) as never,
    loadFramework: (name) => ns.loadFramework(name),
  };
}

/** Runs on the UI runtime. One object so neither is a top-level function: see `nsView`. */
const ui = {
  /**
   * The worklet's answer, refused if it is an Objective-C object. One handed to the JavaScript
   * thread becomes a proxy there that NativeScript cannot release when that runtime goes, so the
   * app crashes the next time the JavaScript reloads, by the dev menu or by an update.
   * ponytail: checks the value itself, not what is inside an array or object of it.
   */
  plain(worklet: (...args: unknown[]) => unknown, ...args: unknown[]): unknown {
    'worklet';
    const answer = worklet(...args);
    if (
      answer !== null &&
      typeof answer === 'object' &&
      typeof (answer as { isKindOfClass?: unknown }).isKindOfClass === 'function'
    ) {
      throw new Error(
        `[angular-native] A worklet passed to runOnUI returned a native object (${String(answer)}). ` +
          'Return plain data instead: a native object handed to the JavaScript thread crashes the ' +
          'app when the JavaScript reloads.',
      );
    }
    return answer;
  },
};

/**
 * NativeScript, installed. Injecting it installs the runtime, once for the process; a test that
 * renders a component using it gets a service whose `platform` is null and whose calls answer
 * `undefined`, with no simulator.
 */
@Service()
export class NativeScript {
  /** Overridden in a test to stand in for the native runtime. */
  static readonly RUNTIME = new InjectionToken<NativeScriptRuntime | null>(
    'angular-native.nativeScriptRuntime',
    { factory: nativeScriptRuntime },
  );

  private readonly runtime = inject(NativeScript.RUNTIME);
  private readonly errors = inject(ErrorHandler);

  /** The platform NativeScript is installed on; null in Node and on the web. */
  readonly platform: NativeScriptPlatform | null = this.runtime?.platform ?? null;

  constructor() {
    this.runtime?.install();
  }

  /**
   * Call the function for this platform, synchronously, on the JavaScript thread, and answer what
   * it returns. `undefined` on a platform the object has no function for, and where there is no
   * runtime. Reading a value or calling a non-UI API is fine here on both platforms; a view is
   * touched through `runOnUI`. Throws in a build without NativeScript, rather than leave the
   * function to fail on the first native class it names.
   */
  call<T>(calls: { readonly ios?: () => T; readonly android?: () => T }): T | undefined {
    const call = this.platform && calls[this.platform];
    if (call && this.runtime?.missing) throw this.runtime.missing;
    return call ? call() : undefined;
  }

  /**
   * Run a worklet on the UI thread and answer what it returns. iOS only for now: on Android it runs
   * on the JavaScript thread. A worklet captures what it reads by value, so pass state as
   * arguments rather than reading `this` inside it.
   */
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R | undefined> {
    return this.runtime ? this.runtime.runOnUI(worklet, ...args) : Promise.resolve(undefined);
  }

  /** Load each named system framework (iOS), such as SceneKit. */
  loadFrameworks(names: readonly string[]): void {
    if (this.platform !== 'ios') return;
    for (const name of names) {
      if (!this.runtime!.loadFramework(name)) {
        this.errors.handleError(new Error(`[angular-native] NativeScript could not load ${name}.`));
      }
    }
  }
}

export interface NativeScriptOptions {
  /** System frameworks to load on iOS before anything under these providers runs. */
  readonly frameworks?: readonly string[];
}

/**
 * Install NativeScript as these providers' injector is created: at bootstrap for the app's, or as
 * a route is first entered for a route's, so a feature that needs SceneKit pays for it there.
 */
export function provideNativeScript(options: NativeScriptOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() =>
      inject(NativeScript).loadFrameworks(options.frameworks ?? []),
    ),
  ]);
}
