/**
 * What the tests actually reach, across every `node --test` suite at once.
 *
 * They run in different hosts and cover overlapping code, so a per-suite number answers the wrong
 * question. `packages/components` is exercised by the native suite through a fake Fabric and by the
 * web suite through jsdom, and neither on its own says whether a component is tested - only the
 * union does. So each writes lcov and this merges them on absolute paths before reporting.
 *
 * Node's own `--experimental-test-coverage` does the instrumenting. No `c8`, no `nyc`: both suites
 * are `node --test` already, and a separate instrumenter would mean a second set of source maps
 * over TypeScript that Node is stripping itself.
 *
 * The browser suite uses Vitest's v8 coverage. All four reports must be complete before the
 * merged result can be used, including when `--report` reads a previous run.
 *
 * Usage:
 *
 *   node scripts/coverage.mjs            # run every suite, merge, report
 *   node scripts/coverage.mjs --report   # re-report from the last run, without re-running
 *   node scripts/coverage.mjs --min 70   # exit non-zero if total line coverage is under 70%
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'coverage');
const INCOMPLETE = path.join(OUT, '.incomplete');
const SUMMARY = path.join(OUT, 'summary.json');

/**
 * Everything that is shipped, and nothing that is not.
 *
 * `.generated.ts` is deliberately *not* excluded, and leaving it out was this script's first and
 * worst bug: `node --test` cannot run Angular's JIT, so the native suite's fixtures are compiled
 * ahead of time and import the pre-compiled copy of every component. The source file is never
 * executed there at all. Excluding the copy therefore reported `virtual-list.ts` at 21.9% with
 * thirteen passing tests against it, when the code that actually ran was 98.6% covered - a report
 * that would have sent someone to write tests for the best-tested file in the package.
 *
 * `report()` folds each copy back onto the source it was generated from. Fixtures and tests stay
 * out: they are the instrument, not the thing measured.
 */
const EXCLUDE = ['**/*.test.ts', '**/fixtures/**', '**/node_modules/**', '**/dist/**'];

/**
 * How each suite is run and where it leaves its lcov.
 *
 * The `node --test` suites are instrumented by Node itself and take their flags here. The
 * browser suite is Vitest driving a real Chromium, so it is instrumented by `@vitest/coverage-v8`
 * and configured in `packages/web/vitest.config.ts`; all this has to do is ask for it and know
 * where the report lands.
 */
const SUITES = [
  {
    name: 'native',
    cwd: 'packages/integration-tests',
    command: 'node',
    args: (destination) => [
      '--import',
      './register-linker.mjs',
      '--test',
      // One file per core. Node's default leaves a core free, which on a two-core CI runner is
      // one file at a time, and this suite is 160 files.
      `--test-concurrency=${availableParallelism()}`,
      '--experimental-test-coverage',
      ...EXCLUDE.map((pattern) => `--test-coverage-exclude=${pattern}`),
      '--test-reporter=lcov',
      `--test-reporter-destination=${destination}`,
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      '**/*.test.ts',
    ],
    report: (out) => path.join(out, 'native.info'),
  },
  {
    name: 'web',
    cwd: 'packages/web',
    command: 'node',
    args: (destination) => [
      '--import',
      './register-linker.mjs',
      '--test',
      '--experimental-test-coverage',
      ...EXCLUDE.map((pattern) => `--test-coverage-exclude=${pattern}`),
      '--test-reporter=lcov',
      `--test-reporter-destination=${destination}`,
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      'src/*.test.ts',
    ],
    report: (out) => path.join(out, 'web.info'),
  },
  {
    // `@ng-native/testing`'s own node:test half, through the public register hook. Its Vitest half
    // runs the same code the way the tutorial does, so leaving it out loses nothing measurable.
    name: 'testing',
    cwd: 'packages/testing',
    command: 'node',
    args: (destination) => [
      '--import',
      './runner/register.mjs',
      '--test',
      '--experimental-test-coverage',
      ...EXCLUDE.map((pattern) => `--test-coverage-exclude=${pattern}`),
      '--test-reporter=lcov',
      `--test-reporter-destination=${destination}`,
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      'src/**/*.node.test.ts',
    ],
    report: (out) => path.join(out, 'testing.info'),
  },
  {
    name: 'browser',
    cwd: 'packages/web',
    command: 'pnpm',
    args: () => ['exec', 'vitest', 'run', '--coverage'],
    report: (out) => path.join(out, 'browser', 'lcov.info'),
  },
];

