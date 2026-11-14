/**
 * `scripts/bench-macos.mjs` (`pnpm bench:macos`): the timed checks of the desktop performance
 * budget, read from the desktop host's own output and the OS's tools, and judged against
 * `scripts/bench-macos-budget.json`. It fails closed: a metric it could not measure fails the run,
 * as a breach does, unless the budget file waives it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type Result = { metric: string; value: number | null; ceiling: number; status: string };
const script = new URL('../../scripts/bench-macos.mjs', import.meta.url);
const bench = (await import(script.href)) as {
  firstFrameMs(log: string): number | null;
  commitMs(log: string): number | null;
  idleFromCounter(output: string): { cpu: number; wakeups: number } | null;
  median(values: (number | null)[]): number | null;
  summarize(
    runs: Record<string, number | null>[],
    warmups?: number,
  ): { cold: Record<string, number | null>[]; judged: Record<string, number | null> };
  hostEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  footprintMb(output: string): number | null;
  judge(
    measured: Record<string, number | null>,
    budget: {
      ceilings: Record<string, number>;
      waivers?: { metric: string; reason: string; pr: string }[];
    },
  ): { results: Result[]; ok: boolean };
};

describe('reading the host and the OS', () => {
  it('reads the first frame the host logs, and nothing from a log without one', () => {
    const log = '[ngn] loading bundle\n[ngn] first frame 126 ms after launch\n';
    assert.equal(bench.firstFrameMs(log), 126);
    assert.equal(bench.firstFrameMs('[ngn] loading bundle\n'), null);
  });

  it('reads the slowest commit the host logs', () => {
    const log = '[ngn] commit 4.2 ms\n[ngn] commit 11.5 ms\n[ngn] commit 3 ms\n';
    assert.equal(bench.commitMs(log), 11.5);
    assert.equal(bench.commitMs(''), null);
  });

  it('reads CPU and interrupt wakeups from the counter helper, and nothing from a failed run', () => {
    assert.deepEqual(bench.idleFromCounter('cpu 0.012\nwakeups 3.50\n'), {
      cpu: 0.012,
      wakeups: 3.5,
    });
    assert.equal(bench.idleFromCounter('cpu 0.1\n'), null);
    assert.equal(bench.idleFromCounter('rusage: No such process\n'), null);
  });

  it('asks the host to log its commit times', () => {
    assert.equal(bench.hostEnv({ PATH: '/bin' }).NGN_LOG_COMMITS, '1');
    assert.equal(bench.hostEnv({ PATH: '/bin' }).PATH, '/bin');
  });

  it('reads phys_footprint in megabytes, in whichever unit footprint prints', () => {
    assert.equal(bench.footprintMb('ngn-macos [4242]: 64-bit\tFootprint: 71 MB'), 71);
    assert.equal(bench.footprintMb('phys_footprint: 81920 KB'), 80);
    assert.equal(bench.footprintMb('phys_footprint: 1.5 GB'), 1536);
    assert.equal(bench.footprintMb('nothing here'), null);
  });
});

describe('the cold launch rule', () => {
  it('takes the median, and a missing value among the values is missing', () => {
    assert.equal(bench.median([3, 1, 2]), 2);
    assert.equal(bench.median([4, 1, 3, 2]), 2.5);
    assert.equal(bench.median([1, null, 2]), null);
    assert.equal(bench.median([]), null);
  });

  it('reports the warm-up launch apart and judges the median of the rest', () => {
    const runs = [
      { launchMs: 623, idleCpu: 0 },
      { launchMs: 240, idleCpu: 0 },
      { launchMs: 170, idleCpu: 0.2 },
      { launchMs: 200, idleCpu: 0 },
    ];
    const { cold, judged } = bench.summarize(runs, 1);
    assert.deepEqual(cold, [runs[0]]);
    assert.deepEqual(judged, { launchMs: 200, idleCpu: 0 });
  });

  it('judges nothing when every launch was a warm-up', () => {
    assert.deepEqual(bench.summarize([{ launchMs: 1 }], 1).judged, {});
  });
});

describe('judging against the budget', () => {
  const budget = { ceilings: { launchMs: 500, idleCpu: 0.1, memoryMb: 80 } };

  it('passes a metric at or under its ceiling and fails one over it', () => {
    const { results, ok } = bench.judge({ launchMs: 500, idleCpu: 0.2, memoryMb: 70 }, budget);
    assert.deepEqual(
      results.map((result) => [result.metric, result.status]),
      [
        ['launchMs', 'pass'],
        ['idleCpu', 'fail'],
        ['memoryMb', 'pass'],
      ],
    );
    assert.equal(ok, false);
  });

  it('fails a metric it could not measure, rather than reading it as a pass', () => {
    const { results, ok } = bench.judge({ launchMs: 100, idleCpu: 0, memoryMb: null }, budget);
    assert.equal(results.find((result) => result.metric === 'memoryMb')?.status, 'missing');
    assert.equal(ok, false);
  });

  it('lets a waiver with a reason and a pull request stand for a breach', () => {
    const waived = {
      ...budget,
      waivers: [{ metric: 'idleCpu', reason: 'the clock ticks', pr: '#1500' }],
    };
    const { results, ok } = bench.judge({ launchMs: 100, idleCpu: 0.3, memoryMb: 70 }, waived);
    assert.equal(results.find((result) => result.metric === 'idleCpu')?.status, 'waived');
    assert.equal(ok, true);
  });

  it('refuses a waiver without a reason or a pull request', () => {
    const bad = { ...budget, waivers: [{ metric: 'idleCpu', reason: '', pr: '' }] };
    assert.throws(() => bench.judge({ launchMs: 1, idleCpu: 0, memoryMb: 1 }, bad), /waiver/);
  });

  it('has a ceiling in the budget file for every metric the script measures', () => {
    const file = JSON.parse(
      readFileSync(new URL('../../scripts/bench-macos-budget.json', import.meta.url), 'utf8'),
    ) as { ceilings: Record<string, number> };
    assert.deepEqual(Object.keys(file.ceilings).sort(), [
      'commitMs',
      'idleCpu',
      'idleWakeups',
      'launchMs',
      'memoryMb',
    ]);
  });
});
