/**
 * A permission, as signals rather than a hook.
 *
 * Every Expo module that needs one exposes the same shape: `getXPermissionsAsync`,
 * `requestXPermissionsAsync`, and a `useXPermissions()` hook that is those two plus React state.
 * So this is not a facade per module - it is one class that takes the pair, and the module stays
 * the app's own dependency:
 *
 * ```ts
 * import * as Camera from 'expo-camera';
 * import { Permission } from '@ng-native/expo';
 *
 * readonly camera = Permission.of(Camera.Camera.getCameraPermissionsAsync,
 *                                 Camera.Camera.requestCameraPermissionsAsync);
 * ```
 */
import { computed, signal, type Signal } from '@angular/core';

/** What every Expo permission call answers with. */
export interface PermissionResponse {
  readonly status: 'granted' | 'denied' | 'undetermined';
  readonly granted: boolean;
  /** False once the platform will no longer show a dialog: the app must send them to Settings. */
  readonly canAskAgain: boolean;
}

/** The pair of functions a module exposes, which its hook is built out of. */
export interface PermissionApi {
  get(): Promise<PermissionResponse>;
  request(): Promise<PermissionResponse>;
}

/** What a permission is without its module: refused, and never to be asked about again. */
export const UNAVAILABLE: PermissionResponse = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
};

export class Permission {
  private readonly api: PermissionApi;
  private readonly last = signal<PermissionResponse | null>(null);

  constructor(api: PermissionApi) {
    this.api = api;
  }

  /** `unknown` until something has asked the platform, which is not the same as `undetermined`. */
  readonly status: Signal<PermissionResponse['status'] | 'unknown'> = computed(
    () => this.last()?.status ?? 'unknown',
  );

  readonly granted: Signal<boolean> = computed(() => this.last()?.granted ?? false);

  /** Refused, and the platform will not show a dialog again. Send them to Settings. */
  readonly blocked: Signal<boolean> = computed(() => {
    const response = this.last();
    return response !== null && !response.granted && !response.canAskAgain;
  });

  /** From a module's own two functions, which is how every one of them spells this. */
  static of(
    get: () => Promise<PermissionResponse>,
    request: () => Promise<PermissionResponse>,
  ): Permission {
    return new Permission({ get, request });
  }

  /** Ask the platform what it currently thinks, without showing anything to the user. */
  async check(): Promise<boolean> {
    return this.record(await this.api.get());
  }

  /** Show the dialog. Resolves to what the user said. */
  async request(): Promise<boolean> {
    return this.record(await this.api.request());
  }

  /**
   * Have the permission if it can be had, asking only if asking would do something.
   *
   * The method most call sites want. A permission already granted needs no dialog, and one the
   * platform has stopped asking about would return the same no while looking like the user had
   * been consulted.
   */
  async ensure(): Promise<boolean> {
    if (this.last() === null) await this.check();

    const current = this.last();
    if (current?.granted) return true;
    // Refused for good. Requesting again resolves to the same no without the platform showing
    // anything, which reads at the call site as though the user had been asked twice.
    if (current && !current.canAskAgain) return false;
    return this.request();
  }

  private record(response: PermissionResponse): boolean {
    this.last.set(response);
    return response.granted;
  }
}
