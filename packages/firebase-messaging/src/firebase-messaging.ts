/**
 * `FirebaseMessaging`: the app's Firebase Installation ID (FID), registered with FCM, for a backend
 * that sends through FCM's HTTP v1 API to the message's `fid` target.
 *
 * ```ts
 * import { FirebaseMessaging } from '@ng-native/firebase-messaging';
 *
 * private readonly messaging = inject(FirebaseMessaging);
 *
 * constructor() {
 *   effect(() => {
 *     const fid = this.messaging.installationId();
 *     if (fid) void this.api.savePushTarget(fid);
 *   });
 * }
 *
 * enablePush(): Promise<string | null> {
 *   return this.messaging.register();
 * }
 * ```
 *
 * FCM rejects a send to an FID with `UNREGISTERED` until `register()` has run. On iOS FCM delivers
 * over APNs, so registering takes the APNs token `Notifications` reports; on Android it needs no
 * token. Either way it asks for the notification permission first. When the platform rolls the
 * push token, the installation is registered again, and `installationId` is set again. Firebase
 * can also replace the FID by itself, so each time the app comes back to the front the FID is read
 * again, and `installationId` follows it.
 *
 * `unregister()` deletes the installation, so FCM answers `UNREGISTERED` for its FID, for an app
 * whose pushes belong to the signed-in user to call on sign-out. It stops both until `register()`
 * runs again, which registers a new FID.
 *
 * Without the native module (Expo Go, the web host, a test that provides nothing) every call
 * answers null.
 */
import {
  DestroyRef,
  ErrorHandler,
  InjectionToken,
  Service,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { OS } from '@ng-native/device';
import { Permission } from '@ng-native/expo';
import { Notifications } from '@ng-native/expo/notifications';

/** The native module's functions. A test provides a fake. */
export interface NativeFirebaseMessaging {
  getInstallationId(): Promise<string>;
  /** Registers the installation with FCM. iOS needs the APNs token as hex; Android ignores it. */
  register(apnsToken: string | null): Promise<void>;
  /** Deletes the installation, and with it the FID's registration. */
  unregister(): Promise<void>;
}

@Service()
export class FirebaseMessaging {
  /** Null in a build without the package's native half. */
  static readonly SOURCE = new InjectionToken<NativeFirebaseMessaging | null>(
    'angular-native.firebaseMessagingSource',
    {
      factory: () =>
        (
          globalThis as {
            expo?: { modules?: { NgNativeFirebaseMessaging?: NativeFirebaseMessaging } };
          }
        ).expo?.modules?.NgNativeFirebaseMessaging ?? null,
    },
  );

  private readonly native = inject(FirebaseMessaging.SOURCE);
  private readonly notifications = inject(Notifications);
  private readonly errors = inject(ErrorHandler);
  private readonly os = inject(OS);
  private readonly id = signal<string | null>(null);
  private readonly registered = signal(false);
  /** Counts FID reads, so one that settles after a newer one does not overwrite it. */
  private reads = 0;
  /** Counts unregisters, so a registration in flight across one does not undo it. */
  private unregisters = 0;
  /** Native registrations and deletions, run one at a time in call order. */
  private queue: Promise<unknown> = Promise.resolve();

  /** The FID, each time a registration answers; null until one has. For the app's backend. */
  readonly installationId: Signal<string | null> = this.id.asReadonly();

  constructor() {
    // A rolled APNs token is one FCM does not have, and pushes stop arriving until it does. A
    // registration that fails goes to the ErrorHandler, since nothing awaits it. Nothing touches
    // Notifications until a registration, so a test's partial fake of it constructs this.
    effect(() => {
      if (!this.registered()) return;
      const token = this.notifications.devicePushToken();
      if (!token) return;
      this.registerWith(this.os === 'ios' ? token.data : null).catch((failure: unknown) =>
        this.errors.handleError(failure),
      );
    });
    const stop = inject(Permission.FOREGROUND)?.(() => this.readAgain());
    if (stop) inject(DestroyRef).onDestroy(stop);
  }

  /**
   * Registers this installation with FCM and answers its FID. Null without the notification
   * permission or the native module.
   */
  async register(): Promise<string | null> {
    if (!this.native) return null;
    const unregisters = this.unregisters;
    // Android needs no token, and asking for one would fetch FCM's deprecated registration token.
    if (this.os !== 'ios') {
      return (await this.notifications.permission.ensure())
        ? this.registerWith(null, unregisters)
        : null;
    }
    const token = await this.notifications.getDevicePushToken();
    return token ? this.registerWith(token.data, unregisters) : null;
  }

  /**
   * Deletes this installation, so FCM answers `UNREGISTERED` for its FID, and clears
   * `installationId`. Nothing registers again until `register()` does, with a new FID.
   */
  async unregister(): Promise<void> {
    this.registered.set(false);
    this.unregisters++;
    // A read still in flight answers the deleted FID.
    this.reads++;
    this.id.set(null);
    const native = this.native;
    if (native) await this.inTurn(() => native.unregister());
  }

  /** The FID, without registering it. Null without the native module. */
  async getInstallationId(): Promise<string | null> {
    return (await this.native?.getInstallationId()) ?? null;
  }

  /** Firebase replaces an FID it can no longer use without saying so to JavaScript. */
  private readAgain(): void {
    const native = this.native;
    if (!native || !this.registered()) return;
    this.read(native).catch((failure: unknown) => this.errors.handleError(failure));
  }

  /** Answers null, and registers nothing more, once an unregister has run since `unregisters`. */
  private async registerWith(
    apnsToken: string | null,
    unregisters = this.unregisters,
  ): Promise<string | null> {
    const native = this.native;
    if (!native || unregisters !== this.unregisters) return null;
    await this.inTurn(() => native.register(apnsToken));
    if (unregisters !== this.unregisters) return null;
    this.registered.set(true);
    const id = await this.read(native);
    return unregisters === this.unregisters ? id : null;
  }

  private inTurn<T>(call: () => Promise<T>): Promise<T> {
    const run = this.queue.then(call);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(native: NativeFirebaseMessaging): Promise<string> {
    const read = ++this.reads;
    const id = await native.getInstallationId();
    if (read === this.reads) this.id.set(id);
    return id;
  }
}
