/**
 * `Updates`, bound to `expo-updates`.
 *
 * ```ts
 * private readonly updates = inject(Updates);
 *
 * // On foreground, where a restart costs the user nothing.
 * async refresh() {
 *   if (await this.updates.check()) await this.updates.apply();
 * }
 * ```
 *
 * The awkward part is not checking or downloading - both are plain promises - it is that applying
 * one *restarts the app*. So the shape that matters is: know one is ready, and let the app choose
 * a moment the user will not lose anything at. Nothing here does it on its own.
 *
 * Beside the bundle updates, a whole-app updater: Sparkle in a macOS `dmg` build, where
 * `checkForAppUpdate()` shows Sparkle's check and `appUpdateAvailable` follows what it has found.
 * Elsewhere both are inert: in development, in `app` and `mas` builds, and on iOS, Android and the
 * web for now.
 */
import { InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import { expoModule, presence, present } from './native.ts';

export interface NativeUpdates {
  readonly enabled: boolean;
  check(): Promise<{ isAvailable: boolean }>;
  fetch(): Promise<{ isNew: boolean }>;
  reload(): Promise<void>;
  /** The whole-app updater, where the build has one: Sparkle in a macOS `dmg` build. */
  readonly appUpdater?: NativeAppUpdater | null;
}

export interface NativeAppUpdater {
  /** Whether it has found a newer version of the app, now. */
  available(): boolean;
  /** Show its check, as Check for Updates... does. Resolves whether there was an updater to ask. */
  check(): Promise<boolean>;
  subscribe(listener: (available: boolean) => void): () => void;
}

/** The desktop host's `NgNativeUpdates`, as far as the whole-app updater goes. */
interface DesktopAppUpdater {
  readonly isAppUpdaterAvailable?: boolean;
  isAppUpdateAvailable?(): boolean;
  checkForAppUpdateAsync?(): Promise<boolean>;
}

/**
 * The host's updater, from the module's `isAppUpdaterAvailable` property, with its
 * `appUpdateAvailable` event on `DeviceEventEmitter`.
 */
function appUpdaterOf(module: DesktopAppUpdater): NativeAppUpdater | null {
  if (module.isAppUpdaterAvailable !== true) return null;
  const emitter = (
    require('react-native') as {
      DeviceEventEmitter?: {
        addListener(event: string, listener: (event: unknown) => void): { remove(): void };
      };
    }
  ).DeviceEventEmitter;
  return {
    available: () => module.isAppUpdateAvailable?.() === true,
    check: async () => (await module.checkForAppUpdateAsync?.()) === true,
    subscribe: (listener) => {
      const subscription = emitter?.addListener('appUpdateAvailable', (event) =>
        listener((event as { available?: boolean } | null)?.available === true),
      );
      return () => subscription?.remove();
    },
  };
}

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

@Service()
export class Updates {
  /** Overridden in a test to offer an update without a server. */
  static readonly SOURCE = new InjectionToken<NativeUpdates | null>(
    'angular-native.updatesSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-updates',
          () => require('expo-updates') as typeof import('expo-updates'),
        );
        if (!expo) return null;
        // Missing from the build: the stand-in, to say so when it is used.
        if (!present(expo)) return expo as never;
        return {
          // False in development and in Expo Go, where the bundle comes from Metro. A banner shown
          // there is one that can never resolve.
          enabled: expo.isEnabled,
          check: async () => ({ isAvailable: (await expo.checkForUpdateAsync()).isAvailable }),
          fetch: async () => ({ isNew: (await expo.fetchUpdateAsync()).isNew }),
          reload: () => expo.reloadAsync(),
          appUpdater: appUpdaterOf(expo as DesktopAppUpdater),
        };
      },
    },
  );

  private readonly native = inject(Updates.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);
  private readonly current = signal<UpdateState>('idle');
  private readonly failure = signal<unknown>(null);
  private readonly downloaded = signal(false);

  readonly state: Signal<UpdateState> = this.current.asReadonly();
  readonly error: Signal<unknown> = this.failure.asReadonly();

  /**
   * Downloaded and waiting, including while a later check runs and after one fails. The only time
   * `apply()` does anything.
   */
  readonly ready: Signal<boolean> = this.downloaded.asReadonly();

  // Read only from a module that is there: the stand-in for a missing one throws on any read.
  private readonly appUpdater = present(this.native)?.appUpdater ?? null;
  private readonly appUpdate = signal(this.appUpdater?.available() ?? false);
  private readonly stopAppUpdates =
    this.appUpdater?.subscribe((available) => this.appUpdate.set(available)) ?? null;

  /**
   * Whether the whole-app updater has found a newer version of the app: Sparkle in a macOS `dmg`
   * build. False wherever there is none.
   */
  readonly appUpdateAvailable: Signal<boolean> = this.appUpdate.asReadonly();

  /**
   * Disabled in development and in Expo Go, where the bundle comes from Metro. An app that shows
   * an "update available" banner should hide it here rather than show one that can never resolve.
   */
  get enabled(): boolean {
    return this.native?.enabled ?? false;
  }

  /**
   * Check, and download if there is one. Resolves to whether an update is now waiting.
   *
   * One method rather than two because there is nothing useful to do between them: an app that
   * checks and does not download has learnt something it cannot act on.
   */
  async check(): Promise<boolean> {
    if (!this.native?.enabled) return false;

    try {
      this.current.set('checking');
      const { isAvailable } = await this.native.check();
      if (isAvailable) {
        this.current.set('downloading');
        const { isNew } = await this.native.fetch();
        if (isNew) this.downloaded.set(true);
      }
      this.failure.set(null);
      this.current.set(this.downloaded() ? 'ready' : 'idle');
    } catch (error) {
      this.failure.set(error);
      this.current.set(this.downloaded() ? 'ready' : 'error');
    }
    return this.downloaded();
  }

  /**
   * Restart into the downloaded update.
   *
   * **This restarts the app**, which is why it is never automatic: the moment to do it is one the
   * app knows and this does not - not mid-form, not mid-upload, usually on next foreground.
   */
  async apply(): Promise<void> {
    if (this.downloaded()) await this.native?.reload();
  }

  /**
   * Check for a newer version of the whole app, showing the updater's own window as Check for
   * Updates... does: Sparkle in a macOS `dmg` build. Resolves whether there was an updater to ask;
   * false, and nothing shown, wherever there is none.
   */
  async checkForAppUpdate(): Promise<boolean> {
    return (await this.appUpdater?.check()) ?? false;
  }

  ngOnDestroy(): void {
    this.stopAppUpdates?.();
  }
}