/** `SF:` records, as `{ [file]: { lines: Map<number, hits>, branches: Map<id, hits> } }`. */
function parseLcov(text, cwd) {
  const files = new Map();
  let current = null;
  let file;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      if (current) throw new Error('Unfinished LCOV record before SF.');
      if (!line.slice(3).trim()) throw new Error('Empty LCOV source path.');
      // lcov paths are relative to the suite's own directory; the merge key has to be absolute.
      file = path.resolve(cwd, line.slice(3).trim());
      current = { lines: new Map(), branches: new Map(), counts: new Map() };
    } else if (line === 'end_of_record') {
      if (!current) throw new Error('LCOV terminator outside a source record.');
      validateRecord(current);
      const held = files.get(file) ?? { lines: new Map(), branches: new Map() };
      addHits(held.lines, current.lines);
      addHits(held.branches, current.branches);
      files.set(file, held);
      current = null;
    } else if (/^(DA|BRDA|LF|LH|BRF|BRH):/.test(line)) {
      if (!current) throw new Error('LCOV coverage data outside a source record.');
      readCoverageLine(line, current);
    }
  }
  if (current) throw new Error('Unfinished LCOV record at end of report.');
  if (![...files.values()].some((data) => data.lines.size > 0)) {
    throw new Error('Empty coverage report: no measured lines.');
  }
  return files;
}

function addHits(target, source) {
  for (const [key, hits] of source) target.set(key, (target.get(key) ?? 0) + hits);
}

/** Only the fields used in the merge; function records and other LCOV metadata stay opaque. */
function readCoverageLine(line, record) {
  const [kind] = line.split(':');
  const formats = {
    DA: /^DA:([1-9]\d*),(\d+)(?:,[^,]*)?$/,
    // Node's source maps can leave a branch without a source line; its block/id still identify it.
    BRDA: /^BRDA:([1-9]\d*|undefined),(\d+),(\d+),(\d+|-)$/,
  };
  const match = (formats[kind] ?? /^(?:LF|LH|BRF|BRH):(\d+)$/).exec(line);
  if (!match) throw new Error(`Invalid LCOV ${kind} data: ${line}`);
  const numbers = match
    .slice(1)
    .filter((value) => value !== '-' && value !== 'undefined')
    .map(Number);
  if (numbers.some((value) => !Number.isSafeInteger(value))) {
    throw new Error(`Invalid LCOV ${kind} number: ${line}`);
  }
  if (kind === 'DA') {
    if (record.lines.has(numbers[0])) throw new Error('Duplicate LCOV DA line.');
    record.lines.set(numbers[0], numbers[1]);
  } else if (kind === 'BRDA') {
    const key = match.slice(1, 4).join(':');
    if (record.branches.has(key)) throw new Error('Duplicate LCOV BRDA branch.');
    record.branches.set(key, match[4] === '-' ? 0 : Number(match[4]));
  } else {
    if (record.counts.has(kind)) throw new Error(`Duplicate LCOV ${kind} count.`);
    record.counts.set(kind, numbers[0]);
  }
}

function validateRecord({ lines, branches, counts }) {
  const expected = {
    LF: lines.size,
    LH: [...lines.values()].filter((hits) => hits > 0).length,
    BRF: branches.size,
  };
  for (const [name, value] of Object.entries(expected)) {
    // Both producers supply line totals; branch totals are optional in LCOV.
    if ((name === 'LF' || name === 'LH' || counts.has(name)) && counts.get(name) !== value) {
      throw new Error(`LCOV ${name} count does not match its coverage data.`);
    }
  }
  // Node's source-mapped BRH can disagree with its BRDA hits. The merge uses those hits rather
  // than this summary, so only its range can be checked across both producers.
  if (counts.has('BRH') && counts.get('BRH') > branches.size) {
    throw new Error('LCOV BRH count exceeds the number of branches.');
  }
}

function readSuite(suite) {
  const file = suite.report(OUT);
  try {
    return parseLcov(readFileSync(file, 'utf8'), path.join(ROOT, suite.cwd));
  } catch (error) {
    throw new Error(
      `${suite.name} coverage report (${path.relative(ROOT, file)}): ${error.message}`,
    );
  }
}

