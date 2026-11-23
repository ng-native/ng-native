/**
 * Stopping a run while a launcher is still starting the app: each startup command it runs stops
 * with the run, so a stop never waits on a stalled `adb` or `simctl`. The tools are stand-ins
 * that hang on the step under test; the build is one already kept, so the launch reaches it.
 */
import assert from 'node:assert/strict';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

describe('the bundle a launcher waits on', () => {
  /**
   * A Metro that answers the bundle only once the launcher's last step before launching has run (it
   * writes `ready`), and a moment after, noting in `log` when it answered: a launcher that did not wait
   * launches the app in that moment.
   */
  async function slowMetro(log: string) {
    let closed = false;
    const metro = createServer(async (request, response) => {
      const deadline = Date.now() + 10_000;
      while (!closed && Date.now() < deadline && !readFileSync(log, 'utf8').includes('ready')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (closed) return;
      appendFileSync(log, `bundled ${request.url}\n`);
      response.end('bundle');
    });
    await new Promise<void>((resolve) => metro.listen(0, '127.0.0.1', resolve));
    return {
      port: (metro.address() as AddressInfo).port,
      close: () => {
        closed = true;
        metro.close();
        metro.closeAllConnections();
      },
    };
  }

  it("has Metro bundle the app before Android's app is launched, as the app asks for it", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launch-warm-'));
    const saved = process.env['ANDROID_HOME'];
    const log = path.join(root, 'order.log');
    writeFileSync(log, '');
    const metro = await slowMetro(log);
    try {
      const sdk = path.join(root, 'sdk');
      script(
        path.join(sdk, 'platform-tools/adb'),
        `case "$*" in
  devices) printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;
  *"emu avd name"*) echo phone ;;
  *getprop*) echo 1 ;;
  *resolve-activity*) echo ready >> ${JSON.stringify(log)}; echo app/.Main ;;
  *"am start"*) echo launched >> ${JSON.stringify(log)} ;;
esac`,
      );
      script(path.join(sdk, 'build-tools/35.0.0/aapt2'), 'echo app');
      process.env['ANDROID_HOME'] = sdk;
      const app = await androidEmulatorLauncher({ device: 'phone' }).start({
        port: 1,
        runId: 'r',
        stateDir: path.join(root, 'state'),
        projectRoot: project(root),
        metroPort: metro.port,
      });
      await app.stop();
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
        'ready',
        'bundled /.expo/.virtual-metro-entry.bundle?platform=android&dev=true&lazy=true&minify=false&modulesOnly=false&runModule=true',
        'launched',
      ]);
    } finally {
      if (saved === undefined) delete process.env['ANDROID_HOME'];
      else process.env['ANDROID_HOME'] = saved;
      metro.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("has Metro bundle the app before iOS's app is launched, as the app asks for it", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launch-warm-'));
    const saved = process.env['PATH'];
    const log = path.join(root, 'order.log');
    writeFileSync(log, '');
    const metro = await slowMetro(log);
    try {
      const devices = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
            { udid: 'U', name: 'iPhone', state: 'Booted' },
          ],
        },
      });
      script(
        path.join(root, 'bin/xcrun'),
        `case "$2" in
  list) echo '${devices}' ;;
  install) echo ready >> ${JSON.stringify(log)} ;;
  launch) echo launched >> ${JSON.stringify(log)} ;;
esac`,
      );
      script(path.join(root, 'bin/plutil'), 'echo value');
      process.env['PATH'] = `${path.join(root, 'bin')}:${saved}`;
      const app = await iosSimulatorLauncher({ device: 'iPhone' }).start({
        port: 1,
        runId: 'r',
        stateDir: path.join(root, 'state'),
        projectRoot: project(root),
        metroPort: metro.port,
      });
      await app.exited;
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
        'ready',
        'bundled /.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&lazy=true&minify=false&modulesOnly=false&runModule=true',
        'launched',
      ]);
    } finally {
      process.env['PATH'] = saved;
      metro.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
