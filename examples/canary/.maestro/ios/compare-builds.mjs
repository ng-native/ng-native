// Compares the canary's screenshots between two builds, on one simulator, so a difference is the
// change and not a simulator, a day or a baseline recorded long ago.
//
//   node .maestro/ios/compare-builds.mjs record --app main.app --device <udid> --into dir [--flows a,b]
//       each screenshot the flows assert, recorded from a build into a directory: main's, cached
//   node .maestro/ios/compare-builds.mjs assert --app pr.app --device <udid> --from dir --out out [--flows a,b]
//       each one asserted on a build against a directory recorded before, and report.json in out
//   node .maestro/ios/compare-builds.mjs compare --base main.app --change pr.app --device <udid> --out out [--flows a,b]
//       both, in one sitting: what a pull request does where main's screenshots are not cached
//   node .maestro/ios/compare-builds.mjs flows [--routes /a,/b]
//       the flows, one a line, that open any of the routes, or all of them
//
// `--flows` names flows by their path under .maestro/ios, and is every flow that asserts a
// screenshot where it is left out. The committed baselines are put back afterwards, whatever
// happened. Each screenshot that differs is copied into `--out` with the difference Maestro drew.
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
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const baselines = join(here, 'baselines');
const APP_ID = 'dev.angularnative.canary';
const java = { JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21' };

/** The flows that assert a screenshot: every one the comparison has something to compare in. */
export function screenshotFlows(root = here) {
  return [root, join(root, 'visual')].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.yaml') && !/\.(recording|comparing)\.yaml$/.test(name))
      .map((name) => join(dir, name))
      .filter((file) => readFileSync(file, 'utf8').includes('assertScreenshot')),
  );
}

