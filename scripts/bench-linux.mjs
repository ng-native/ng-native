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
 *   the host's threads in `/proc/<pid>/task/<tid>/status`, sampled every 100 ms (`switchesOver`).
 * - `memoryMb`: proportional set size of the first window, from `/proc/<pid>/smaps_rollup`.
 * - `hostMb`: the host binary's size stripped of symbols.
 * And, from a second launch on a bundle of its own (`examples/notes/bench/linux-bench.ts`, exported
 * with the notes example's Metro config), which tells a local server when each of its steps begins
 * and ends while the host logs every commit and frame (`NGN_LOG_COMMITS`):
 * - `mountMs`: the slowest commit of mounting a list of 2,000 views, on the JavaScript thread.
 * - `scrollFrameMs`: the median frame, from the frame clock's update to the end of its paint, while
 *   the list scrolls and one of its views changes each frame.
 * - `resizeCommitMs` and `resizeCommitsPerFrame`: the slowest commit, and commits over frames,
 *   while a divider's width changes each frame, as a drag changes it.
 * - `extraWindowMb`: the growth of the host's proportional set size from opening four more
 *   windows, over four.
 * The slowest commit the host logs on the notes bundle is reported, not judged: its budget is
 * relative to the same commit on the fake backend, which this does not measure yet.
 *
 * As `bench:macos`, the first launch is a warm-up that is reported and not judged, each metric is
 * the median of `--runs` launches (default 3). A JavaScript bundle is compiled to bytecode first,
 * with the `hermesc` beside the host, as a package ships it. It fails closed: no host, no bundle, or a metric
 * it could not read fails the run, as a breach does, unless the budget file waives it with the
 * reason and the pull request.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
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
import { commitMs, firstFrameMs, hostEnv, judge, median, summarize } from './bench-macos.mjs';
import { runInLinuxImage, startXvfb, stopHost } from './linux-image.mjs';

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
 * Context switches over a window, from each thread's count in samples taken through it. /proc keeps
 * no count for a thread that has ended, not even in the process's own `status` (that is the main
 * thread's), and GLib's thread pool ends an idle worker 15 s after its last job, inside the window.
 * So the window is sampled often, and a thread adds what it switched between each pair of samples
 * it is in: one that ended loses only what it switched after its last sample. A thread that is new
 * in a sample counts from zero, as does a reused thread id whose count went down. Null, when any
 * sample could not list the threads, or there are fewer than two.
 *
 * @param {(Map<string, number> | null)[]} samples
 */
export function switchesOver(samples) {
  if (samples.length < 2 || samples.includes(null)) return null;
  let total = 0;
  for (let at = 1; at < samples.length; at += 1) {
    const before = /** @type {Map<string, number>} */ (samples[at - 1]);
    for (const [tid, count] of /** @type {Map<string, number>} */ (samples[at])) {
      const was = before.get(tid);
      total += was === undefined || count < was ? count : count - was;
    }
  }
  return total;
}

/**
 * Idle CPU in percent of one CPU and wakeups a second, over the time that passed between the two
 * samples rather than the time asked for, which a late timer stretches.
 *
 * @param {{ cpu: number | null, at: number }} before
 * @param {{ cpu: number | null, at: number }} after
 * @param {number | null} switches
 */
export function idleRates(before, after, switches) {
  const seconds = (after.at - before.at) / 1000;
  if (!(seconds > 0)) return { idleCpu: null, idleWakeups: null };
  const cpu = before.cpu === null || after.cpu === null ? null : after.cpu - before.cpu;
  return {
    idleCpu: cpu === null ? null : (cpu / seconds) * 100,
    idleWakeups: switches === null ? null : switches / seconds,
  };
}

/** Each of the host's threads' context switches now, or null where /proc could not list them. */
function threadSwitches(pid) {
  const switches = new Map();
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      const count = contextSwitches(read(`/proc/${pid}/task/${tid}/status`) ?? '');
      // A thread that ended between the listing and the read is left out.
      if (count !== null) switches.set(tid, count);
    }
  } catch {
    return null;
  }
  return switches;
}

