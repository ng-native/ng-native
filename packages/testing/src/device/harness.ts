/**
 * What the test host shares with the tests it runs: the mounted host app, the slot components
 * render into, and the recorder of what the app committed. Set once by the host; a test file
 * Metro loads into the running app reaches the same module, so the same harness.
 */
import type { ViewContainerRef } from '@angular/core';
import type { MountResult } from '@ng-native/platform';
import type { record } from './recorder.ts';

export interface Harness {
  app: MountResult;
  slot(): ViewContainerRef;
  recorder: ReturnType<typeof record>;
}

let current: Harness | null = null;

export function setHarness(harness: Harness): void {
  current = harness;
}

export function harness(): Harness {
  if (!current) {
    throw new Error(
      'No device test host is running: these helpers work in a test run on a device, ' +
        'started by startDeviceTests() from @ng-native/testing/device/host.',
    );
  }
  return current;
}
