/**
 * NativeScript's runtime, installed once and reached through one service.
 *
 * `@nativescript/react-native` puts every iOS SDK symbol and every Android class on the JavaScript
 * runtime over JSI. The service installs it, picks the function for the platform the app is on, and
 * says what is wrong in a build without it, so a component does none of that.
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
  /** Install the native API on the JavaScript runtime, with iOS's classes as globals. Idempotent. */
  install(): void;
  /** Run a worklet on the platform's main thread. */
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R>;
  /** Load a system framework whose classes the metadata names but the binary does not link. */
  loadFramework(name: string): boolean;
  /**
   * The handle `NativeScriptUIView` shows a view by: a UIView's pointer on iOS, a registry name on
   * Android. A worklet, so the main thread can be handed it. Throws for a value that is not a view.
   */
  nativeViewHandle(view: unknown): string;
  /** Why there is no runtime on a platform that should have one: a build without it, or Expo Go. */
  readonly missing?: Error;
}

/** The subset of `@nativescript/react-native`'s default export used here. */
interface NativeScriptModule {
  isAvailable(): boolean;
  init(metadataPath?: string, options?: { globals?: boolean }): boolean;
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R>;
  loadFramework(name: string): boolean;
  nativeViewHandle(view: unknown): string;
  androidContext(): unknown;
}

/** NativeScript's `androidContext`, once a runtime is made: see `androidContext` below. */
let contextOf: (() => unknown) | null = null;

/**
 * The Context to build an Android view with, the current Activity, as `new
 * android.widget.TextView(androidContext())` needs. `null` on iOS, in Node, and before NativeScript
 * is installed. A function of this package's, so a component file can name it without importing
 * `@nativescript/react-native`, which Node cannot load.
 */
export function androidContext(): unknown {
  return contextOf?.() ?? null;
}

const MISSING =
  '[angular-native] @nativescript/react-native is not in this build of the app. Install it, add ' +
  '"@ng-native/nativescript" to the plugins in app.json and rebuild ("npx expo run:ios" or ' +
  '"npx expo run:android"). Expo Go cannot load it.';

/**
 * The runtime for the platform the app is on, or null where there is none to install: Node, where
 * a test runs, and the web. On a device without the native half, Expo Go among them, it is one
 * that says so as it is used: the rest of the app still runs, and the feature that needs NativeScript
 * fails with what to do about it, as a missing Expo module does.
 */
export function nativeScriptRuntime(): NativeScriptRuntime | null {
  let platform: string;
  try {
    platform = (require('react-native') as { Platform: { OS: string } }).Platform.OS;
  } catch {
    return null;
  }
  if (platform !== 'ios' && platform !== 'android') return null;
  const ns = (require('@nativescript/react-native') as { default: NativeScriptModule }).default;
  if (!ns.isAvailable()) {
    const missing = new Error(MISSING);
    return {
      platform,
      missing,
      install: () => {},
      runOnUI: () => Promise.reject(missing),
      loadFramework: () => true,
      nativeViewHandle: () => {
        throw missing;
      },
    };
  }
  contextOf = platform === 'android' ? ns.androidContext : null;
  return {
    platform,
    // Globals on iOS: `UIDevice.currentDevice` rather than `NativeScript.getClass('UIDevice')`. The
    // package defaults them off so UIKit is not touched from the JavaScript thread by accident;
    // `runOnUI` is still the way to touch a view. Android's packages are globals either way.
    install: () => void ns.init('', { globals: platform === 'ios' }),
    runOnUI: (worklet, ...args) => ns.runOnUI(worklet, ...args),
    // Android loads classes from the APK's classpath; there is nothing to load.
    loadFramework: (name) => platform !== 'ios' || ns.loadFramework(name),
    nativeViewHandle: ns.nativeViewHandle,
  };
}

/** Where there is no runtime. A worklet, as the runtime's own is; an object, as `nsView` explains. */
const noRuntime = {
  nativeViewHandle(view: unknown): string {
    'worklet';
    throw new Error(`[angular-native] No NativeScript runtime to take ${String(view)}'s handle.`);
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
   * Run a worklet on the platform's main thread, where views can be touched, and answer what it
   * returns. On iOS it runs on the Worklets UI runtime and captures what it reads by value; on
   * Android it borrows this runtime while the JavaScript thread waits. Either way pass state as
   * arguments rather than reading `this` inside it.
   */
  runOnUI<A extends unknown[], R>(worklet: (...args: A) => R, ...args: A): Promise<R | undefined> {
    return this.runtime ? this.runtime.runOnUI(worklet, ...args) : Promise.resolve(undefined);
  }

  /** The handle `<ns-view>` binds for a view; see `NativeScriptRuntime.nativeViewHandle`. */
  readonly nativeViewHandle: (view: unknown) => string =
    this.runtime?.nativeViewHandle ?? noRuntime.nativeViewHandle;

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