/** The host's CPU seconds now, or null where /proc had none. */
function cpuNow(pid, ticksPerSecond) {
  const stat = read(`/proc/${pid}/stat`);
  return stat === null ? null : cpuSeconds(stat, ticksPerSecond);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The host launched on `bundle` as a test launch under a state folder of its own, its standard
 * output and error given to `onOutput`. `failed` rejects when it could not start, which emits
 * `error` and no `exit`.
 *
 * @param {string} host
 * @param {string} bundle
 * @param {(chunk: Buffer) => void} onOutput
 * @param {NodeJS.ProcessEnv} [extra]
 */
function launchHost(host, bundle, onOutput, extra = {}) {
  const state = mkdtempSync(path.join(tmpdir(), 'bench-linux-'));
  const child = spawn(host, [bundle, '--title', 'bench:linux'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...benchEnv(process.env),
      NGN_TESTS: '1',
      NGN_STATE_DIR: state,
      NGN_RUN_ID: `bench-${process.pid}`,
      NGN_TESTS_FAKE_SYSTEM_UI: '1',
      ...extra,
    },
  });
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  const failed = new Promise((_, reject) => child.once('error', reject));
  failed.catch(() => {});
  return { child, state, failed };
}

/**
 * Launch the host on `bundle`, measure it, and stop it.
 *
 * @param {string} host
 * @param {string} bundle
 * @param {{ settleMs?: number, idleMs?: number, sampleMs?: number, ticksPerSecond?: number, stopGraceMs?: number }} [timing]
 */
export async function measure(
  host,
  bundle,
  { settleMs = 5_000, idleMs = 30_000, sampleMs = 100, ticksPerSecond = 100, stopGraceMs } = {},
) {
  let log = '';
  const { child, state, failed } = launchHost(host, bundle, (chunk) => (log += chunk));
  // A host that never starts rejects the measurement, after cleanup.
  const pause = (ms) => Promise.race([wait(ms), failed]);
  try {
    for (let waited = 0; firstFrameMs(log) === null && waited < 10_000; waited += 100)
      await pause(100);
    await pause(settleMs);
    const before = { cpu: cpuNow(child.pid, ticksPerSecond), at: performance.now() };
    const samples = [threadSwitches(child.pid)];
    for (let left = idleMs; left > 0; left = idleMs - (performance.now() - before.at)) {
      await pause(Math.min(sampleMs, left));
      samples.push(threadSwitches(child.pid));
    }
    const after = { cpu: cpuNow(child.pid, ticksPerSecond), at: performance.now() };
    return {
      launchMs: firstFrameMs(log),
      ...idleRates(before, after, switchesOver(samples)),
      memoryMb: pssMb(read(`/proc/${child.pid}/smaps_rollup`) ?? ''),
      commitMs: commitMs(log),
    };
  } finally {
    // The next launch starts only once this host has gone.
    await stopHost(child, stopGraceMs);
    rmSync(state, { recursive: true, force: true });
  }
}

/**
 * What the host logged, line by line, with when each line arrived: a commit (`[ngn] commit N ms`)
 * or a frame (`[ngn] frame N ms`). A chunk need not end on a line break, so the unfinished line
 * waits for the rest.
 */
export class HostEvents {
  /** @type {{ kind: 'commit' | 'frame', ms: number, at: number }[]} */
  events = [];
  #pending = '';

