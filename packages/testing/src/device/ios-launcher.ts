/**
 * The launcher for an iOS simulator: the project's development build (see `native-build.ts`) on
 * the simulator `device` names, booted when it is not, with the app installed afresh for each
 * launch so it starts with no data of an earlier one, and loading its bundle from the run's Metro.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { progress, runCommand, sleep } from './command.ts';
import type { AppLauncher, LaunchedApp } from './launcher.ts';
import { crashReportSince } from './macos-launcher.ts';
import { nativeBuild } from './native-build.ts';

export interface IosSimulatorOptions {
  /**
   * The simulator's name, as Xcode lists it (`iPhone 17 Pro`), on the newest iOS that has one.
   * Default: a booted iPhone, or else the first iPhone on the newest iOS. Name one to keep
   * screenshots the same from machine to machine.
   */
  device?: string;
}

interface Simulator {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

export function iosSimulatorLauncher(options: IosSimulatorOptions = {}): AppLauncher {
  let executable = '';
  return {
    async start(request): Promise<LaunchedApp> {
      const started = Date.now();
      const [simulator, build] = await Promise.all([
        bootedSimulator(options.device),
        nativeBuild(request.projectRoot, 'ios', { signal: request.signal }),
      ]);
      const plist = path.join(build.path, 'Info.plist');
      const read = async (key: string) =>
        (await runCommand('plutil', ['-extract', key, 'raw', plist])).output.trim();
      const bundle = await read('CFBundleIdentifier');
      executable = await read('CFBundleExecutable');
      await runCommand('xcrun', ['simctl', 'uninstall', simulator.udid, bundle], {
        allowFailure: true,
      });
      progress('ios', `${simulator.name} booted and the build ready`, started);
      await runCommand('xcrun', ['simctl', 'install', simulator.udid, build.path]);
      progress('ios', 'installed; launching, and waiting for Metro to bundle the app', started);
      // Attached to the app's console, the command lasts as long as the app does.
      const child = spawn(
        'xcrun',
        [
          'simctl',
          'launch',
          '--console-pty',
          '--terminate-running-process',
          simulator.udid,
          bundle,
          '-RCT_jsLocation',
          `127.0.0.1:${request.metroPort}`,
        ],
        { stdio: 'ignore' },
      );
      const exited = new Promise<string>((resolve) => {
        child.once('error', (error) => resolve(`it could not be started: ${error.message}`));
        child.once('close', (code, signal) =>
          resolve(signal ? `signal ${signal}` : `status ${code ?? 'unknown'}`),
        );
      });
      return {
        exited,
        async stop() {
          await runCommand('xcrun', ['simctl', 'terminate', simulator.udid, bundle], {
            allowFailure: true,
          });
          child.kill();
          await exited;
        },
      };
    },
    async crashReport(since) {
      if (!executable) return undefined;
      const reports = path.join(homedir(), 'Library/Logs/DiagnosticReports');
      for (const wait of [0, 1000, 2000]) {
        await sleep(wait);
        const found = crashReportSince(reports, executable, since);
        if (found) return found;
      }
      return undefined;
    },
  };
}

/** The simulator to run on, booted. */
async function bootedSimulator(name: string | undefined): Promise<Simulator> {
  const simulator = pick(await simulators(), name);
  if (simulator.state !== 'Booted') {
    await runCommand('xcrun', ['simctl', 'boot', simulator.udid], { allowFailure: true });
  }
  await runCommand('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);
  return simulator;
}

async function simulators(): Promise<Simulator[]> {
  const { output } = await runCommand('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  const { devices } = JSON.parse(output) as {
    devices: Record<string, Omit<Simulator, 'runtime'>[]>;
  };
  return Object.entries(devices)
    .filter(([runtime]) => runtime.includes('SimRuntime.iOS'))
    .flatMap(([runtime, list]) => list.map((device) => ({ ...device, runtime })));
}

/** The named simulator on the newest iOS that has it, or a booted iPhone, or the newest one. */
export function pick(all: Simulator[], name: string | undefined): Simulator {
  const newest = [...all].sort((a, b) => version(b.runtime) - version(a.runtime));
  const found = name
    ? (newest.find((device) => device.name === name && device.state === 'Booted') ??
      newest.find((device) => device.name === name))
    : (newest.find((device) => device.state === 'Booted' && device.name.startsWith('iPhone')) ??
      newest.find((device) => device.name.startsWith('iPhone')));
  if (!found) {
    const names = [...new Set(all.map((device) => device.name))].join(', ');
    throw new Error(
      name
        ? `No iOS simulator named "${name}". Available: ${names || 'none'}.`
        : 'No iPhone simulator: add one in Xcode, under Window > Devices and Simulators.',
    );
  }
  return found;
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` as a number to sort by. */
function version(runtime: string): number {
  const [major = 0, minor = 0] = (runtime.match(/iOS-(\d+)-(\d+)/) ?? []).slice(1).map(Number);
  return major * 100 + minor;
}
