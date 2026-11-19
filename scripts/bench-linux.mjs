#!/usr/bin/env node
/**
 * `pnpm bench:linux`: the timed checks of the desktop performance budget on Linux, run against the
 * GTK host and a release bundle, as `bench:macos` runs them against the AppKit host.
 *
 *   pnpm bench:linux --host <build>/gtk/ngn-linux                   # export the notes example, then measure
 *   pnpm bench:linux --host <build>/gtk/ngn-linux --bundle main.js  # measure a bundle already exported
 *
 * The host is `--host` or `NGN_DESKTOP_HOST`. The numbers are gated in one setting, so they compare
 * from run to run: the AlmaLinux 9 image (`ngn-el9`), Xvfb at 1280 by 800 and scale 1, and GTK's
 * cairo renderer. On Linux it runs where it is (in the image, as CI runs it, for gated numbers); on
 * a Mac it exports the bundle and then runs itself in the image (`linux-image.mjs`), so the host,
 * the bundle and this checkout must be under the home folder.
 *
 * It measures, each against its ceiling in `bench-linux-budget.json`:
 * - `launchMs`: launch to the first frame, as the host logs it (`[ngn] first frame N ms`).
 * - `idleCpu`: percent of one CPU over 30 s once settled, from `utime` and `stime` in
 *   `/proc/<pid>/stat`.
 * - `idleWakeups`: context switches a second over the same 30 s, voluntary and not, summed over
 *   the host's threads in `/proc/<pid>/task/<tid>/status`.
 * - `memoryMb`: proportional set size of the first window, from `/proc/<pid>/smaps_rollup`.
 * - `hostMb`: the host binary's size stripped of symbols.
 * The slowest commit the host logs is reported, not judged: its budget is relative to the same
 * commit on the fake backend, which this does not measure yet.
 *
 * As `bench:macos`, the first launch is a warm-up that is reported and not judged, each metric is
 * the median of `--runs` launches (default 3). A JavaScript bundle is compiled to bytecode first,
 * with the `hermesc` beside the host, as a package ships it. It fails closed: no host, no bundle, or a metric
 * it could not read fails the run, as a breach does, unless the budget file waives it with the
 * reason and the pull request.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitMs, firstFrameMs, hostEnv, judge, summarize } from './bench-macos.mjs';
import { runInLinuxImage, startXvfb } from './linux-image.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const self = fileURLToPath(import.meta.url);

/**
 * CPU time in seconds from `/proc/<pid>/stat`: `utime` and `stime`, fields 14 and 15, counted
 * after the command name, which is in parentheses and may hold spaces.
 *
 * @param {string} stat
 * @param {number} ticksPerSecond
 */
export function cpuSeconds(stat, ticksPerSecond) {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  return Number.isFinite(utime) && Number.isFinite(stime) ? (utime + stime) / ticksPerSecond : null;
}

/** Context switches, voluntary and not, from a thread's `status`. @param {string} status */
export function contextSwitches(status) {
  const voluntary = /^voluntary_ctxt_switches:\s*(\d+)$/m.exec(status);
  const involuntary = /^nonvoluntary_ctxt_switches:\s*(\d+)$/m.exec(status);
  return voluntary && involuntary ? Number(voluntary[1]) + Number(involuntary[1]) : null;
}

/** The proportional set size in megabytes, from `smaps_rollup`. @param {string} rollup */
export function pssMb(rollup) {
  const match = /^Pss:\s*(\d+) kB$/m.exec(rollup);
  return match ? Number(match[1]) / 1024 : null;
}

/** The environment the host is measured in. @param {NodeJS.ProcessEnv} env */
export function benchEnv(env) {
  return { ...hostEnv(env), GSK_RENDERER: 'cairo', GTK_A11Y: 'none' };
}

const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Context switches over a window, from each thread's count at its start and end: a thread that
 * started in the window counts from zero. A thread that ended in it took its switches with it, so
 * the count is unknown and reads as null, not as a total that is too low.
 *
 * @param {Map<string, number>} before
 * @param {Map<string, number>} after
 */