  /** @param {string} chunk @param {number} at */
  push(chunk, at) {
    const lines = (this.#pending + chunk).split('\n');
    this.#pending = lines.pop() ?? '';
    for (const line of lines) {
      const match = /\[ngn\] (commit|frame) ([\d.]+) ms/.exec(line);
      if (match) {
        this.events.push({
          kind: /** @type {'commit' | 'frame'} */ (match[1]),
          ms: Number(match[2]),
          at,
        });
      }
    }
  }
}

/**
 * The workload's metrics from its steps' bounds (when each began and ended, as the server saw them),
 * what the host logged and the memory sampled around the window step. A metric whose events are not
 * there is null, which fails the run: a step that logged no commit measured nothing.
 *
 * @param {{ events: { kind: string, ms: number, at: number }[], steps: Record<string, { from?: number, to?: number, failed?: boolean }>, pss: { before: number | null, after: number | null }, windows?: number }} measured
 */
export function workloadMetrics({ events, steps, pss, windows }) {
  const within = (name, kind) => {
    const step = steps[name];
    if (step?.from === undefined || step.to === undefined || step.failed) return [];
    return events
      .filter((event) => event.kind === kind && event.at > step.from && event.at <= step.to)
      .map((event) => event.ms);
  };
  const slowest = (times) => (times.length ? Math.max(...times) : null);
  const scrollFrames = within('scroll', 'frame');
  const resizeCommits = within('resize', 'commit');
  const resizeFrames = within('resize', 'frame');
  return {
    mountMs: slowest(within('mount', 'commit')),
    scrollFrameMs: scrollFrames.length ? median(scrollFrames) : null,
    resizeCommitMs: slowest(resizeCommits),
    resizeCommitsPerFrame: resizeFrames.length ? resizeCommits.length / resizeFrames.length : null,
    extraWindowMb:
      steps['window']?.failed || pss.before === null || pss.after === null || !(windows > 0)
        ? null
        : (pss.after - pss.before) / windows,
  };
}

/** How long the server lets the host's output catch up with a step's boundary, in milliseconds. */
const DRAIN_MS = 300;

/**
 * Launch the host on the workload bundle and measure it: the bundle asks this process's server, on
 * `port`, to start, and to bracket each step (`begin/<name>`, then `end/<name>`, or `failed/<name>`
 * for a step that did not do what it measures), and says when it is done. The host's commits and frames are read from its output against those brackets, and its
 * memory is sampled at the window step's, divided by the windows it opened (`count/<n>`). Stops the host. Rejects when the host does not start or
 * the workload does not finish in `timeoutMs`.
 *
 * @param {string} host
 * @param {string} bundle
 * @param {{ port?: number, timeoutMs?: number, stopGraceMs?: number, firstFrameMs?: number }} [options]
 */
export async function measureWorkload(
  host,
  bundle,
  { port = 51741, timeoutMs = 120_000, stopGraceMs, firstFrameMs: firstFrameWaitMs = 10_000 } = {},
) {
  const output = new HostEvents();
  let log = '';
  /** The host, once the server is listening: a port that is taken starts nothing. */
  let launched;
  /** @type {Record<string, { from?: number, to?: number, failed?: boolean }>} */
  const steps = {};
  const pss = {
    before: /** @type {number | null} */ (null),
    after: /** @type {number | null} */ (null),
  };
  const sample = () => pssMb(read(`/proc/${launched.child.pid}/smaps_rollup`) ?? '');
  let windows;
  let finished;
  const done = new Promise((resolve) => (finished = resolve));
  const server = createServer(async (request, response) => {
    const [, action, name] = /^\/(\w+)(?:\/(\w+))?$/.exec(request.url ?? '') ?? [];
    try {
      if (action === 'start') {
        for (
          let waited = 0;
          firstFrameMs(log) === null && waited < firstFrameWaitMs;
          waited += 50
        ) {
          await wait(50);
        }
        await wait(1000);
      } else if (action === 'begin' && name) {
        // What the host logged before this belongs to the step before it.
        await wait(DRAIN_MS);
        steps[name] = { from: performance.now() };
        if (name === 'window') pss.before = sample();
      } else if ((action === 'end' || action === 'failed') && name && steps[name]) {
        // A step that did not do what it measures is a measurement of nothing.
        steps[name].to = performance.now();
        steps[name].failed = action === 'failed';
        if (name === 'window') pss.after = sample();
      } else if (action === 'count' && name) {
        // How many windows the window step opens, which its memory is divided by.
        windows = Number(name);
      } else if (action === 'done') {
        finished();
      }
      response.end('ok');
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(undefined));
    });
    launched = launchHost(
      host,
      bundle,
      (chunk) => {
        log += chunk;
        output.push(String(chunk), performance.now());
      },
      { NGN_BENCH_PORT: String(port) },
    );
    const { child, failed } = launched;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`The workload did not finish in ${timeoutMs} ms.\n${log.slice(-2000)}`)),
        timeoutMs,
      );
    });
    const exited = new Promise((_, reject) =>
      child.once('exit', (code, signal) =>
        reject(
          new Error(
            `The host ended (${signal ?? code}) before the workload finished.\n${log.slice(-2000)}`,
          ),
        ),
      ),
    );
    exited.catch(() => {});
    await Promise.race([done, failed, exited, timedOut]);
    return { ...workloadMetrics({ events: output.events, steps, pss, windows }) };
  } finally {
    clearTimeout(timer);
    // The next launch listens on the same port, so it is closed before this returns.
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    if (launched) {
      await stopHost(launched.child, stopGraceMs);
      rmSync(launched.state, { recursive: true, force: true });
    }
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

/**
 * A release bundle for Linux made with the notes example's Metro config: the given file, or `entry`
 * (relative to the example) exported now into `dist/<name>`.
 *
 * @param {string | undefined} given
 * @param {string} name
 * @param {string[]} entry
 */
function findBundle(given, name, entry) {
  if (given) return existsSync(given) ? path.resolve(given) : null;
  const notes = path.join(root, 'examples', 'notes');
  const out = path.join(notes, 'dist', name);
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
      ...entry,
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

/**
 * The host, the notes bundle, the workload bundle and the number of runs, from the arguments, or
 * why they are unusable.
 */
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
  const bundle = findBundle(option(argv, '--bundle'), 'linux', []);
  if (!bundle) {
    throw new Error('No Linux bundle: the notes example did not export, or --bundle is missing.');
  }
  const workload = findBundle(option(argv, '--workload-bundle'), 'linux-bench', [
    '--entry-file',
    'bench/linux-bench.ts',
  ]);
  if (!workload) {
    throw new Error(
      'No workload bundle: examples/notes/bench/linux-bench.ts did not export, or ' +
        '--workload-bundle is missing.',
    );
  }
  return { host: path.resolve(given), bundle, workload, runs };
}

/**
 * Each run's numbers, the first a warm-up, under a display of the bench's own: a launch of the
 * notes bundle, then one of the workload's.
 */
async function launches(host, bundle, workload, runs) {
  const ticks =
    Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()) || 100;
  const stop = await startXvfb();
  const all = [];
  try {
    for (let launch = 0; launch <= runs; launch += 1) {
      const measured = await measure(host, bundle, { ticksPerSecond: ticks });
      all.push({ ...measured, ...(await measureWorkload(host, workload)) });
    }
  } finally {
    stop();
  }
  return all;
}

async function main(argv) {
  const { host, bundle, workload, runs } = inputs(argv);
  if (process.platform !== 'linux') {
    process.exitCode = runInLinuxImage(
      self,
      ['--host', host, '--bundle', bundle, '--workload-bundle', workload, '--runs', String(runs)],
      {
        mounts: [path.dirname(path.dirname(host)), path.dirname(bundle), path.dirname(workload)],
      },
    );
    return;
  }
  const budget = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'bench-linux-budget.json'), 'utf8'),
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-hbc-'));
  let all;
  try {
    // Each in a folder of its own: both are `main`, and keep their assets beside them.
    const compiled = (file, name) => {
      const folder = path.join(dir, name);
      mkdirSync(folder);
      return bytecode(host, file, folder);
    };
    all = await launches(host, compiled(bundle, 'notes'), compiled(workload, 'workload'), runs);
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
