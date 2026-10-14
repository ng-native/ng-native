/**
 * `Network`, bound to `expo-network`.
 *
 * Whether the app can reach anything, which is not the same as whether it has a connection. A
 * phone on a captive-portal wifi is connected and reachable by nothing; a phone in a lift has a
 * connection type and no signal. `reachable` is the one worth branching on, and it is the one the
 * platform is least sure about - it stays `null` until something has actually been reached.
 */
import { InjectionToken, Service, computed, inject, type Signal } from '@angular/core';
import { observed, observedFrom, type Observed } from './observed.ts';
import { expoModule, present } from './native.ts';

export type ConnectionType =
  'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'vpn' | 'other' | 'none' | 'unknown';

export interface NetworkStatus {
  readonly connected: boolean;
  readonly type: ConnectionType;
  /** Null while the platform has not established it, which is not the same as false. */
  readonly reachable: boolean | null;
}

export const OFFLINE: NetworkStatus = { connected: false, type: 'unknown', reachable: null };

const TYPES: Record<string, ConnectionType> = {
  NONE: 'none',
  UNKNOWN: 'unknown',
  WIFI: 'wifi',
  CELLULAR: 'cellular',
  BLUETOOTH: 'bluetooth',
  ETHERNET: 'ethernet',
  VPN: 'vpn',
  OTHER: 'other',
};

@Service()
export class Network {
  /** Overridden in a test to go offline without a network. */
  static readonly SOURCE = new InjectionToken<Observed<NetworkStatus> | null>(
    'angular-native.networkSource',
    {
      factory: () => {
        const expo = expoModule(
          'expo-network',
          () => require('expo-network') as typeof import('expo-network'),
        );
        if (!expo) return null;
        // Missing from the build: the stand-in, to say so when it is used.
        if (!present(expo)) return expo as never;

        const read = (
          state: import('expo-network').NetworkState | import('expo-network').NetworkStateEvent,
        ): NetworkStatus => ({
          connected: state.isConnected ?? false,
          type: TYPES[state.type ?? 'UNKNOWN'] ?? 'unknown',
          // `undefined` means the platform has not established it; `null` is how that is said here,
          // so a consumer cannot confuse "not yet" with "no".
          reachable: state.isInternetReachable ?? null,
        });

        return observedFrom(
          async () => read(await expo.getNetworkStateAsync()),
          (listener) => expo.addNetworkStateListener((event) => listener(read(event))),
        );
      },
    },
  );

  readonly status: Signal<NetworkStatus> = observed(inject(Network.SOURCE), OFFLINE);

  /** Whether there is a connection of any kind. Say what you mean: this is not reachability. */
  readonly connected: Signal<boolean> = computed(() => this.status().connected);

  /** What the connection is over, for a screen that offers to wait for wifi. */
  readonly type: Signal<ConnectionType> = computed(() => this.status().type);

  /**
   * Whether anything has actually been reached. Null until the platform knows, so a screen that
   * shows an offline banner should treat null as "not yet" rather than as offline.
   */
  readonly reachable: Signal<boolean | null> = computed(() => this.status().reachable);
}