/** The lines a file never ran, collapsed into ranges, because a list of 200 numbers is unreadable. */
function uncoveredRanges(lines) {
  const missed = [...lines.entries()]
    .filter(([, hits]) => hits === 0)
    .map(([number]) => number)
    .sort((a, b) => a - b);
  const ranges = [];
  for (const number of missed) {
    const last = ranges.at(-1);
    if (last && number === last[1] + 1) last[1] = number;
    else ranges.push([number, number]);
  }
  return ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`));
}

function run() {
  mkdirSync(OUT, { recursive: true });
  // Kept on failure or interruption, even when a failed producer wrote a complete LCOV file.
  writeFileSync(INCOMPLETE, 'Coverage run incomplete. Rerun pnpm coverage.\n');
  for (const suite of SUITES) rmSync(suite.report(OUT), { force: true });
  for (const suite of SUITES) {
    const started = Date.now();
    const result = spawnSync(suite.command, suite.args(suite.report(OUT)), {
      cwd: path.join(ROOT, suite.cwd),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    console.log(
      `\n${suite.name}: ${((Date.now() - started) / 1000).toFixed(1)}s on ${availableParallelism()} cores`,
    );
    if (result.status !== 0) {
      console.error(`\n${suite.name} suite failed; coverage from a red suite is not worth having.`);
      process.exit(result.status ?? 1);
    }
    readSuite(suite);
  }
}

/** How well one suite covered a file's branches, with "no branches recorded" as worst. */
function branchScore(branches) {
  if (branches.size === 0) return -1;
  return [...branches.values()].filter((hits) => hits > 0).length / branches.size;
}

/** A percentage, with an empty file counting as covered rather than as a division by zero. */
const ratio = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);

/** Totals for one group of files. */
function totals(files) {
  return files.reduce(
    (sum, entry) => ({
      files: sum.files + 1,
      lines: sum.lines + entry.lines,
      covered: sum.covered + entry.covered,
      branches: sum.branches + entry.branches,
      branchesCovered: sum.branchesCovered + entry.branchesCovered,
    }),
    { files: 0, lines: 0, covered: 0, branches: 0, branchesCovered: 0 },
  );
}

const row = (name, data) =>
  `${name.padEnd(16)} ${String(data.files).padStart(5)} ${String(data.lines).padStart(7)} ` +
  `${ratio(data.covered, data.lines).toFixed(1).padStart(7)} ` +
  `${ratio(data.branchesCovered, data.branches).toFixed(1).padStart(9)}`;

/** Worst package first, so the table reads as a queue of work. */
function printPackages(shipped) {
  const groups = new Map();
  for (const entry of shipped) {
    groups.set(entry.package, [...(groups.get(entry.package) ?? []), entry]);
  }
  console.log(`\nCoverage by package (${SUITES.length} suites merged)\n`);
  console.log(
    `${'package'.padEnd(16)} ${'files'.padStart(5)} ${'lines'.padStart(7)} ` +
      `${'line %'.padStart(7)} ${'branch %'.padStart(9)}`,
  );
  console.log('-'.repeat(50));
  const rows = [...groups.entries()]
    .map(([name, files]) => [name, totals(files)])
    .sort((a, b) => ratio(a[1].covered, a[1].lines) - ratio(b[1].covered, b[1].lines));
  for (const [name, data] of rows) console.log(row(name, data));
  console.log('-'.repeat(50));
  console.log(row('all', totals(shipped)));
}

/**
 * Ranked by uncovered lines rather than by percentage.
 *
 * A forty-line file at 80% is noise beside a four-hundred-line file at 30%, and a list sorted by
 * percentage puts the noise first.
 */
function printWorst(shipped) {
  const worst = shipped
    .map((entry) => ({ ...entry, missing: entry.lines - entry.covered }))
    .filter((entry) => entry.missing > 0)
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 30);
  console.log('\nMost uncovered lines\n');
  console.log(`${'file'.padEnd(52)} ${'miss'.padStart(5)} ${'line %'.padStart(7)}`);
  console.log('-'.repeat(68));
  for (const entry of worst) {
    console.log(
      `${entry.file.padEnd(52)} ${String(entry.missing).padStart(5)} ` +
        `${ratio(entry.covered, entry.lines).toFixed(1).padStart(7)}`,
    );
  }
}

/**
 * Every suite's hits, combined per file: lines added together, branches not.
 *
 * Lines are a true union. `packages/web/src/mount.ts` is run by the jsdom suite and again by the
 * browser one, and a line number means the same thing to both, so a line either suite reached is
 * covered.
 *
 * Branches are not, and adding them was wrong in a way that looked like a regression: Node's own
 * coverage and `@vitest/coverage-v8` identify a branch differently, so summing their `BRDA` keys
 * counts one instrumenter's *untaken* branches as branches the other never had. Adding the browser
 * suite that way dropped `packages/web` from 88% to 72% while covering strictly more code. So each
 * file keeps the branch set of whichever suite covered the largest share of it, which is a real
 * measurement by one instrumenter rather than an invented union of two.
 */
function mergeSuites() {
  const totals = new Map();
  for (const suite of SUITES) {
    for (const [name, data] of readSuite(suite)) {
      const held = totals.get(name) ?? { lines: new Map(), branches: new Map() };
      for (const [number, hits] of data.lines) {
        held.lines.set(number, (held.lines.get(number) ?? 0) + hits);
      }
      // A file no suite recorded branches for scores below every real measurement, rather than
      // above them: `ratio(0, 0)` is 100 by design elsewhere, and an empty set winning that
      // comparison reported every package at 100% branch coverage.
      if (branchScore(data.branches) > branchScore(held.branches)) held.branches = data.branches;
      totals.set(name, held);
    }
  }
  return totals;
}

/**
 * Whether a measured file is one a package ships. Not only what is under `src`: Metro, the
 * migrations and the Tailwind preset keep their code beside their `package.json`, and a floor
 * that left them out said nothing about the CSS compiler. The tests' own package is the
 * instrument, and so is the hook a suite is started with.
 */
function isShipped(file) {
  const [packages, name] = path.relative(ROOT, file).split(path.sep);
  return (
    packages === 'packages' &&
    name !== 'integration-tests' &&
    path.basename(file) !== 'register-linker.mjs'
  );
}

/** Every measured file, as plain counts. */
function filesIn(merged) {
  return [...merged.entries()]
    .filter(([file]) => isShipped(file))
    .map(([file, data]) => {
      const lines = [...data.lines.values()];
      const branches = [...data.branches.values()];
      return {
        file: path.relative(ROOT, file),
        package: path.relative(ROOT, file).split(path.sep)[1],
        lines: lines.length,
        covered: lines.filter((hits) => hits > 0).length,
        branches: branches.length,
        branchesCovered: branches.filter((hits) => hits > 0).length,
        uncovered: uncoveredRanges(data.lines),
      };
    });
}

/**
 * One row per source file, folding each AOT copy onto the source it came from.
 *
 * The suites run different copies: the native one executes `foo.generated.ts`, because its
 * fixtures are AOT-compiled and import that, and the web one executes `foo.ts` through jsdom. So a
 * component reached only by the native suite reads as untested unless the copy counts, and one
 * reached by both would be counted twice.
 *
 * Line numbers do not survive the compile - the template becomes instructions and everything below
 * shifts - so the two cannot be merged line by line. The better-covered of the pair is taken
 * instead, under the source's name, which is the honest reading of "did this logic run". Line
 * ranges then come from whichever copy won, so on an AOT-only file they are offsets into the
 * generated copy rather than the source. The ranking is what this report is for, and the ranking
 * is right either way.
 */
function fold(measured) {
  const bySource = new Map();
  for (const entry of measured) {
    const source = entry.file.replace(/\.generated\.ts$/, '.ts');
    const held = bySource.get(source);
    if (!held || ratio(entry.covered, entry.lines) > ratio(held.covered, held.lines)) {
      bySource.set(source, { ...entry, file: source });
    }
  }
  return [...bySource.values()];
}

function report(minimum) {
  const shipped = fold(filesIn(mergeSuites()));
  const all = totals(shipped);
  if (all.lines === 0) throw new Error('No shipped source lines were measured.');
  printPackages(shipped);
  printWorst(shipped);

  const overall = ratio(all.covered, all.lines);
  writeFileSync(SUMMARY, `${JSON.stringify({ overall, files: shipped }, null, 2)}\n`);
  console.log(`\nDetail in ${path.relative(ROOT, path.join(OUT, 'summary.json'))}`);

  if (minimum !== undefined && overall < minimum) {
    console.error(`\nLine coverage ${overall.toFixed(1)}% is under the ${minimum}% floor.`);
    process.exitCode = 1;
  }
}

function main() {
  rmSync(SUMMARY, { force: true });
  const args = process.argv.slice(2);
  const minimumAt = args.indexOf('--min');
  const raw = args[minimumAt + 1];
  const minimum = minimumAt === -1 ? undefined : Number(raw);
  if (
    minimum !== undefined &&
    (!raw?.trim() || !Number.isFinite(minimum) || minimum < 0 || minimum > 100)
  ) {
    throw new Error('--min must be a finite percentage between 0 and 100.');
  }
  if (args.includes('--report')) {
    if (existsSync(INCOMPLETE)) throw new Error('Coverage run incomplete. Rerun pnpm coverage.');
  } else {
    run();
  }
  report(minimum);
  rmSync(INCOMPLETE, { force: true });
}

try {
  main();
} catch (error) {
  console.error(`\nCoverage failed: ${error.message}`);
  process.exitCode = 1;
}
