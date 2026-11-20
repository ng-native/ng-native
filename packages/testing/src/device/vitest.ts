/**
 * `deviceTests()`: the Vitest plugin for component tests on a device.
 *
 *     // vitest.device.config.mts
 *     export default defineConfig({ plugins: [deviceTests()] });
 *
 * It sets what a device run needs: the device pool, the test files (`src/**\/*.device.ts` unless
 * told otherwise), one file at a time per device, and a re-run on any change under `src`, since
 * Vitest never imports a device test (Metro does) and so cannot see what one depends on.
 *
 * A project per platform runs every file on each, and `vitest --project ios` runs the one: the
 * project is named for its `platform`, as `name` says. For each the pool starts Metro, and the app:
 * the desktop host on a Mac (`macosLauncher()`), and on iOS and Android the project's development
 * build, built the first time and kept by its native fingerprint, on the simulator or emulator
 * `device` names (`iosSimulatorLauncher()`, `androidEmulatorLauncher()`), with fresh state for each
 * run. `launch: false` leaves the app, and Metro, to be started by hand.
 *
 *     projects: [
 *       { plugins: [ngNative()], test: { name: 'node' } },
 *       { plugins: [deviceTests({ platform: 'macos' })] },
 *     ]
 */
import path from 'node:path';
import type { Plugin } from 'vite';
// Vitest's additions to Vite's plugin type, `configureVitest` among them.
import type {} from 'vitest/config';
import { androidEmulatorLauncher } from './android-launcher.ts';
import { iosSimulatorLauncher } from './ios-launcher.ts';
import type { AppLauncher } from './launcher.ts';
import { macosLauncher } from './macos-launcher.ts';
import { stopMetro } from './metro-server.ts';
import { devicePool, type DevicePoolOptions } from './pool.ts';

export interface DeviceTestsOptions extends Omit<DevicePoolOptions, 'launch'> {
  /**
   * The simulator (`iPhone 17 Pro`) or Android emulator (its AVD name) to run on, booted when it is
   * not. Default: one already running, or else the newest iPhone or the first AVD.
   */
  device?: string;
  /**
   * `false`: each test starts with animations off, the engine's CSS transitions and `@keyframes`
   * as well as native view animations, as `setAnimations(false)` turns them off. Default `true`.
   */
  animations?: boolean;
  /**
   * How the app is started. Default: by the pool, for the `platform`. `false`: by hand, with Metro
   * started by hand too (`EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start`), as for a phone on a cable or
   * Expo Go.
   */
  launch?: AppLauncher | false;
  /** The test files. Default `src/**\/*.device.ts`. */
  include?: string[];
  /** The Vitest project's name, for `--project`. Default: the `platform`, or `device`. */
  name?: string;
  /** The source whose changes re-run the tests in watch mode. Default `src`. */
  sources?: string[];
}

export function deviceTests(options: DeviceTestsOptions = {}): Plugin {
  const {
    include = ['src/**/*.device.ts'],
    sources = ['src'],
    name,
    device,
    launch,
    animations = true,
    ...rest
  } = options;
  const pool: DevicePoolOptions = {
    ...rest,
    launch: launch === false ? undefined : (launch ?? launcherFor(rest.platform, device)),
  };
  return {
    name: 'ng-native:device-tests',
    configureVitest({ vitest }) {
      vitest.onClose(stopMetro);
    },
    config(config) {
      const root = path.resolve(config.root ?? process.cwd());
      return {
        test: {
          name: name ?? pool.platform ?? 'device',
          // A project per platform keeps a snapshot file per platform: a value a Mac draws
          // differs from one an iPhone does.
          ...(pool.platform && {
            resolveSnapshotPath: (testPath: string, extension: string) =>
              path.join(
                path.dirname(testPath),
                '__snapshots__',
                `${path.basename(testPath)}.${pool.platform}${extension}`,
              ),
          }),
          include,
          pool: devicePool(pool),
          maxWorkers: 1,
          // A first render on a simulator just booted, as on CI, can take a few seconds.
          testTimeout: config.test?.testTimeout ?? 30_000,
          isolate: false,
          // Absolute: `**` does not match a directory whose name starts with a dot.
          forceRerunTriggers: sources.map((source) => `${path.resolve(root, source)}/**`),
          // What the app's runner reads for each run: see `configureAnimations`.
          provide: { ngNativeAnimations: animations },
        },
      } as never;
    },
  };
}

/** The launcher a platform's apps start with by default. */
function launcherFor(platform: DevicePoolOptions['platform'], device: string | undefined) {
  if (platform === 'macos') return macosLauncher();
  if (platform === 'ios') return iosSimulatorLauncher({ device });
  if (platform === 'android') return androidEmulatorLauncher({ device });
  return undefined;
}

export { devicePool, type DevicePoolOptions } from './pool.ts';
export type { ScreenshotComparatorOptions, ScreenshotOptions } from './screenshot-baselines.ts';
export { macosLauncher, type MacosLauncherOptions } from './macos-launcher.ts';
export { iosSimulatorLauncher, type IosSimulatorOptions } from './ios-launcher.ts';
export { androidEmulatorLauncher, type AndroidEmulatorOptions } from './android-launcher.ts';
export type { AppLauncher, LaunchRequest, LaunchedApp } from './launcher.ts';
