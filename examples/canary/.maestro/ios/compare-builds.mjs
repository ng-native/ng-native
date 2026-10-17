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
  writeFileSync,
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

/** A flow with each screenshot it asserts made optional: one that differs is noted, not fatal. */
export function comparing(flow) {
  return flow.replace(
    /(- assertScreenshot:\n(\s+)path: \S+\n(?:\s+thresholdPercentage: [\d.]+\n)?)/g,
    (assertion, _whole, indent) => `${assertion}${indent}optional: true\n`,
  );
}

/** The flows that assert a screenshot: every one the comparison has something to compare in. */
export function screenshotFlows(root = here) {
  return [root, join(root, 'visual')].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !/\.(recording|comparing)\.yaml$/.test(name))
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
    // Each screenshot compared, the ones after a difference included: a copy of each flow, beside
    // it so its subflows resolve the same, where a screenshot that differs does not stop the flow.
    const copies = flows.map((flow) => {
      const copy = flow.replace(/\.yaml$/, '.comparing.yaml');
      writeFileSync(copy, comparing(readFileSync(flow, 'utf8')));
      return copy;
    });
    let run;
    try {
      run = spawnSync('maestro', ['--device', opts.device, 'test', ...copies], {
        stdio: 'inherit',
        env: { ...process.env, ...java },
      });
    } finally {
      for (const copy of copies) rmSync(copy, { force: true });
    }
    rmSync(opts.out, { recursive: true, force: true });
    mkdirSync(opts.out, { recursive: true });
    const differ = readdirSync(baselines).filter((name) => name.endsWith('_diff.png'));
    const shots = differ.map((name) => {
      const shot = name.replace(/_diff\.png$/, '.png');
      cpSync(join(baselines, name), join(opts.out, name));
      cpSync(join(baselines, shot), join(opts.out, `base-${shot}`));
      return { shot, base: `base-${shot}`, diff: name };
    });
    // What CI's comment is written from. A screenshot that differs fails no flow, so one that failed
    // did for another reason, a tap or a crash, and what it had left to compare was not compared.
    const compared = run.status === 0;
    writeFileSync(
      join(opts.out, 'report.json'),
      `${JSON.stringify({ flows: flows.length, compared, differ: shots }, null, 2)}\n`,
    );
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
    // Written where it could be: what reads the report says nothing was compared, rather than
    // finding no report at all.
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--out');
    if (at !== -1 && argv[at + 1]) {
      mkdirSync(resolve(argv[at + 1]), { recursive: true });
      writeFileSync(
        join(resolve(argv[at + 1]), 'report.json'),
        `${JSON.stringify({ flows: 0, compared: false, differ: [] }, null, 2)}\n`,
      );
    }
    process.exitCode = 1;
  }
}
