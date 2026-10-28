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
 * push token, the installation is registered again, and `installationId` is set again.
 *
 * Without the native module (Expo Go, the web host, a test that provides nothing) every call
 * answers null.
 */
import {
  ErrorHandler,
  InjectionToken,
  Service,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { OS } from '@ng-native/device';
import { Notifications } from '@ng-native/expo/notifications';

/** The native module's functions. A test provides a fake. */
export interface NativeFirebaseMessaging {
  getInstallationId(): Promise<string>;
  /** Registers the installation with FCM. iOS needs the APNs token as hex; Android ignores it. */
  register(apnsToken: string | null): Promise<void>;
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
  private registered = false;

  /** The FID, each time a registration answers; null until one has. For the app's backend. */
  readonly installationId: Signal<string | null> = this.id.asReadonly();

  constructor() {
    // A rolled APNs token is one FCM does not have, and pushes stop arriving until it does. A
    // registration that fails goes to the ErrorHandler, since nothing awaits it.
    effect(() => {
      const token = this.notifications.devicePushToken();
      if (!token || !this.registered) return;
      this.registerWith(this.os === 'ios' ? token.data : null).catch((failure: unknown) =>
        this.errors.handleError(failure),
      );
    });
  }

  /**
   * Registers this installation with FCM and answers its FID. Null without the notification
   * permission or the native module.
   */
  async register(): Promise<string | null> {
    if (!this.native) return null;
    // Android needs no token, and asking for one would fetch FCM's deprecated registration token.
    if (this.os !== 'ios') {
      return (await this.notifications.permission.ensure()) ? this.registerWith(null) : null;
    }
    const token = await this.notifications.getDevicePushToken();
    return token ? this.registerWith(token.data) : null;
  }

  /** The FID, without registering it. Null without the native module. */
  async getInstallationId(): Promise<string | null> {
    return (await this.native?.getInstallationId()) ?? null;
  }

  private async registerWith(apnsToken: string | null): Promise<string | null> {
    const native = this.native;
    if (!native) return null;
    await native.register(apnsToken);
    this.registered = true;
    const id = await native.getInstallationId();
    this.id.set(id);
    return id;
  }
}
