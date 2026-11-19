/**
 * `scripts/bench-linux.mjs` (`pnpm bench:linux`): the timed checks of the desktop performance budget
 * on the GTK host, read from the host's own output and from /proc, judged against
 * `scripts/bench-linux-budget.json` with `bench:macos`'s rules. And `scripts/linux-image.mjs`, which
 * runs it in the AlmaLinux 9 image from a Mac.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const bench = (await import(new URL('../../scripts/bench-linux.mjs', import.meta.url).href)) as {
  cpuSeconds(stat: string, ticksPerSecond: number): number | null;
  contextSwitches(status: string): number | null;
  pssMb(rollup: string): number | null;
  switchesBetween(before: Map<string, number>, after: Map<string, number>): number;
  bytecode(host: string, bundle: string, dir: string): string;
  benchEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  measure(
    host: string,
    bundle: string,
    timing?: { settleMs?: number; idleMs?: number; ticksPerSecond?: number },
  ): Promise<Record<string, number | null>>;
};
const image = (await import(new URL('../../scripts/linux-image.mjs', import.meta.url).href)) as {
  imageArguments(
    script: string,
    args: readonly string[],
    options?: {
      mounts?: readonly string[];
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

  it('counts switches per thread, so a thread that ends or starts in the window takes none away', () => {
    const before = new Map([
      ['1', 100],
      ['2', 50],
    ]);
    // Thread 2 ended, thread 3 started.
    const after = new Map([
      ['1', 103],
      ['3', 2],
    ]);
    assert.equal(bench.switchesBetween(before, after), 5);
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

describe('a host that cannot start', () => {
  it('rejects the measurement instead of ending the process', async () => {
    await assert.rejects(
      bench.measure('/nowhere/ngn-linux', '/b/main.hbc', { settleMs: 50, idleMs: 50 }),
      /ENOENT/,
    );
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
});

describe('running in the AlmaLinux 9 image', () => {
  it('mounts the checkout and each folder at its own path, as the caller', () => {
    const args = image.imageArguments('/home/me/repo/scripts/bench-linux.mjs', ['--runs', '1'], {
      home: path.resolve(process.cwd(), '../../..'),
      mounts: [process.cwd()],
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

  it('refuses a folder the container cannot see, rather than running on an empty mount', () => {
    assert.throws(
      () => image.imageArguments('/s.mjs', [], { home: '/nowhere-home', mounts: ['/tmp/out'] }),
      /sees only folders under \/nowhere-home/,
    );
  });
});
