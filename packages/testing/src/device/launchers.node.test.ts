/**
 * Stopping a run while a launcher is still starting the app: each startup command it runs stops
 * with the run, so a stop never waits on a stalled `adb` or `simctl`. The tools are stand-ins
 * that hang on the step under test; the build is one already kept, so the launch reaches it.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { androidEmulatorLauncher } from './android-launcher.ts';
import { iosSimulatorLauncher } from './ios-launcher.ts';
import type { AppLauncher } from './launcher.ts';

const ABI = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';

/** A shell script at `file` that does what `body` says. */
function script(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/** A project with `expo`'s fingerprint stood in for, and a build kept under it for each OS. */
function project(root: string): string {
  const dir = path.join(root, 'app');
  mkdirSync(path.join(dir, 'node_modules/expo/node_modules/@expo/fingerprint'), {
    recursive: true,
  });
  writeFileSync(path.join(dir, 'package.json'), '{}');
  writeFileSync(path.join(dir, 'node_modules/expo/package.json'), '{"name":"expo"}');
  writeFileSync(
    path.join(dir, 'node_modules/expo/node_modules/@expo/fingerprint/index.js'),
    "exports.createProjectHashAsync = async () => 'kept';",
  );
  const cache = path.join(dir, 'node_modules/.cache/ng-native-device-tests');
  mkdirSync(path.join(cache, 'ios-kept/App.app'), { recursive: true });
  mkdirSync(path.join(cache, `android-kept-${ABI}`), { recursive: true });
  writeFileSync(path.join(cache, `android-kept-${ABI}/app-debug.apk`), '');
  return dir;
}

/** Start a launch, stop the run once it is under way, and how long the launch took to give up. */
async function stopped(launcher: AppLauncher, projectRoot: string): Promise<number> {
  const stop = new AbortController();
  const started = Date.now();
  const launching = Promise.resolve(
    launcher.start({
      port: 1,
      runId: 'r',
      stateDir: path.join(projectRoot, 'state'),
      projectRoot,
      metroPort: 2,
      signal: stop.signal,
    }),
  );
  setTimeout(() => stop.abort(), 300);
  await assert.rejects(launching);
  return Date.now() - started;
}

describe('stopping a run while the app is being started', () => {
  const saved = { path: process.env['PATH'], home: process.env['ANDROID_HOME'] };
  const restore = () => {
    process.env['PATH'] = saved.path;
    if (saved.home === undefined) delete process.env['ANDROID_HOME'];
    else process.env['ANDROID_HOME'] = saved.home;
  };

  for (const [step, hangs] of [
    ['finding the emulator', '"$*" = "devices"'],
    ['installing the app', '"$3" = "install"'],
  ] as const) {
    it(`stops Android's adb while ${step}`, async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'launch-stop-'));
      try {
        const sdk = path.join(root, 'sdk');
        script(
          path.join(sdk, 'platform-tools/adb'),
          `if [ ${hangs} ]; then sleep 30; fi
case "$*" in
  devices) printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"emu avd name"*) echo phone ;;
  *getprop*) echo 1 ;;
esac`,
        );
        process.env['ANDROID_HOME'] = sdk;
        const took = await stopped(androidEmulatorLauncher({ device: 'phone' }), project(root));
        assert.ok(took < 5000, `gave up in ${took}ms, not after adb's 30 seconds`);
      } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("stops iOS's simctl while finding the simulator", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launch-stop-'));
    try {
      script(path.join(root, 'bin/xcrun'), 'sleep 30');
      process.env['PATH'] = `${path.join(root, 'bin')}:${saved.path}`;
      const took = await stopped(iosSimulatorLauncher({ device: 'iPhone' }), project(root));
      assert.ok(took < 5000, `gave up in ${took}ms, not after simctl's 30 seconds`);
    } finally {
      restore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
