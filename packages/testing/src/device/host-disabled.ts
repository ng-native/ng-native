/**
 * What `@ng-native/testing/device/host` resolves to when Metro was not started for device tests:
 * a development bundle requires the host behind a check that is false there, and Metro still
 * bundles what a dead branch requires in development. This keeps the host, and Vitest, out of it.
 */
export function startDeviceTests(): never {
  throw new Error(
    'The device test host is not in this bundle: start Metro with EXPO_PUBLIC_DEVICE_TESTS set.',
  );
}
