/**
 * `node wpt/run.mjs [filter ...] [--update] [--check]`: run Web Platform Tests against
 * `@ng-native/web-compat` and say what passed.
 *
 * - A filter is part of a test's path from the root of the checkout: `dom/nodes`,
 *   `2d.fillStyle`, `Node-appendChild.html`. With none, every suite in `pin.mjs` is run.
 * - `--update` writes what was found to `expectations.json`, and `summary.txt` where every suite
 *   was run.
 * - `--check` exits non-zero where the run differs from `expectations.json` at all: a file passes
 *   less than it says or was expected and not run, and as much where a file passes more, is new
 *   or has more or fewer subtests, which `--update` records. How a file ended (OK, TIMEOUT) is
 *   recorded and not compared: see `change` in `report.mjs`. With filters, a file they match that was
 *   expected and not run counts as well.
 * - `--timeout=2000` is how long a file has, in milliseconds (three times it for one marked
 *   long). The harness's own is 10 s: a file that needs longer than is given is a TIMEOUT.
 * - `--dump=<file>` writes each failing subtest's message, by file, to `<file>`: what to group
 *   the failures by.
 * - `--hang=30000` is how long the process may say nothing before it is killed and the file it
 *   was on recorded as a CRASH. `--batch=100` is how many files a process runs before a new one.
 *
 * One process at a time. The tests are fetched by `fetch.mjs`, and nothing runs from a checkout
 * that is not the pinned commit, whole and unchanged.
 */
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetched } from './fetch.mjs';
import { CACHE, COMMIT, HERE, SUITES } from './pin.mjs';
import { compare, expectationOf, summarize, verdict, writeExpectations } from './report.mjs';
import { classify, filesUnder, suiteOf } from './tests.mjs';

/** What a run is checked against. `WPT_EXPECTATIONS` replaces it, for the runner's own tests. */
const EXPECTATIONS = process.env.WPT_EXPECTATIONS || join(HERE, 'expectations.json');
/** Beside it: what `--update` of every suite found, for a reader. */
const SUMMARY = join(dirname(EXPECTATIONS), 'summary.txt');