/** The routes a flow says it opens, in its `# routes: /a /b` line. */
export const routesOf = (flow) =>
  (/^# routes: (.+)$/m.exec(flow)?.[1] ?? '').split(/\s+/).filter(Boolean);

/**
 * The flows that open any of `routes`, which are the screens whose native output changed. A flow
 * that names no route is run whatever changed, as nothing says what it shows.
 */
export function flowsFor(flows, routes) {
  const changed = new Set(routes);
  return flows.filter((file) => {
    const own = routesOf(readFileSync(file, 'utf8'));
    return !own.length || own.some((route) => changed.has(route));
  });
}

/** A flow with each screenshot it asserts made optional: one that differs is noted, not fatal. */
export function comparing(flow) {
  return flow.replace(
    /(- assertScreenshot:\n(\s+)path: \S+\n(?:\s+thresholdPercentage: [\d.]+\n)?)/g,
    (assertion, _whole, indent) => `${assertion}${indent}optional: true\n`,
  );
}

/** The screenshots a flow asserts, by file name. */
const shotsOf = (flow) =>
  [...readFileSync(flow, 'utf8').matchAll(/- assertScreenshot:\n\s+path: (\S+\.png)/g)].map(
    (match) => basename(match[1]),
  );

function options(argv) {
  const value = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const named = value('--flows');
  const flows = named
    ? named
        .split(',')
        .filter(Boolean)
        .map((flow) => resolve(here, flow))
    : screenshotFlows();
  for (const flow of flows) if (!existsSync(flow)) throw new Error(`no flow at ${flow}`);
  const path = (name) => (value(name) === undefined ? undefined : resolve(value(name)));
  return {
    command: argv[0],
    flows,
    device: value('--device'),
    app: path('--app'),
    base: path('--base'),
    change: path('--change'),
    into: path('--into'),
    from: path('--from'),
    out: path('--out'),
    routes: value('--routes'),
  };
}

/** Put one build on the simulator, as the only canary there, with the status bar held still. */
function install(device, app) {
  if (!existsSync(app)) throw new Error(`no build at ${app}`);
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

/** Run `work` with the committed baselines put back after it, whatever it did to them. */
function keepingBaselines(work) {
  const kept = mkdtempSync(join(tmpdir(), 'canary-baselines-'));
  cpSync(baselines, kept, { recursive: true });
  try {
    return work();
  } finally {
    rmSync(baselines, { recursive: true, force: true });
    cpSync(kept, baselines, { recursive: true });
    rmSync(kept, { recursive: true, force: true });
  }
}

/** Each screenshot the flows assert, taken on a build and put in `into`. */
function record(device, app, flows, into) {
  keepingBaselines(() => {
    install(device, app);
    execFileSync(process.execPath, [join(here, 'record-baselines.mjs'), ...flows], {
      stdio: 'inherit',
      env: { ...process.env, ...java, MAESTRO_DEVICE: device },
    });
    mkdirSync(into, { recursive: true });
    for (const shot of flows.flatMap(shotsOf)) cpSync(join(baselines, shot), join(into, shot));
  });
}

/**
 * Each screenshot the flows assert, on a build, against those in `from`: every one compared, the
 * ones after a difference included, and report.json in `out`, which CI's comment is written from.
 */
function assert(device, app, flows, from, out) {
  return keepingBaselines(() => {
    for (const shot of flows.flatMap(shotsOf)) {
      if (!existsSync(join(from, shot))) throw new Error(`no screenshot ${shot} to compare with`);
      cpSync(join(from, shot), join(baselines, shot));
    }
    install(device, app);
    // A copy of each flow, beside it so its subflows resolve the same, where a screenshot that
    // differs does not stop the flow.
    const copies = flows.map((flow) => {
      const copy = flow.replace(/\.yaml$/, '.comparing.yaml');
      writeFileSync(copy, comparing(readFileSync(flow, 'utf8')));
      return copy;
    });
    let run;
    try {
      run = spawnSync('maestro', ['--device', device, 'test', ...copies], {
        stdio: 'inherit',
        env: { ...process.env, ...java },
      });
    } finally {
      for (const copy of copies) rmSync(copy, { force: true });
    }
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const shots = readdirSync(baselines)
      .filter((name) => name.endsWith('_diff.png'))
      .map((name) => {
        const shot = name.replace(/_diff\.png$/, '.png');
        cpSync(join(baselines, name), join(out, name));
        cpSync(join(baselines, shot), join(out, `base-${shot}`));
        return { shot, base: `base-${shot}`, diff: name };
      });
    // A screenshot that differs fails no flow, so one that failed did for another reason, a tap
    // or a crash, and what it had left to compare was not compared.
    const compared = run.status === 0;
    const report = { flows: flows.length, compared, differ: shots };
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      shots.length
        ? `\n${shots.length} screenshots differ: see ${out}`
        : `\nEvery screenshot of the ${flows.length} flows matches.`,
    );
    return compared;
  });
}

/** `record` then `assert`, with main's screenshots in a directory of their own for the sitting. */
function compare(device, base, change, flows, out) {
  const recorded = mkdtempSync(join(tmpdir(), 'canary-base-shots-'));
  try {
    record(device, base, flows, recorded);
    return assert(device, change, flows, recorded, out);
  } finally {
    rmSync(recorded, { recursive: true, force: true });
  }
}

/** Each command, and the options it needs; false where it failed. */
const commands = {
  flows: (opts) => {
    const flows =
      opts.routes === undefined ? opts.flows : flowsFor(opts.flows, opts.routes.split(','));
    for (const flow of flows) console.log(relative(here, flow));
  },
  record: (opts) => record(opts.device, opts.app, opts.flows, opts.into),
  assert: (opts) => assert(opts.device, opts.app, opts.flows, opts.from, opts.out),
  compare: (opts) => compare(opts.device, opts.base, opts.change, opts.flows, opts.out),
};
const needed = {
  record: ['app', 'into'],
  assert: ['app', 'from', 'out'],
  compare: ['base', 'change', 'out'],
};

function main(argv) {
  const opts = options(argv);
  const command = commands[opts.command];
  if (!command || (needed[opts.command] ?? []).some((name) => !opts[name])) {
    throw new Error(
      'usage: compare-builds.mjs record | assert | compare | flows, as its header says',
    );
  }
  if (opts.command !== 'flows' && !opts.device) throw new Error('no --device');
  if (command(opts) === false) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  try {
    main(argv);
  } catch (error) {
    console.error(`compare-builds: ${error.message}`);
    // Written where it could be: what reads the report says nothing was compared, rather than
    // finding no report at all.
    const at = argv.indexOf('--out');
    if (at !== -1 && argv[at + 1]) {
      mkdirSync(resolve(argv[at + 1]), { recursive: true });
      const report = { flows: 0, compared: false, differ: [] };
      writeFileSync(
        join(resolve(argv[at + 1]), 'report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    process.exitCode = 1;
  }
}
