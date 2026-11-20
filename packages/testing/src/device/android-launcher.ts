/**
 * The launcher for an Android emulator: the project's development build (see `native-build.ts`)
 * on the emulator `device` names, started when it is not running, with the app's data cleared for
 * each launch, and loading its bundle from the run's Metro.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { runCommand, sleep } from './command.ts';
import type { AppLauncher, LaunchedApp } from './launcher.ts';
import { androidSdk, nativeBuild } from './native-build.ts';

export interface AndroidEmulatorOptions {
  /**
   * The emulator's AVD name, as `emulator -list-avds` prints it. Default: a running emulator, or
   * else the first AVD. Name one to keep screenshots the same from machine to machine.
   */
  device?: string;
}

/** The ABI an emulator runs on this machine, which the build is limited to. */
const HOST_ABI = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';

export function androidEmulatorLauncher(options: AndroidEmulatorOptions = {}): AppLauncher {
  let last: { adb: (...args: string[]) => Promise<string>; since: number } | null = null;
  return {
    async start(request): Promise<LaunchedApp> {
      const sdk = androidSdk();
      const [serial, build] = await Promise.all([
        runningEmulator(sdk, options.device),
        nativeBuild(request.projectRoot, 'android', { abi: HOST_ABI }),
      ]);
      const adb = async (...args: string[]) =>
        (await runCommand(path.join(sdk, 'platform-tools/adb'), ['-s', serial, ...args])).output;
      last = { adb, since: Date.now() };
      await adb('install', '-r', build.path);
      const pkg = await packageName(sdk, build.path);
      await adb('shell', 'pm', 'clear', pkg);
      // Where a debug build loads its bundle from: the run's Metro, through the emulator's alias
      // for the machine it runs on.
      const prefs = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="debug_http_host">10.0.2.2:${request.metroPort}</string></map>`;
      await adb(
        'shell',
        `run-as ${pkg} sh -c 'mkdir -p shared_prefs && echo "${prefs.replace(/"/g, '\\"')}" > shared_prefs/${pkg}_preferences.xml'`,
      );
      const activity = (await adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg))
        .trim()
        .split('\n')
        .pop()!;
      await adb('shell', 'am', 'start', '-W', '-n', activity);
      let stopped = false;
      const exited = (async () => {
        // The app is gone when its process is, after it has been seen.
        let seen = false;
        for (;;) {
          const pid = (await adb('shell', 'pidof', pkg).catch(() => '')).trim();
          if (pid) seen = true;
          else if (seen || stopped) return 'the process ended';
          await sleep(1000);
        }
      })();
      return {
        exited,
        async stop() {
          stopped = true;
          await adb('shell', 'am', 'force-stop', pkg).catch(() => {});
          await exited;
        },
      };
    },
    async crashReport() {
      if (!last) return undefined;
      const crash = (await last.adb('logcat', '-d', '-b', 'crash').catch(() => '')).trim();
      return crash ? `Android's crash log:\n${crash.split('\n').slice(-40).join('\n')}` : undefined;
    },
  };
}

/** The serial of the emulator to run on, started and booted. */
async function runningEmulator(sdk: string, name: string | undefined): Promise<string> {
  const adb = path.join(sdk, 'platform-tools/adb');
  const running = await emulators(adb);
  const found = name ? running.find((emulator) => emulator.avd === name) : running[0];
  if (found) return found.serial;

  const emulator = path.join(sdk, 'emulator/emulator');
  const avds = (await runCommand(emulator, ['-list-avds'])).output.split('\n').filter(Boolean);
  const avd = name ?? avds[0];
  if (!avd || !avds.includes(avd)) {
    throw new Error(
      name
        ? `No Android emulator named "${name}". Available: ${avds.join(', ') || 'none'}.`
        : 'No Android emulator: add one in Android Studio, under Device Manager.',
    );
  }
  return bootEmulator(emulator, adb, avd);
}

/** Start the AVD and wait for it to boot: its serial. */
async function bootEmulator(emulator: string, adb: string, avd: string): Promise<string> {
  const args = ['-avd', avd, '-no-snapshot-save', '-no-boot-anim', '-no-audio'];
  if (process.env['CI']) args.push('-no-window');
  // It stays up after the run, ready for the next: started on its own, not as the pool's child.
  spawn(emulator, args, { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const serial = (await emulators(adb)).find((each) => each.avd === avd)?.serial;
    if (serial && (await booted(adb, serial))) return serial;
    await sleep(2000);
  }
  throw new Error(`The emulator ${avd} did not boot within five minutes.`);
}

async function booted(adb: string, serial: string): Promise<boolean> {
  const { output } = await runCommand(
    adb,
    ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
    {
      allowFailure: true,
    },
  );
  return output.trim() === '1';
}

async function emulators(adb: string): Promise<{ serial: string; avd: string }[]> {
  const { output } = await runCommand(adb, ['devices'], { allowFailure: true });
  const serials = output
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([serial, state]) => serial?.startsWith('emulator-') && state?.trim() === 'device')
    .map(([serial]) => serial!);
  return Promise.all(
    serials.map(async (serial) => {
      const name = await runCommand(adb, ['-s', serial, 'emu', 'avd', 'name'], {
        allowFailure: true,
      });
      return { serial, avd: name.output.split('\n')[0]!.trim() };
    }),
  );
}

/** The APK's package name, from the newest build tools' `aapt2`. */
async function packageName(sdk: string, apk: string): Promise<string> {
  const tools = readdirSync(path.join(sdk, 'build-tools')).sort(compareVersions).pop();
  if (!tools) throw new Error(`No Android build tools in ${sdk}`);
  const { output } = await runCommand(path.join(sdk, 'build-tools', tools, 'aapt2'), [
    'dump',
    'packagename',
    apk,
  ]);
  return output.trim();
}

function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.-]/).map((part) => Number(part) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}
