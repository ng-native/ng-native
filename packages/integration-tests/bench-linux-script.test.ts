/**
 * `scripts/bench-linux.mjs` (`pnpm bench:linux`): the timed checks of the desktop performance budget
 * on the GTK host, read from the host's own output and from /proc, judged against
 * `scripts/bench-linux-budget.json` with `bench:macos`'s rules. And `scripts/linux-image.mjs`, which
 * runs it in the AlmaLinux 9 image from a Mac.
 */
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const bench = (await import(new URL('../../scripts/bench-linux.mjs', import.meta.url).href)) as {
  cpuSeconds(stat: string, ticksPerSecond: number): number | null;
  contextSwitches(status: string): number | null;
  pssMb(rollup: string): number | null;
  switchesOver(samples: (Map<string, number> | null)[]): number | null;
  idleRates(
    before: { cpu: number | null; at: number },
    after: { cpu: number | null; at: number },
    switches: number | null,
  ): { idleCpu: number | null; idleWakeups: number | null };
  bytecode(host: string, bundle: string, dir: string): string;
  benchEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  HostEvents: new () => {
    events: { kind: string; ms: number; at: number }[];
    push(chunk: string, at: number): void;
  };
  workloadMetrics(measured: {
    events: { kind: string; ms: number; at: number }[];
    steps: Record<string, { from?: number; to?: number; failed?: boolean }>;
    pss: { before: number | null; after: number | null };
    windows?: number;
  }): Record<string, number | null>;
  measureWorkload(
    host: string,
    bundle: string,
    options?: { port?: number; timeoutMs?: number; stopGraceMs?: number; firstFrameMs?: number },
  ): Promise<Record<string, number | null>>;
  measure(
    host: string,
    bundle: string,
    timing?: {
      settleMs?: number;
      idleMs?: number;
      sampleMs?: number;
      ticksPerSecond?: number;
      stopGraceMs?: number;
    },
  ): Promise<Record<string, number | null>>;
};
const image = (await import(new URL('../../scripts/linux-image.mjs', import.meta.url).href)) as {
  selectedImage(env?: Record<string, string | undefined>): string;
  imageArguments(
    script: string,
    args: readonly string[],
    options?: {
      mounts?: readonly string[];
      image?: string;
      env?: Record<string, string | undefined>;
      home?: string;
      uid?: number;
      gid?: number;
      cwd?: string;
    },
  ): string[];
};
const macos = (await import(new URL('../../scripts/bench-macos.mjs', import.meta.url).href)) as {
  judge(
    measured: Record<string, number | null>,
    budget: { ceilings: Record<string, number> },
  ): { ok: boolean; results: { metric: string; status: string }[] };
};

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('reading /proc', () => {
  it('reads CPU time from stat, after a command name with spaces and parentheses', () => {
    const fields = Array.from({ length: 40 }, (_, at) => String(at + 3));
    fields[11] = '250';
    fields[12] = '50';
    const stat = `4242 (ngn (gtk) host) S ${fields.slice(1).join(' ')}`;
    assert.equal(bench.cpuSeconds(stat, 100), 3);
    assert.equal(
      bench.cpuSeconds('4242 (ngn) S 1', 100),
      null,
      'a truncated stat reads as nothing',
    );
  });

  it('adds voluntary and involuntary context switches, and reads nothing without both', () => {
    const status =
      'Name:\tngn-linux\nvoluntary_ctxt_switches:\t120\nnonvoluntary_ctxt_switches:\t7\n';
    assert.equal(bench.contextSwitches(status), 127);
    assert.equal(bench.contextSwitches('voluntary_ctxt_switches:\t120\n'), null);
  });

  it('counts switches per thread, a thread that starts in the window from zero', () => {
    const before = new Map([['1', 100]]);
    const after = new Map([
      ['1', 103],
      ['3', 2],
    ]);
    assert.equal(bench.switchesOver([before, after]), 5);
  });

  it('keeps what a thread switched before it ended, as GLib ends an idle pool worker', () => {
    const samples = [
      new Map([
        ['1', 100],
        ['2', 50],
      ]),
      new Map([
        ['1', 101],
        ['2', 53],
      ]),
      new Map([['1', 104]]),
    ];
    assert.equal(bench.switchesOver(samples), 7);
  });

  it('counts a reused thread id whose count went down from zero, never negative', () => {
    assert.equal(bench.switchesOver([new Map([['2', 50]]), new Map([['2', 4]])]), 4);
  });

  it('reads nothing when a sample could not list the threads, or there is one sample', () => {
    assert.equal(bench.switchesOver([new Map([['1', 1]]), null, new Map([['1', 2]])]), null);
    assert.equal(bench.switchesOver([new Map([['1', 1]])]), null);
  });

  it('divides by the time that passed between the samples, not the time asked for', () => {
    // A 30 s window whose timer came back a second late.
    const rates = bench.idleRates({ cpu: 1, at: 1_000 }, { cpu: 1.031, at: 32_000 }, 155);
    assert.equal(rates.idleWakeups, 5);
    assert.ok(Math.abs(rates.idleCpu! - 0.1) < 1e-9, String(rates.idleCpu));
    assert.deepEqual(bench.idleRates({ cpu: 1, at: 0 }, { cpu: null, at: 0 }, 3), {
      idleCpu: null,
      idleWakeups: null,
    });
  });

  it('reads the proportional set size, not the resident one', () => {
    const rollup = '55d0-7fff ---p 0 00:00 0 [rollup]\nRss:  204800 kB\nPss:  102400 kB\n';
    assert.equal(bench.pssMb(rollup), 100);
    assert.equal(bench.pssMb('Rss: 204800 kB\n'), null);
  });

  it('measures on the cairo renderer, logging commits, with no accessibility bus', () => {
    const env = bench.benchEnv({ PATH: '/bin', GSK_RENDERER: 'vulkan' });
    assert.equal(env['GSK_RENDERER'], 'cairo');
    assert.equal(env['NGN_LOG_COMMITS'], '1');
    assert.equal(env['GTK_A11Y'], 'none');
    assert.equal(env['PATH'], '/bin');
  });
});