export function switchesBetween(before, after) {
  for (const tid of before.keys()) if (!after.has(tid)) return null;
  let total = 0;
  for (const [tid, count] of after) total += count - (before.get(tid) ?? 0);
  return total;
}

/** The host's CPU seconds and each thread's context switches now, or nulls where /proc had none. */
function sample(pid, ticksPerSecond) {
  const stat = read(`/proc/${pid}/stat`);
  /** @type {Map<string, number> | null} */
  let switches = new Map();
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      const count = contextSwitches(read(`/proc/${pid}/task/${tid}/status`) ?? '');
      // A thread that ended between the listing and the read is left out.
      if (count !== null) switches.set(tid, count);
    }
  } catch {
    switches = null;
  }
  return { cpu: stat === null ? null : cpuSeconds(stat, ticksPerSecond), switches };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch the host on `bundle`, measure it, and stop it.
 *
 * @param {string} host
 * @param {string} bundle
 * @param {{ settleMs?: number, idleMs?: number, ticksPerSecond?: number }} [timing]
 */
export async function measure(
  host,
  bundle,
  { settleMs = 5_000, idleMs = 30_000, ticksPerSecond = 100 } = {},
) {
  const state = mkdtempSync(path.join(tmpdir(), 'bench-linux-'));
  const child = spawn(host, [bundle, '--title', 'bench:linux'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...benchEnv(process.env),
      NGN_TESTS: '1',
      NGN_STATE_DIR: state,
      NGN_RUN_ID: `bench-${process.pid}`,
      NGN_TESTS_FAKE_SYSTEM_UI: '1',
    },
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  // A host that never starts emits `error` and no `exit`: reject the measurement, after cleanup.
  const failed = new Promise((_, reject) => child.once('error', reject));
  failed.catch(() => {});
  const pause = (ms) => Promise.race([wait(ms), failed]);
  try {
    for (let waited = 0; firstFrameMs(log) === null && waited < 10_000; waited += 100)
      await pause(100);
    await pause(settleMs);
    const before = sample(child.pid, ticksPerSecond);
    await pause(idleMs);
    const after = sample(child.pid, ticksPerSecond);
    const seconds = idleMs / 1000;
    const delta = (a, b) => (a === null || b === null ? null : b - a);
    const cpu = delta(before.cpu, after.cpu);
    const switches =
      before.switches && after.switches ? switchesBetween(before.switches, after.switches) : null;
    return {
      launchMs: firstFrameMs(log),
      idleCpu: cpu === null ? null : (cpu / seconds) * 100,
      idleWakeups: switches === null ? null : switches / seconds,
      memoryMb: pssMb(read(`/proc/${child.pid}/smaps_rollup`) ?? ''),
      commitMs: commitMs(log),
    };
  } finally {
    child.kill('SIGTERM');
    rmSync(state, { recursive: true, force: true });
  }
}

/** The host's size stripped of symbols, in megabytes, or null where it could not be stripped. */
function strippedMb(host) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-strip-'));
  try {
    const out = path.join(dir, 'ngn-linux');
    for (const strip of ['llvm-strip', 'strip']) {
      if (spawnSync(strip, ['-o', out, host]).status === 0) return statSync(out).size / 1024 / 1024;
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The bundle as Hermes bytecode, as a package ships it: a `.hbc` as it is, and a JavaScript bundle
 * compiled into `dir` with the `hermesc` beside the host, which is the Hermes the host runs. Parsing
 * the source at launch would measure what no installed app does.
 *
 * @param {string} host
 * @param {string} bundle
 * @param {string} dir
 */
export function bytecode(host, bundle, dir) {
  if (bundle.endsWith('.hbc')) return bundle;
  const hermesc = path.join(path.dirname(host), 'hermesc');
  if (!existsSync(hermesc)) {
    throw new Error(
      `${bundle} is JavaScript, and there is no hermesc beside the host to compile it: pass a .hbc ` +
        'or a host from a build folder, which has its hermesc in gtk/.',
    );
  }
  const out = path.join(dir, `${path.basename(bundle, path.extname(bundle))}.hbc`);
  const compiled = spawnSync(hermesc, ['-emit-binary', '-O', '-w', '-out', out, bundle], {
    stdio: 'inherit',
  });
  if (compiled.status !== 0) throw new Error(`hermesc could not compile ${bundle}.`);
  // The host reads assets from beside the bundle it launches, as the export lays them out.
  const assets = path.join(path.dirname(bundle), 'assets');
  if (existsSync(assets)) symlinkSync(assets, path.join(dir, 'assets'));
  return out;
}

/** A release bundle of the notes example for Linux: `--bundle`, or one exported now. */
function findBundle(given) {
  if (given) return existsSync(given) ? path.resolve(given) : null;
  const notes = path.join(root, 'examples', 'notes');
  const out = path.join(notes, 'dist', 'linux');
  const bundle = path.join(out, 'main.js');
  const exported = spawnSync(
    'npx',
    [
      'expo',
      'export:embed',
      '--platform',
      'linux',
      '--dev',
      'false',
      '--bundle-output',
      bundle,
      '--assets-dest',
      path.join(out, 'assets'),
    ],
    { cwd: notes, stdio: 'inherit' },
  );
  return exported.status === 0 && existsSync(bundle) ? bundle : null;
}

const option = (argv, name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

/** The host, the bundle and the number of runs, from the arguments, or why they are unusable. */
function inputs(argv) {
  const given = option(argv, '--host') ?? process.env.NGN_DESKTOP_HOST;
  if (!given || !existsSync(given)) {
    throw new Error(
      'No Linux desktop host binary. Pass --host or NGN_DESKTOP_HOST: the gtk/ngn-linux in a build ' +
        'folder from native/scripts/build.sh --backend gtk.',
    );
  }
  const runs = Number(option(argv, '--runs') ?? 3);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('--runs takes a whole number, 1 or more.');
  }
  const bundle = findBundle(option(argv, '--bundle'));
  if (!bundle) {
    throw new Error('No Linux bundle: the notes example did not export, or --bundle is missing.');
  }
  return { host: path.resolve(given), bundle, runs };
}

/** Each launch's numbers, the first a warm-up, under a display of the bench's own. */
async function launches(host, bundle, runs) {
  const ticks =
    Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()) || 100;
  const stop = await startXvfb();
  const all = [];
  try {
    for (let launch = 0; launch <= runs; launch += 1) {
      all.push(await measure(host, bundle, { ticksPerSecond: ticks }));
    }
  } finally {
    stop();
  }
  return all;
}

async function main(argv) {
  const { host, bundle, runs } = inputs(argv);
  if (process.platform !== 'linux') {
    process.exitCode = runInLinuxImage(
      self,
      ['--host', host, '--bundle', bundle, '--runs', String(runs)],
      { mounts: [path.dirname(path.dirname(host)), path.dirname(bundle)] },
    );
    return;
  }
  const budget = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'bench-linux-budget.json'), 'utf8'),
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-hbc-'));
  let all;
  try {
    all = await launches(host, bytecode(host, bundle, dir), runs);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const { cold, judged } = summarize(all, 1);
  judged.hostMb = strippedMb(host);
  console.log(
    `setting   ${process.arch}, GSK_RENDERER=cairo, ${process.env.GDK_BACKEND ?? 'default'} display`,
  );
  console.log(`cold      (warm-up, not judged) ${JSON.stringify(cold[0])}`);
  console.log(`reported  commitMs ${judged.commitMs ?? '-'} (the slowest commit, not judged)`);
  const { results, ok } = judge(judged, budget);
  for (const { metric, value, ceiling, status } of results) {
    const shown = value === null ? '-' : Math.round(value * 1000) / 1000;
    console.log(`${status.padEnd(8)} ${metric.padEnd(12)} ${shown} (ceiling ${ceiling})`);
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] === self) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