function options(argv) {
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const number = (name, otherwise) => {
    const flag = flags.find((each) => each.startsWith(`--${name}=`));
    if (!flag) return otherwise;
    // A batch of none would fork a process a turn for good, and a time of none ends every file.
    const value = Number(flag.slice(name.length + 3));
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${flag}: --${name} must be a whole number above 0`);
    }
    return value;
  };
  return {
    filters: argv.filter((arg) => !arg.startsWith('--')),
    update: flags.includes('--update'),
    check: flags.includes('--check'),
    timeout: number('timeout', 2000),
    hang: number('hang', 30_000),
    batch: number('batch', 100),
    dump: flags.find((each) => each.startsWith('--dump='))?.slice('--dump='.length),
  };
}

/** Whether a path is one a run with these filters is asked for: any, with none. */
const matcher = (filters) => (path) =>
  !filters.length || filters.some((filter) => path.includes(filter));

/** Every file of the suites, sorted into what is run, what is skipped and why, and the rest. */
function plan(filters) {
  const inScope = matcher(filters);
  const run = [];
  const skipped = {};
  const support = {};
  for (const suite of SUITES) {
    for (const path of filesUnder(suite)) {
      if (!inScope(path)) continue;
      const owner = suiteOf(path, SUITES);
      const { kind, reason } = classify(path);
      if (kind === 'run') run.push(path);
      else if (kind === 'support') support[owner] = (support[owner] ?? 0) + 1;
      else {
        skipped[owner] ??= {};
        skipped[owner][reason] = (skipped[owner][reason] ?? 0) + 1;
      }
    }
  }
  return { run, skipped, support };
}

/**
 * Run some files in one process, telling `report` of each as it ends. Answers how many of them
 * are accounted for: all, or as far as the one the process died or hung on, which is a CRASH.
 */
function runBatch(files, { timeout, hang }, report) {
  return new Promise((resolve, reject) => {
    const child = fork(join(HERE, 'worker.mjs'), [], {
      cwd: join(HERE, '..'),
      execArgv: [
        '--import',
        '@ng-native/testing/register',
        '--disable-warning=ExperimentalWarning',
      ],
      silent: true,
    });
    let done = 0;
    let started = false;
    let killedFor;
    let errors = '';
    let watchdog;
    child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-2000)));
    child.stdout.resume();
    const watch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        killedFor = `no word from the process for ${hang} ms`;
        child.kill('SIGKILL');
      }, hang);
    };
    child.on('message', (message) => {
      watch();
      if (message.type === 'start') started = true;
      if (message.type !== 'result') return;
      done++;
      report(message.path, message.result);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(watchdog);
      if (done === files.length) return resolve(done);
      // Before any test: the runner itself is broken, and every file would be a crash.
      if (!started) return reject(new Error(`the test process did not start:\n${errors}`));
      const message =
        killedFor ?? `the process ended (${signal ?? `exit ${code}`}): ${errors.slice(-300)}`;
      report(files[done], { status: 'CRASH', message, subtests: [], ms: 0 });
      resolve(done + 1);
    });
    watch();
    child.send({ files, timeout });
  });
}

async function runAll(files, opts) {
  const results = {};
  const began = Date.now();
  const report = (path, result) => {
    results[path] = { ...result, suite: suiteOf(path, SUITES) };
    const count = Object.keys(results).length;
    if (result.status === 'CRASH') console.log(`CRASH ${path}: ${result.message}`);
    if (count % 100 === 0 || count === files.length) {
      console.log(`${count}/${files.length} files, ${Math.round((Date.now() - began) / 1000)} s`);
    }
  };
  for (let at = 0; at < files.length;) {
    at += await runBatch(files.slice(at, at + opts.batch), opts, report);
  }
  return results;
}

function readExpectations() {
  if (!existsSync(EXPECTATIONS)) return undefined;
  return JSON.parse(readFileSync(EXPECTATIONS, 'utf8'));
}

const counts = (entry) => `${entry.status} ${entry.pass}/${entry.total}`;

/** Say how the run differs from the expectations. */
function tellChanges(changes) {
  const said = {
    passing: 'newly passing',
    failing: 'newly failing',
    changed: 'more or fewer subtests',
    missing: 'expected, not run',
  };
  for (const kind of ['passing', 'failing', 'changed', 'missing']) {
    const of = changes.filter((each) => each.kind === kind);
    if (!of.length) continue;
    console.log(`\n${said[kind]}: ${of.length}`);
    for (const each of of.slice(0, 40)) {
      console.log(
        `  ${each.path}: ${counts(each.was)}${each.now ? ` -> ${counts(each.now)}` : ''}`,
      );
    }
    if (of.length > 40) console.log(`  and ${of.length - 40} more`);
  }
  const fresh = changes.filter((each) => each.kind === 'new').length;
  if (fresh) console.log(`\nnot in the expectations: ${fresh} files`);
}

/** Record the run: what it was asked for is replaced, run or not, and the rest is kept. */
function update(results, expected, inScope) {
  const files = {};
  for (const [path, entry] of Object.entries(expected)) if (!inScope(path)) files[path] = entry;
  for (const [path, result] of Object.entries(results)) files[path] = expectationOf(result);
  writeFileSync(EXPECTATIONS, writeExpectations(COMMIT, files));
  console.log(`wrote ${EXPECTATIONS}`);
}

/** Write what a run found where it is read: the cache always, the summary kept on an update. */
function writeFound(results, summary, keep) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, 'results.json'), JSON.stringify(results, null, 1));
  writeFileSync(join(CACHE, 'summary.txt'), summary);
  if (keep) writeFileSync(SUMMARY, summary);
  console.log(`\n${summary}`);
}

/**
 * The expectations a run is compared with, where there are any for this commit. Read before the
 * run, so one that cannot be compared fails at once. A full `--update` after the pin moves
 * records afresh, with none of the old commit's carried over.
 */
function expectations(opts) {
  const expected = readExpectations();
  if (opts.check && !expected) throw new Error('there is no expectations.json to check against');
  if (expected && expected.commit !== COMMIT) {
    if (opts.update && opts.filters.length === 0 && !opts.check) return undefined;
    throw new Error(
      `expectations.json was recorded at ${expected.commit}: run every suite with --update`,
    );
  }
  return expected;
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (!fetched()) {
    throw new Error(
      `the tests are not fetched at ${COMMIT}, or changed since: run node wpt/fetch.mjs`,
    );
  }
  const { run, skipped, support } = plan(opts.filters);
  if (!run.length) throw new Error('no test matches: nothing was run');
  const expected = expectations(opts);
  const whole = opts.filters.length === 0;
  console.log(`running ${run.length} files, one process, ${opts.timeout} ms a file`);
  const results = await runAll(run, opts);
  if (opts.dump) writeFailures(results, opts.dump);

  const summary = summarize({ commit: COMMIT, suites: SUITES, results, skipped, support, ...opts });
  writeFound(results, summary, opts.update && whole);

  compareAndRecord(results, opts, expected);
}

/** Compare the run with the expectations, record it on `--update`, and fail `--check` on a difference. */
function compareAndRecord(results, opts, expected) {
  const inScope = matcher(opts.filters);
  const changes = expected ? compare(expected.files, results, inScope) : [];
  tellChanges(changes);
  if (opts.update) update(results, expected?.files ?? {}, inScope);
  const { worse, unrecorded } = verdict(changes);
  // With `--update` as well, what is better is recorded now; what is worse still fails.
  const stale = opts.update ? 0 : unrecorded;
  if (!opts.check || (!worse && !stale)) return;
  if (worse) console.error(`\n${worse} files pass less than expected, or were not run`);
  if (stale)
    console.error(`\n${stale} files differ from the expectations: record them with --update`);
  process.exitCode = 1;
}

/** Each file's message, where it did not finish, and its failing subtests' messages. */
function writeFailures(results, file) {
  const failing = {};
  for (const [path, result] of Object.entries(results)) {
    const subtests = (result.subtests ?? [])
      .filter((test) => test.status !== 'PASS')
      .map((test) => ({ name: test.name, message: test.message }));
    if (result.status !== 'OK' || subtests.length) {
      failing[path] = { status: result.status, message: result.message, subtests };
    }
  }
  writeFileSync(file, JSON.stringify(failing, null, 1));
}

main().catch((error) => {
  console.error(`wpt run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
