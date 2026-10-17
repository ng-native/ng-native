// Compares two release builds of the canary screen by screen: the screenshots each flow asserts
// are recorded from the first build, then asserted on the second, on one simulator in one sitting,
// so a difference is the change and not a simulator, a day or a baseline recorded long ago.
//
//   node .maestro/ios/compare-builds.mjs --base main.app --change pr.app --device <udid> --out dir
//
// The committed baselines are put back afterwards, whatever happened. Each screenshot that differs
// is copied into `--out` with the difference Maestro drew, for the pull request to show.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const baselines = join(here, 'baselines');
const APP_ID = 'dev.angularnative.canary';

function options(argv) {
  const value = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const base = value('--base');
  const change = value('--change');
  const device = value('--device');
  if (!base || !change || !device) {
    throw new Error(
      'Usage: compare-builds.mjs --base <app> --change <app> --device <udid> [--out dir]',
    );
  }
  return {
    base: resolve(base),
    change: resolve(change),
    device,
    out: resolve(value('--out') ?? 'visual-diff'),
  };
}

/** The flows that assert a screenshot: every one the comparison has something to compare in. */
export function screenshotFlows(root = here) {
  return [root, join(root, 'visual')].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !name.endsWith('.recording.yaml'))
      .map((name) => join(dir, name))
      .filter((file) => readFileSync(file, 'utf8').includes('assertScreenshot')),
  );
}

const java = { JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21' };

/** Put one build on the simulator, as the only canary there, with the status bar held still. */
function install(device, app) {
  spawnSync('xcrun', ['simctl', 'uninstall', device, APP_ID]);
  execFileSync('xcrun', ['simctl', 'install', device, app], { stdio: 'inherit' });
  execFileSync('xcrun', [
    'simctl',
    'status_bar',
    device,
    'override',
    '--time',
    '9:41',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
    '--wifiBars',
    '3',
  ]);
}

function main() {
  const opts = options(process.argv.slice(2));
  for (const app of [opts.base, opts.change]) {
    if (!existsSync(app)) throw new Error(`no build at ${app}`);
  }
  const kept = mkdtempSync(join(tmpdir(), 'canary-baselines-'));
  cpSync(baselines, kept, { recursive: true });
  try {
    install(opts.device, opts.base);
    execFileSync(process.execPath, [join(here, 'record-baselines.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, ...java, MAESTRO_DEVICE: opts.device },
    });
    install(opts.device, opts.change);
    const flows = screenshotFlows();
    const run = spawnSync('maestro', ['--device', opts.device, 'test', ...flows], {
      stdio: 'inherit',
      env: { ...process.env, ...java },
    });
    rmSync(opts.out, { recursive: true, force: true });
    mkdirSync(opts.out, { recursive: true });
    const differ = readdirSync(baselines).filter((name) => name.endsWith('_diff.png'));
    for (const name of differ) {
      const shot = name.replace(/_diff\.png$/, '.png');
      cpSync(join(baselines, name), join(opts.out, name));
      cpSync(join(baselines, shot), join(opts.out, `base-${shot}`));
    }
    console.log(
      differ.length
        ? `\n${differ.length} screenshots differ from the base build: see ${opts.out}`
        : `\nEvery screenshot of the ${flows.length} flows matches the base build.`,
    );
    process.exitCode = run.status === 0 && !differ.length ? 0 : 1;
  } finally {
    // The committed baselines, and nothing the base build recorded or Maestro drew.
    rmSync(baselines, { recursive: true, force: true });
    cpSync(kept, baselines, { recursive: true });
    rmSync(kept, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(`compare-builds: ${error.message}`);
    process.exitCode = 1;
  }
}
