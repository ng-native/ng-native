import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const script = new URL('../../scripts/coverage.mjs', import.meta.url);
const reports = ['native.info', 'web.info', 'testing.info', 'browser/lcov.info'];
const lcov = (hits = 1, source = '../fabric/src/engine.ts') =>
  `TN:\nSF:${source}\nFN:1,run\nFNDA:${hits},run\nFNF:1\nFNH:${hits > 0 ? 1 : 0}\n` +
  `BRDA:1,0,0,${hits}\nBRDA:1,0,1,-\nBRF:2\nBRH:${hits > 0 ? 1 : 0}\n` +
  `DA:1,${hits},checksum\nLF:1\nLH:${hits > 0 ? 1 : 0}\nend_of_record\n`;

function workspace(check: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'coverage-script-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'coverage/browser'), { recursive: true });
    copyFileSync(script, path.join(root, 'scripts/coverage.mjs'));
    for (const report of reports) writeFileSync(path.join(root, 'coverage', report), lcov());
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function cli(root: string, args = ['--report', '--min', '95'], stub = false) {
  return spawnSync(
    process.execPath,
    [
      ...(stub ? ['--import', path.join(root, 'suites.mjs')] : []),
      path.join(root, 'scripts/coverage.mjs'),
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

function summary(root: string) {
  return JSON.parse(readFileSync(path.join(root, 'coverage/summary.json'), 'utf8')) as {
    overall: number;
    files: {
      file: string;
      lines: number;
      covered: number;
      branches: number;
      branchesCovered: number;
    }[];
  };
}

function rejects(root: string, message: RegExp, args?: string[], stub = false) {
  const result = cli(root, args, stub);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, message);
  assert.equal(existsSync(path.join(root, 'coverage/summary.json')), false);
}

// Replace only the suite processes in a child: the script's CLI, paths, parsing and reporting run
// unchanged. No compiler or Chromium is needed to simulate a producer failing to write its report.
function suites(root: string, mode: string) {
  writeFileSync(
    path.join(root, 'suites.mjs'),
    `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(root)};
const reports = ${JSON.stringify(reports)};
let call = 0;
childProcess.spawnSync = () => {
  const report = path.join(root, 'coverage', reports[call]);
  appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(reports.map(file => existsSync(path.join(root, 'coverage', file)))) + '\\n');
  mkdirSync(path.dirname(report), { recursive: true });
  const mode = ${JSON.stringify(mode)};
  if (mode !== 'missing') writeFileSync(report, mode === 'invalid' ? ${JSON.stringify(lcov(0).replace('end_of_record\n', ''))} : ${JSON.stringify(lcov(0))});
  call++;
  return { status: mode === 'failure' && call === 4 ? 2 : 0 };
};
syncBuiltinESMExports();
`,
  );
}

describe('coverage script integrity', () => {
  it('merges complete Node and browser records, including CRLF and unexecuted branches', () => {
    workspace((root) => {
      writeFileSync(
        path.join(root, 'coverage/browser/lcov.info'),
        lcov(0).replaceAll('\n', '\r\n'),
      );
      const result = cli(root);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(summary(root).overall, 100);
      assert.deepEqual(
        summary(root).files.map(({ lines, covered, branches, branchesCovered }) => ({
          lines,
          covered,
          branches,
          branchesCovered,
        })),
        [{ lines: 1, covered: 1, branches: 2, branchesCovered: 1 }],
      );
    });
  });

  for (const report of reports) {
    it(`rejects a missing ${report} and removes a previous summary`, () => {
      workspace((root) => {
        assert.equal(cli(root).status, 0);
        rmSync(path.join(root, 'coverage', report));
        rejects(root, /coverage.*(missing|read|ENOENT)/i);
      });
    });
  }

  it('retains branches for which the Node reporter has no mapped source line', () =>
    workspace((root) => {
      for (const report of reports)
        writeFileSync(
          path.join(root, 'coverage', report),
          lcov().replace('BRDA:1,0,0,1', 'BRDA:undefined,0,0,1'),
        );
      const result = cli(root);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(summary(root).files[0]!.branches, 2);
      assert.equal(summary(root).files[0]!.branchesCovered, 1);
    }));

  it('uses mapped branch hits when Node reports a different pre-map covered count', () =>
    workspace((root) => {
      for (const report of reports)
        writeFileSync(path.join(root, 'coverage', report), lcov().replace('BRH:1', 'BRH:2'));
      assert.equal(cli(root).status, 0);
      assert.equal(summary(root).files[0]!.branchesCovered, 1);
    }));

  const invalid = [
    ['empty report', '', /empty|no.*line/i],
    ['unfinished record', lcov().replace('end_of_record\n', ''), /unfinished|unterminated/i],
    ['nested record', lcov().replace('LF:1', 'SF:other.ts\nLF:1'), /unfinished|unterminated/i],
    ['data outside a record', `${lcov()}DA:2,1\n`, /outside|record/i],
    ['empty source', lcov().replace('../fabric/src/engine.ts', ''), /source|SF/i],
    ['invalid line number', lcov().replace('DA:1,1,checksum', 'DA:0,1'), /DA|line/i],
    ['invalid line hits', lcov().replace('DA:1,1,checksum', 'DA:1,NaN'), /DA|line/i],
    ['negative branch hits', lcov().replace('BRDA:1,0,0,1', 'BRDA:1,0,0,-1'), /BRDA|branch/i],
    ['incomplete line counts', lcov().replace('LF:1', 'LF:2'), /LF|count/i],
    ['missing line counts', lcov().replace('LF:1\n', ''), /LF|count/i],
    ['wrong covered counts', lcov().replace('LH:1', 'LH:0'), /LH|count/i],
    ['incomplete branch counts', lcov().replace('BRF:2', 'BRF:3'), /BRF|count/i],
    ['impossible covered branch count', lcov().replace('BRH:1', 'BRH:3'), /BRH|count/i],
    ['unsafe line hits', lcov().replace('DA:1,1,checksum', 'DA:1,9007199254740992'), /DA|number/i],
    [
      'no measured lines',
      'SF:empty.ts\nLF:0\nLH:0\nBRF:0\nBRH:0\nend_of_record\n',
      /no.*line|empty/i,
    ],
  ] as const;
  for (const [name, content, message] of invalid) {
    it(`rejects ${name}`, () =>
      workspace((root) => {
        writeFileSync(path.join(root, 'coverage/native.info'), content);
        rejects(root, message);
      }));
  }

  it('rejects a report containing no shipped source lines', () =>
    workspace((root) => {
      for (const report of reports)
        writeFileSync(path.join(root, 'coverage', report), lcov(1, '../../scripts/fixture.mjs'));
      rejects(root, /no.*(shipped|source|line)/i);
    }));

  it('counts what a package ships beside its package.json, and not what the tests are made of', () =>
    workspace((root) => {
      // Each path is from the directory its suite runs in: `packages/integration-tests` here.
      const measured = ['../metro/css/compile.cjs', 'compile.ts', '../web/register-linker.mjs'];
      writeFileSync(
        path.join(root, 'coverage/native.info'),
        measured.map((f) => lcov(1, f)).join(''),
      );
      assert.equal(cli(root).status, 0);
      const files = summary(root).files.map((entry) => entry.file);
      assert.ok(files.includes('packages/metro/css/compile.cjs'), 'Metro has no src directory');
      assert.ok(!files.some((file) => file.startsWith('packages/integration-tests/')));
      assert.ok(!files.some((file) => file.endsWith('register-linker.mjs')), 'a suite hook');
    }));

  for (const minimum of [undefined, '', 'NaN', '-1', '101', 'Infinity']) {
    it(`rejects the invalid floor ${JSON.stringify(minimum)}`, () =>
      workspace((root) => {
        assert.equal(cli(root).status, 0, 'a previous run left a valid summary');
        rejects(root, /--min|minimum/i, [
          '--report',
          '--min',
          ...(minimum === undefined ? [] : [minimum]),
        ]);
      }));
  }

  it('keeps valid measurements when the floor is not met', () =>
    workspace((root) => {
      for (const report of reports) writeFileSync(path.join(root, 'coverage', report), lcov(0));
      const result = cli(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /under the 95% floor/);
      assert.equal(summary(root).overall, 0);
    }));

  it('clears every old report before the first suite and can report a completed new run', () =>
    workspace((root) => {
      assert.equal(cli(root).status, 0);
      suites(root, 'success');
      assert.equal(cli(root, [], true).status, 0);
      const calls = readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(calls[0], [false, false, false, false]);
      assert.equal(summary(root).overall, 0);
      assert.equal(cli(root, ['--report']).status, 0);
      assert.equal(cli(root, ['--min', '95'], true).status, 1);
      assert.equal(cli(root, ['--report']).status, 0);
    }));

  it('does not reuse an old report when a successful producer writes nothing', () =>
    workspace((root) => {
      assert.equal(cli(root).status, 0);
      suites(root, 'missing');
      rejects(root, /coverage.*(missing|read|ENOENT)/i, [], true);
      assert.equal(
        readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').length,
        1,
      );
      rejects(root, /incomplete|rerun/i);
    }));

  it('does not re-report a failed run even when all producers wrote complete reports', () =>
    workspace((root) => {
      assert.equal(cli(root).status, 0);
      suites(root, 'failure');
      const result = cli(root, [], true);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /browser suite failed/);
      assert.equal(existsSync(path.join(root, 'coverage/summary.json')), false);
      rejects(root, /incomplete|rerun/i);
      suites(root, 'success');
      assert.equal(cli(root, [], true).status, 0);
      assert.equal(cli(root, ['--report']).status, 0);
    }));

  it('stops before the next suite when a successful producer writes an unfinished record', () =>
    workspace((root) => {
      suites(root, 'invalid');
      rejects(root, /native coverage report.*unfinished/i, [], true);
      assert.equal(
        readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').length,
        1,
      );
      rejects(root, /incomplete|rerun/i);
    }));

  // CI runs the native suite as shards on runners of their own, and one more job merges them.
  const sharded = ['--report', '--shards', '2', '--min', '95'];

  it('counts a line that only one shard of the native suite reached', () =>
    workspace((root) => {
      rmSync(path.join(root, 'coverage/native.info'));
      const other = '../fabric/src/node.ts';
      writeFileSync(path.join(root, 'coverage/native-1.info'), lcov() + lcov(0, other));
      writeFileSync(path.join(root, 'coverage/native-2.info'), lcov(1, other));
      const result = cli(root, sharded);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(summary(root).overall, 100);
    }));

  it('rejects a merge with a shard missing, and one whose shard count is not a number', () =>
    workspace((root) => {
      writeFileSync(path.join(root, 'coverage/native-1.info'), lcov());
      rejects(root, /native-2 coverage.*(missing|read|ENOENT)/i, sharded);
      rejects(root, /--shards/, ['--report', '--shards', 'two']);
    }));

  // Stands in for the suites, as `suites` does, and keeps the arguments each was started with.
  function shardRun(root: string, shard: string, status = 0) {
    writeFileSync(
      path.join(root, 'suites.mjs'),
      `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
childProcess.spawnSync = (command, args) => {
  appendFileSync(${JSON.stringify(path.join(root, 'calls.jsonl'))}, JSON.stringify(args) + '\\n');
  const named = args.find((arg) => arg.startsWith('--test-reporter-destination=') && arg.endsWith('.info'));
  const report = named ? named.split('=')[1] : ${JSON.stringify(path.join(root, 'coverage/browser/lcov.info'))};
  mkdirSync(path.dirname(report), { recursive: true });
  writeFileSync(report, ${JSON.stringify(lcov())});
  return { status: ${status} };
};
syncBuiltinESMExports();
`,
    );
    const result = cli(root, ['--shard', shard], true);
    const calls = existsSync(path.join(root, 'calls.jsonl'))
      ? readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n')
      : [];
    return { result, calls: calls.map((line) => JSON.parse(line) as string[]) };
  }

  it('runs one shard of the native suite, and the other suites beside the first', () =>
    workspace((root) => {
      for (const report of reports) rmSync(path.join(root, 'coverage', report));
      const second = shardRun(root, '2/2');
      assert.equal(second.result.status, 0, second.result.stderr);
      assert.equal(second.calls.length, 1);
      assert.ok(second.calls[0]!.includes('--test-shard=2/2'));
      assert.ok(existsSync(path.join(root, 'coverage/native-2.info')));
      assert.equal(existsSync(path.join(root, 'coverage/summary.json')), false, 'no report yet');

      rmSync(path.join(root, 'calls.jsonl'));
      const first = shardRun(root, '1/2');
      assert.equal(first.result.status, 0, first.result.stderr);
      assert.equal(first.calls.length, 4);
      assert.ok(first.calls[0]!.includes('--test-shard=1/2'));
      assert.ok(existsSync(path.join(root, 'coverage/native-2.info')), 'the other shard is kept');
      assert.equal(cli(root, sharded).status, 0);
    }));

  it('does not clear the mark a failed whole run left when a shard run succeeds', () =>
    workspace((root) => {
      suites(root, 'failure');
      assert.equal(cli(root, [], true).status, 2);
      assert.equal(shardRun(root, '2/2').result.status, 0);
      rejects(root, /incomplete|rerun/i);
    }));

  it('does not merge the shards when one of them failed', () =>
    workspace((root) => {
      assert.equal(shardRun(root, '1/2').result.status, 0);
      assert.equal(shardRun(root, '2/2', 1).result.status, 1);
      rejects(root, /incomplete|rerun/i, sharded);
      assert.equal(shardRun(root, '2/2').result.status, 0);
      assert.equal(cli(root, sharded).status, 0);
    }));

  for (const other of ['--report', '--min']) {
    it(`rejects a shard run asked for ${other} too, which it would not do`, () =>
      workspace((root) => {
        const result = cli(root, ['--shard', '1/2', other, ...(other === '--min' ? ['95'] : [])]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /--shard/);
      }));
  }

  for (const shard of ['3/2', '0/2', '1', 'a/b', '1.5/2']) {
    it(`rejects the shard ${shard} before running anything`, () =>
      workspace((root) => {
        const { result, calls } = shardRun(root, shard);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /--shard/);
        assert.equal(calls.length, 0);
      }));
  }
});
