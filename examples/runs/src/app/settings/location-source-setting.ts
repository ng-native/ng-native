import { Service, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';

declare const __DEV__: boolean | undefined;

/**
 * Whether a run uses the simulated route instead of the device's GPS.
 *
 * Defaults on everywhere except a release build: a development build or the simulator has no
 * GPS worth trusting, and the app's own tests have no GPS at all, so the simulated route is what
 * makes the app - and its screenshots - move without a real run. `Settings` lets a person flip it
 * either way, and the choice is remembered.
 */
@Service()
export class LocationSourceSetting {
  private readonly store = inject(Storage);

  readonly simulate = this.store.signal('runs.simulateLocation', defaultsToSimulated());
}

function defaultsToSimulated(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__;
}