describe('the bundle measured', () => {
  it('compiles a JavaScript bundle with the hermesc beside the host, and keeps bytecode as it is', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-hbc-'));
    try {
      writeFileSync(
        path.join(dir, 'hermesc'),
        '#!/usr/bin/env bash\nwhile [ "$1" != -out ]; do shift; done\necho "$@" > "$2"\n',
      );
      chmodSync(path.join(dir, 'hermesc'), 0o755);
      const host = path.join(dir, 'ngn-linux');
      const out = bench.bytecode(host, '/b/main.js', dir);
      assert.equal(out, path.join(dir, 'main.hbc'));
      assert.equal(readFileSync(out, 'utf8').trim(), `-out ${out} /b/main.js`);
      assert.equal(bench.bytecode(host, '/b/main.hbc', dir), '/b/main.hbc');
      assert.throws(
        () => bench.bytecode('/nowhere/ngn-linux', '/b/main.js', dir),
        /no hermesc beside the host/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the export's assets beside the bytecode the host launches", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-hbc-'));
    try {
      writeFileSync(
        path.join(dir, 'hermesc'),
        '#!/usr/bin/env bash\nwhile [ "$1" != -out ]; do shift; done\necho ok > "$2"\n',
      );
      chmodSync(path.join(dir, 'hermesc'), 0o755);
      const exported = path.join(dir, 'export');
      mkdirSync(path.join(exported, 'assets'), { recursive: true });
      writeFileSync(path.join(exported, 'main.js'), '');
      writeFileSync(path.join(exported, 'assets', 'logo.png'), 'png');
      const out = path.join(dir, 'out');
      mkdirSync(out);
      const launched = bench.bytecode(
        path.join(dir, 'ngn-linux'),
        path.join(exported, 'main.js'),
        out,
      );
      assert.equal(
        readFileSync(path.join(path.dirname(launched), 'assets', 'logo.png'), 'utf8'),
        'png',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Linux budget', () => {
  const budget = JSON.parse(
    readFileSync(new URL('../../scripts/bench-linux-budget.json', import.meta.url), 'utf8'),
  ) as { ceilings: Record<string, number> };

  it("holds the spec's provisional ceilings, and fails a run that measured nothing", () => {
    assert.deepEqual(budget.ceilings, {
      launchMs: 800,
      idleCpu: 0.1,
      idleWakeups: 5,
      memoryMb: 110,
      hostMb: 30,
      mountMs: 15,
      scrollFrameMs: 10,
      resizeCommitMs: 8,
      resizeCommitsPerFrame: 1,
      animationCommitsPerFrame: 0.1,
      extraWindowMb: 20,
    });
    const { ok, results } = macos.judge({}, budget);
    assert.equal(ok, false);
    // Each waiver names its pull request and why; only a waived metric is let through.
    const waived =
      (budget as { waivers?: { metric: string; pr: string; reason: string }[] }).waivers ?? [];
    for (const waiver of waived) assert.ok(waiver.pr && waiver.reason, waiver.metric);
    for (const result of results) {
      const expected = waived.some((one) => one.metric === result.metric) ? 'waived' : 'missing';
      assert.equal(result.status, expected, result.metric);
    }
  });
});

describe('what the host logged, and when', () => {
  it('reads commits and frames from each line, with the time its chunk arrived', () => {
    const output = new bench.HostEvents();
    output.push('[ngn] commit 2.5 ms\n[ngn] frame 7.1 ms\nsomething else\n', 10);
    output.push('[ngn] first frame 120 ms after launch\n', 20);
    assert.deepEqual(output.events, [
      { kind: 'commit', ms: 2.5, at: 10 },
      { kind: 'frame', ms: 7.1, at: 10 },
    ]);
  });

  it('holds a line that a chunk ends in the middle of until the rest comes, at the later time', () => {
    const output = new bench.HostEvents();
    output.push('[ngn] frame 3', 5);
    assert.deepEqual(output.events, []);
    output.push('.5 ms\n[ngn] commit 1 ms\n', 9);
    assert.deepEqual(output.events, [
      { kind: 'frame', ms: 3.5, at: 9 },
      { kind: 'commit', ms: 1, at: 9 },
    ]);
  });
});

describe('the workload metrics', () => {
  const event = (kind: string, ms: number, at: number) => ({ kind, ms, at });
  const steps = {
    mount: { from: 100, to: 200 },
    scroll: { from: 200, to: 300 },
    resize: { from: 300, to: 400 },
    animate: { from: 400, to: 500 },
  };
  const pss = { before: 100, after: 118.5 };

  it('takes each step from what was logged inside it, and not from another step', () => {
    const metrics = bench.workloadMetrics({
      events: [
        event('commit', 99, 50), // before the first step
        event('commit', 3, 120),
        event('commit', 12, 150), // the mount's slowest commit
        event('commit', 40, 250), // a commit while scrolling is not the mount's
        event('frame', 4, 210),
        event('frame', 9, 230),
        event('frame', 6, 260),
        event('frame', 90, 120), // a frame while mounting is not a scroll frame
        event('commit', 2, 310),
        event('commit', 5, 330),
        event('commit', 7.5, 350),
        event('frame', 3, 315),
        event('frame', 3, 335),
        event('frame', 3, 355),
        event('frame', 3, 375),
        event('commit', 1, 410), // the commit that starts the animation
        event('frame', 2, 420),
        event('frame', 2, 440),
        event('frame', 2, 460),
        event('frame', 2, 480),
        event('commit', 60, 550), // after the last step
      ],
      steps,
      pss,
      windows: 4,
    });
    assert.deepEqual(metrics, {
      mountMs: 12,
      scrollFrameMs: 6,
      resizeCommitMs: 7.5,
      resizeCommitsPerFrame: 0.75,
      animationCommitsPerFrame: 0.25,
      extraWindowMb: 4.625,
    });
  });

  it('counts a commit at a step end, and not one at its start', () => {
    const metrics = bench.workloadMetrics({
      events: [event('commit', 9, 100), event('commit', 8, 200)],
      steps: { mount: { from: 100, to: 200 } },
      pss: { before: null, after: null },
    });
    assert.equal(metrics['mountMs'], 8);
  });

  it('divides the memory by the windows opened, and reads nothing without a count', () => {
    const base = { events: [], steps: {}, pss: { before: 100, after: 140 } };
    assert.equal(bench.workloadMetrics({ ...base, windows: 4 })['extraWindowMb'], 10);
    assert.equal(bench.workloadMetrics(base)['extraWindowMb'], null);
    assert.equal(bench.workloadMetrics({ ...base, windows: 0 })['extraWindowMb'], null);
  });

  it('reads nothing from a step that said it did not do what it measures', () => {
    const metrics = bench.workloadMetrics({
      events: [event('commit', 12, 150), event('commit', 2, 350), event('frame', 1, 360)],
      steps: {
        mount: { from: 100, to: 200, failed: true },
        resize: { from: 300, to: 400 },
        window: { from: 500, to: 600, failed: true },
      },
      pss: { before: 100, after: 118 },
      windows: 4,
    });
    assert.equal(metrics['mountMs'], null);
    assert.equal(metrics['extraWindowMb'], null, 'a window that did not open grew nothing');
    assert.equal(metrics['resizeCommitMs'], 2, 'the steps that worked are read');
  });

  it('reads nothing for a step that logged nothing, or that never ended, so the run fails', () => {
    const metrics = bench.workloadMetrics({
      events: [event('commit', 5, 150)],
      steps: { mount: { from: 100 }, scroll: { from: 200, to: 300 } },
      pss: { before: 100, after: null },
    });
    assert.deepEqual(metrics, {
      mountMs: null,
      scrollFrameMs: null,
      resizeCommitMs: null,
      resizeCommitsPerFrame: null,
      animationCommitsPerFrame: null,
      extraWindowMb: null,
    });
    // Commits with no frame between them are not a ratio.
    const noFrames = bench.workloadMetrics({
      events: [event('commit', 5, 350)],
      steps,
      pss,
    });
    assert.equal(noFrames['resizeCommitsPerFrame'], null);
  });
});

describe('a host that cannot start', () => {
  it('rejects the measurement instead of ending the process', async () => {
    await assert.rejects(
      bench.measure('/nowhere/ngn-linux', '/b/main.hbc', { settleMs: 50, idleMs: 50 }),
      /ENOENT/,
    );
  });
});

describe('a host that ignores SIGTERM', () => {
  it('is killed, and gone before the measurement returns', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-'));
    const pidFile = path.join(dir, 'pid');
    let pid: number | undefined;
    try {
      const host = path.join(dir, 'ngn-linux');
      writeFileSync(
        host,
        [
          '#!/usr/bin/env bash',
          "trap '' TERM",
          `echo $$ > '${pidFile}'`,
          "echo '[ngn] first frame 10 ms after launch' >&2",
          'exec sleep 600',
        ].join('\n'),
      );
      chmodSync(host, 0o755);
      await bench.measure(host, path.join(dir, 'main.js'), {
        settleMs: 100,
        idleMs: 100,
        stopGraceMs: 300,
      });
      pid = Number(readFileSync(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
    } finally {
      try {
        if (pid) process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// /proc is Linux's: the measurement runs against a stand-in host on Linux only.
describe('measuring a host', { skip: process.platform !== 'linux' }, () => {
  it('reads the first frame, idle CPU and wakeups, and memory of a running host', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-'));
    try {
      const host = path.join(dir, 'ngn-linux');
      writeFileSync(
        host,
        [
          '#!/usr/bin/env bash',
          '[ "$GSK_RENDERER" = cairo ] && [ "$NGN_TESTS" = 1 ] || exit 3',
          "echo '[ngn] commit 2.5 ms' >&2",
          "echo '[ngn] first frame 120 ms after launch' >&2",
          'exec sleep 30',
        ].join('\n'),
      );
      chmodSync(host, 0o755);
      const measured = await bench.measure(host, path.join(dir, 'main.js'), {
        settleMs: 100,
        idleMs: 1000,
      });
      assert.equal(measured['launchMs'], 120);
      assert.equal(measured['commitMs'], 2.5);
      assert.ok(
        measured['idleCpu'] !== null && measured['idleCpu']! < 5,
        String(measured['idleCpu']),
      );
      assert.ok(measured['idleWakeups'] !== null && measured['idleWakeups']! < 5);
      assert.ok(measured['memoryMb'] !== null && measured['memoryMb']! > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts the wakeups of a thread that ends in the window', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-'));
    try {
      const host = path.join(dir, 'ngn-linux');
      // A worker thread waking 20 times a second for the first half of the window, then ending.
      writeFileSync(
        host,
        [
          `#!${process.execPath}`,
          "const { Worker } = require('node:worker_threads');",
          "console.error('[ngn] first frame 10 ms after launch');",
          'setTimeout(() => new Worker(',
          '  "const t = setInterval(() => {}, 50); setTimeout(() => clearInterval(t), 1500);",',
          '  { eval: true },',
          '), 100);',
          'setTimeout(() => {}, 600_000);',
        ].join('\n'),
      );
      chmodSync(host, 0o755);
      const measured = await bench.measure(host, path.join(dir, 'main.js'), {
        settleMs: 0,
        idleMs: 3000,
      });
      assert.ok(
        measured['idleWakeups'] !== null && measured['idleWakeups']! > 5,
        String(measured['idleWakeups']),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A stand-in for the workload's app: logs what the host would, and asks the bench's server to start,
 * to bracket each step and to finish, as examples/notes/bench/linux-bench.ts does.
 */
const workloadHost = (steps: string[], options: { crashBeforeDone?: boolean } = {}) =>
  [
    `#!${process.execPath}`,
    "const http = require('node:http');",
    'const port = process.env.NGN_BENCH_PORT;',
    "const tell = (path) => new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/${path}`, (r) => { r.resume(); r.on('end', resolve); }).on('error', reject));",
    'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
    "console.error('[ngn] first frame 50 ms after launch');",
    '(async () => {',
    "  await tell('start');",
    "  await tell('count/2');",
    `  for (const entry of ${JSON.stringify(steps)}) {`,
    '    const [name, ...lines] = entry.split("|");',
    '    const failed = name.startsWith("!");',
    '    const step = failed ? name.slice(1) : name;',
    '    await tell(`begin/${step}`);',
    '    for (const line of lines) console.error(line);',
    '    await sleep(100);',
    '    await tell(`${failed ? "failed" : "end"}/${step}`);',
    '  }',
    options.crashBeforeDone ? '  process.exit(7);' : "  await tell('done');",
    '  setTimeout(() => {}, 600_000);',
    '})();',
  ].join('\n');

describe('measuring the workload', { skip: process.platform !== 'linux' }, () => {
  const measureOf = async (script: string, port: number, options = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-workload-'));
    try {
      const host = path.join(dir, 'ngn-linux');
      writeFileSync(host, script);
      chmodSync(host, 0o755);
      return await bench.measureWorkload(host, path.join(dir, 'main.hbc'), {
        port,
        timeoutMs: 20_000,
        stopGraceMs: 300,
        firstFrameMs: 5000,
        ...options,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('brackets each step through the server and reads the host output inside it', async () => {
    const metrics = await measureOf(
      workloadHost([
        'mount|[ngn] commit 4 ms|[ngn] commit 11.5 ms',
        'scroll|[ngn] frame 2 ms|[ngn] frame 8 ms|[ngn] frame 4 ms',
        'resize|[ngn] commit 3 ms|[ngn] frame 1 ms|[ngn] commit 6 ms|[ngn] frame 1 ms',
        'animate|[ngn] commit 2 ms|[ngn] frame 1 ms|[ngn] frame 1 ms|[ngn] frame 1 ms|[ngn] frame 1 ms',
        'window',
      ]),
      await freePort(),
    );
    assert.equal(metrics['mountMs'], 11.5);
    assert.equal(metrics['scrollFrameMs'], 4);
    assert.equal(metrics['resizeCommitMs'], 6);
    assert.equal(metrics['resizeCommitsPerFrame'], 1);
    assert.equal(metrics['animationCommitsPerFrame'], 0.25);
    // The stand-in does not grow, but its memory was sampled at both ends of the window step.
    assert.ok(metrics['extraWindowMb'] !== null && Math.abs(metrics['extraWindowMb']!) < 5);
  });

  it('reads a step the app reports as failed as no measurement', async () => {
    const metrics = await measureOf(
      workloadHost([
        'mount|[ngn] commit 4 ms',
        'scroll|[ngn] frame 2 ms',
        'resize|[ngn] commit 3 ms|[ngn] frame 1 ms',
        '!window',
      ]),
      await freePort(),
    );
    assert.equal(metrics['mountMs'], 4);
    assert.equal(metrics['extraWindowMb'], null);
  });

  it('rejects, with what the host said, when the host ends before the workload does', async () => {
    await assert.rejects(
      measureOf(
        workloadHost(['mount|[ngn] commit 1 ms'], { crashBeforeDone: true }),
        await freePort(),
      ),
      /ended \(7\) before the workload finished[\s\S]*first frame/,
    );
  });

  it('starts no host when the port is taken', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const { port } = taken.address() as { port: number };
    const dir = mkdtempSync(path.join(tmpdir(), 'bench-linux-port-'));
    const startedFile = path.join(dir, 'started');
    try {
      const script = workloadHost([]).replace(
        "console.error('[ngn] first frame",
        `require('node:fs').writeFileSync(${JSON.stringify(startedFile)}, ''); console.error('[ngn] first frame`,
      );
      await assert.rejects(measureOf(script, port), /EADDRINUSE/);
      // Long enough for a host that had been started to have run its first line.
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(existsSync(startedFile), false);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a workload that does not finish in time', async () => {
    await assert.rejects(
      measureOf(workloadHost(['mount|[ngn] commit 1 ms']), await freePort(), { timeoutMs: 100 }),
      /did not finish in 100 ms/,
    );
  });
});

describe('running in the AlmaLinux 9 image', () => {
  it('mounts the checkout and each folder at its own path, as the caller', () => {
    const args = image.imageArguments('/home/me/repo/scripts/bench-linux.mjs', ['--runs', '1'], {
      home: path.resolve(process.cwd(), '../../..'),
      mounts: [process.cwd()],
      env: {},
      uid: 501,
      gid: 20,
      cwd: '/x',
    });
    assert.deepEqual(args.slice(0, 5), ['run', '--rm', '--init', '--user', '501:20']);
    assert.ok(args.includes(`${process.cwd()}:${process.cwd()}`));
    assert.deepEqual(args.slice(-5), [
      'ngn-el9',
      'node',
      '/home/me/repo/scripts/bench-linux.mjs',
      '--runs',
      '1',
    ]);
  });

  it('runs in the image NGN_LINUX_IMAGE names, such as the Fedora variant', () => {
    const options = { home: path.resolve(process.cwd(), '../../..'), mounts: [], uid: 1, gid: 1 };
    const run = (env: Record<string, string | undefined>) =>
      image.imageArguments('/s.mjs', [], { ...options, env }).at(-3);
    assert.equal(run({}), 'ngn-el9');
    assert.equal(run({ NGN_LINUX_IMAGE: 'ngn-fedora' }), 'ngn-fedora');
    assert.equal(
      image
        .imageArguments('/s.mjs', [], {
          ...options,
          image: 'ngn-el9',
          env: { NGN_LINUX_IMAGE: 'ngn-fedora' },
        })
        .at(-3),
      'ngn-el9',
      'an image passed in wins',
    );
    // An empty name, or one docker would read as an option, fails rather than running in the default.
    for (const bad of ['', '--privileged', 'ngn fedora']) {
      assert.throws(() => image.selectedImage({ NGN_LINUX_IMAGE: bad }), /not an image name/);
    }
  });

  it('refuses a folder the container cannot see, rather than running on an empty mount', () => {
    assert.throws(
      () => image.imageArguments('/s.mjs', [], { home: '/nowhere-home', mounts: ['/tmp/out'] }),
      /sees only folders under \/nowhere-home/,
    );
  });
});
