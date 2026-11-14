/**
 * The Metro half of device component tests: inert unless Metro is started with
 * `EXPO_PUBLIC_DEVICE_TESTS` set, beyond keeping the test host out of the bundle. See metro.cjs.
 */
export function withDeviceTests<Config extends { projectRoot: string }>(config: Config): Config;
