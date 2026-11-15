#!/usr/bin/env node
/**
 * `pnpm bench:macos`: the timed checks of the desktop performance budget, run against the desktop
 * host and a release bundle of the canary on this Mac.
 *
 *   pnpm bench:macos                     # export the canary, then measure
 *   pnpm bench:macos --bundle main.hbc   # measure a bundle already exported
 *   pnpm bench:macos --host path/to/ngn-macos
 *
 * It measures, each against its ceiling in `bench-macos-budget.json`:
 * - `launchMs`: launch to the first frame, as the host logs it (`[ngn] first frame N ms`).
 * - `idleCpu` and `idleWakeups`: CPU and interrupt wakeups per second over 30 s once settled,
 *   from `proc_pid_rusage` through `macos-wakeups.c`, compiled with `cc` on demand. It counts
 *   timer wakeups, which `top`'s IDLEW misses.
 * - `memoryMb`: `phys_footprint` of the first window, from `footprint`.
 * - `commitMs`: the slowest commit the host logs (`[ngn] commit N ms`).
 *
 * The first launch of a bundle is cold: `--runs N` (default 3) launches follow one warm-up launch,
 * which is reported on its own line and not judged; each metric is the median of the N.
 *
 * It fails closed: no host, no bundle, or a metric it could not read fails the run, as a breach
 * does. A breach passes only where the budget file waives it, with the reason and the pull request
 * that raised the ceiling. The release checklist (verify-release) runs it before every release.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** @param {string} log */
export function firstFrameMs(log) {
  const match = /\[ngn\] first frame ([\d.]+) ms/.exec(log);
  return match ? Number(match[1]) : null;
}

/** The slowest commit the host logs. @param {string} log */
export function commitMs(log) {
  const times = [...log.matchAll(/\[ngn\] commit ([\d.]+) ms/g)].map((match) => Number(match[1]));
  return times.length ? Math.max(...times) : null;
}

/**
 * CPU and interrupt wakeups per second from `macos-wakeups.c`, which reads `proc_pid_rusage`.
 * `top`'s IDLEW misses timer wakeups, which this counts.
 *
 * @param {string} output
 */
export function idleFromCounter(output) {
  const cpu = /^cpu ([\d.]+)$/m.exec(output);
  const wakeups = /^wakeups ([\d.]+)$/m.exec(output);
  return cpu && wakeups ? { cpu: Number(cpu[1]), wakeups: Number(wakeups[1]) } : null;
}

/** The host's environment: the caller's, with commit logging on. @param {NodeJS.ProcessEnv} env */
export function hostEnv(env) {
  return { ...env, NGN_LOG_COMMITS: '1' };
}

