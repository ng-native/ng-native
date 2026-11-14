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
 * A project per platform runs every file on each, and `vitest --project macos` runs the one:
 * the project is named for its `platform`, as `name` says, and for `macos` the pool starts the
 * desktop host itself (`macosLauncher()`), with fresh state for each run.
 *
 *     projects: [
 *       { plugins: [ngNative()], test: { name: 'node' } },
 *       { plugins: [deviceTests({ platform: 'macos' })] },
 *     ]
 */
import path from 'node:path';
import type { Plugin } from 'vite';
import { macosLauncher } from './macos-launcher.ts';
import { devicePool, type DevicePoolOptions } from './pool.ts';

export interface DeviceTestsOptions extends DevicePoolOptions {
  /** The test files. Default `src/**\/*.device.ts`. */
  include?: string[];
  /** The Vitest project's name, for `--project`. Default: the `platform`, or `device`. */
  name?: string;
  /** The source whose changes re-run the tests in watch mode. Default `src`. */
  sources?: string[];
}

export function deviceTests(options: DeviceTestsOptions = {}): Plugin {
  const { include = ['src/**/*.device.ts'], sources = ['src'], name, ...pool } = options;
  // A Mac app is a process the pool can open; a simulator is one a person has open.
  if (pool.platform === 'macos' && pool.launch === undefined) pool.launch = macosLauncher();
  return {
    name: 'ng-native:device-tests',
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
          isolate: false,
          // Absolute: `**` does not match a directory whose name starts with a dot.
          forceRerunTriggers: sources.map((source) => `${path.resolve(root, source)}/**`),
        },
      } as never;
    },
  };
}

export { devicePool, type DevicePoolOptions } from './pool.ts';
export { macosLauncher, type MacosLauncherOptions } from './macos-launcher.ts';
export type { AppLauncher, LaunchRequest, LaunchedApp } from './launcher.ts';