/** @param {(number | null)[]} values */
export function median(values) {
  if (!values.length || values.some((value) => value === null)) return null;
  const sorted = /** @type {number[]} */ (values).toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The cold launch rule: the first `warmups` launches are reported, not judged (a newly exported
 * bundle compiles and caches on its first launch), and each metric is the median of the rest. A
 * metric missing from any judged launch is missing.
 *
 * @param {Record<string, number | null>[]} runs
 */
export function summarize(runs, warmups = 1) {
  const judgedRuns = runs.slice(warmups);
  const metrics = new Set(judgedRuns.flatMap((run) => Object.keys(run)));
  return {
    cold: runs.slice(0, warmups),
    judged: Object.fromEntries(
      [...metrics].map((metric) => [metric, median(judgedRuns.map((run) => run[metric] ?? null))]),
    ),
  };
}

/** `phys_footprint` in megabytes, from `footprint <pid>`. @param {string} output */
export function footprintMb(output) {
  const match = /(?:Footprint|phys_footprint):\s*([\d.]+)\s*(KB|MB|GB)/i.exec(output);
  if (!match) return null;
  const scale = { KB: 1 / 1024, MB: 1, GB: 1024 }[match[2].toUpperCase()];
  return Number(match[1]) * scale;
}

/**
 * Each metric against its ceiling: `pass`, `fail`, `missing` (not measured) or `waived`.
 *
 * @param {Record<string, number | null>} measured
 * @param {{ ceilings: Record<string, number>, waivers?: { metric: string, reason: string, pr: string }[] }} budget
 */
export function judge(measured, budget) {
  const waivers = new Map();
  for (const waiver of budget.waivers ?? []) {
    if (!waiver.reason?.trim() || !waiver.pr?.trim()) {
      throw new Error(`A waiver of ${waiver.metric} needs a reason and the pull request.`);
    }
    waivers.set(waiver.metric, waiver);
  }
  const results = Object.entries(budget.ceilings).map(([metric, ceiling]) => {
    const value = measured[metric] ?? null;
    let status = value === null ? 'missing' : value <= ceiling ? 'pass' : 'fail';
    if (status !== 'pass' && waivers.has(metric)) status = 'waived';
    return { metric, value, ceiling, status };
  });
  return {
    results,
    ok: results.every((result) => result.status !== 'fail' && result.status !== 'missing'),
  };
}

/**
 * The host binary: `--host`, `NGN_DESKTOP_HOST`, or the most recently built one in the per-user
 * cache, which `ng-native-desktop run` builds per app with the libraries that app links.
 */
function findHost(given) {
  if (given) return existsSync(given) ? given : null;
  if (process.env.NGN_DESKTOP_HOST) return process.env.NGN_DESKTOP_HOST;
  const cache =
    process.env.NGN_DESKTOP_CACHE ??
    path.join(homedir(), 'Library', 'Caches', 'ng-native', 'desktop');
  if (!existsSync(cache)) return null;
  const found = readdirSync(cache, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(path.join('appkit', 'ngn-macos')))
    .map((file) => path.join(cache, file))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  return found.at(-1) ?? null;
}

/** A release bundle of the canary for macOS: `--bundle`, or one exported now. */
function findBundle(given) {
  if (given) return existsSync(given) ? given : null;
  const canary = path.join(root, 'examples', 'canary');
  const out = path.join(canary, 'dist', 'macos');
  const exported = spawnSync('npx', ['expo', 'export', '-p', 'macos', '--output-dir', out], {
    cwd: canary,
    stdio: 'inherit',
  });
  if (exported.status !== 0) return null;
  const dir = path.join(out, '_expo', 'static', 'js', 'macos');
  const bundle = existsSync(dir) ? readdirSync(dir).find((file) => file.endsWith('.hbc')) : null;
  return bundle ? path.join(dir, bundle) : null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The wakeup counter, compiled into `dir` with the system C compiler. */
function buildCounter(dir) {
  const out = path.join(dir, 'macos-wakeups');
  const built = spawnSync('cc', ['-O1', '-o', out, path.join(root, 'scripts', 'macos-wakeups.c')], {
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error('Could not compile scripts/macos-wakeups.c with cc.');
  return out;
}

/** Launch the host on `bundle`, measure it, and quit it. */
async function measure(host, bundle, counterBinary) {
  const child = spawn(host, [bundle, '--title', 'bench:macos'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: hostEnv(process.env),
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  try {
    for (let waited = 0; firstFrameMs(log) === null && waited < 10_000; waited += 100)
      await wait(100);
    await wait(5_000);
    const pid = String(child.pid);
    const counter = spawnSync(counterBinary, [pid, '30'], { encoding: 'utf8' });
    const idle = idleFromCounter(counter.stdout ?? '');
    const footprint = spawnSync('footprint', [pid], { encoding: 'utf8' });
    return {
      launchMs: firstFrameMs(log),
      idleCpu: idle?.cpu ?? null,
      idleWakeups: idle?.wakeups ?? null,
      memoryMb: footprintMb(footprint.stdout ?? ''),
      commitMs: commitMs(log),
    };
  } finally {
    child.kill('SIGTERM');
  }
}

async function main(argv) {
  const option = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  if (process.platform !== 'darwin') throw new Error('bench:macos runs on a Mac.');
  const budget = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'bench-macos-budget.json'), 'utf8'),
  );
  const host = findHost(option('--host'));
  if (!host) {
    throw new Error(
      'No desktop host binary. Build one with `npm run macos` in an app (it lands in the per-user ' +
        'cache), or pass --host or NGN_DESKTOP_HOST.',
    );
  }
  const bundle = findBundle(option('--bundle'));
  if (!bundle)
    throw new Error('No macOS bundle: the canary did not export, or --bundle is missing.');
  const runs = Number(option('--runs') ?? 3);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs takes a whole number, 1 or more.');
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-macos-'));
  const all = [];
  try {
    const counter = buildCounter(dir);
    for (let launch = 0; launch <= runs; launch += 1)
      all.push(await measure(host, bundle, counter));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const { cold, judged } = summarize(all, 1);
  console.log(`cold      (warm-up, not judged) ${JSON.stringify(cold[0])}`);
  const { results, ok } = judge(judged, budget);
  for (const { metric, value, ceiling, status } of results) {
    console.log(`${status.padEnd(8)} ${metric.padEnd(12)} ${value ?? '-'} (ceiling ${ceiling})`);
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
