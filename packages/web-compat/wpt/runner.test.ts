/**
 * The runner and the fetch fail closed: a checkout that is not there or not whole, a fetch that
 * failed and a test process that died each fail the run, and `--check` fails on any difference
 * from the expectations. Run against a checkout made here, with a harness of a few lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './fetch.mjs';
import { COMMIT, SUITES, SUPPORT } from './pin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** What the worker hears from `testharness.js`, and no more. */
const HARNESS = `
var harnessTests = [], onResult = [], onComplete = [];
function setup() {}
function add_result_callback(callback) { onResult.push(callback); }
function add_completion_callback(callback) { onComplete.push(callback); }
function test(body, name) {
  var made = { name: name, status: 0, message: null, stack: null };
  try { body(); } catch (error) { made.status = 1; made.message = String(error); }
  harnessTests.push(made);
  onResult.forEach(function (callback) { callback(made); });
}
function done() {
  onComplete.forEach(function (callback) { callback(harnessTests, { status: 0, message: null }); });
}
`;

/** A page of two tests, the second passing where `passes` is. */
const page = (body: string) =>
  `<!doctype html><script src="/resources/testharness.js"></script><script>${body}</script>`;
const twoTests = (passes: boolean) =>
  page(
    `test(function () {}, 'one'); test(function () { if (!${passes}) throw 1; }, 'two'); done();`,
  );

/** A checkout as a fetch that finished leaves it, of every suite, with two tests in one. */
function checkout(root: string, stamp: object = {}) {
  const at = join(root, 'cache', 'wpt');
  for (const directory of SUITES) mkdirSync(join(at, directory), { recursive: true });
  mkdirSync(join(at, 'resources'), { recursive: true });
  writeFileSync(join(at, 'resources', 'testharness.js'), HARNESS);
  writeFileSync(join(at, 'dom', 'nodes', 'a.html'), twoTests(false));
  writeFileSync(join(at, 'dom', 'nodes', 'b.html'), twoTests(true));
  const stamped = { commit: COMMIT, paths: [...SUITES, ...SUPPORT], files: 3, ...stamp };
  writeFileSync(join(root, 'cache', '.fetched.json'), JSON.stringify(stamped));
  return at;
}

function inTemp(name: string, body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), `ng-native-wpt-${name}-`));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** `node wpt/<script> ...args`, with the cache and the expectations in `root`. */
function node(root: string, script: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [join(HERE, script), ...args], {
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      WPT_CACHE: join(root, 'cache'),
      WPT_EXPECTATIONS: join(root, 'expectations.json'),
      WPT_REPOSITORY: join(root, 'no-repository'),
    },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

test('--check passes on what --update recorded, and fails on a file passing less or more', () => {
  inTemp('check', (root) => {
    const at = checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    assert.equal(recorded.files['dom/nodes/a.html'].pass, 1);
    assert.equal(node(root, 'run.mjs', '--check').status, 0);

    writeFileSync(join(at, 'dom', 'nodes', 'a.html'), twoTests(true));
    const better = node(root, 'run.mjs', '--check');
    assert.equal(better.status, 1, better.out);
    assert.match(better.out, /1 files differ from the expectations: record them with --update/);

    writeFileSync(join(at, 'dom', 'nodes', 'b.html'), twoTests(false));
    writeFileSync(join(at, 'dom', 'nodes', 'a.html'), twoTests(false));
    const worse = node(root, 'run.mjs', '--check');
    assert.equal(worse.status, 1, worse.out);
    assert.match(worse.out, /1 files pass less than expected/);
  });
});

test('a full --update records afresh after the pin moves, and anything else fails before it runs', () => {
  inTemp('stale', (root) => {
    checkout(root);
    const stale = { commit: 'an-older-commit', files: { 'dom/nodes/gone.html': { pass: 1 } } };
    writeFileSync(join(root, 'expectations.json'), JSON.stringify(stale));
    const check = node(root, 'run.mjs', '--check');
    assert.equal(check.status, 2, check.out);
    assert.match(check.out, /recorded at an-older-commit/);
    assert.doesNotMatch(check.out, /running \d+ files/, 'fails before the run');
    const filtered = node(root, 'run.mjs', '--update', 'dom/nodes/');
    assert.equal(filtered.status, 2, filtered.out);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    assert.equal(recorded.commit, COMMIT);
    assert.equal(recorded.files['dom/nodes/gone.html'], undefined, 'none of the old carried over');
  });
});

test('--check fails where a recorded file was not run, with a filter too', () => {
  inTemp('missing', (root) => {
    const at = checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    rmSync(join(at, 'dom', 'nodes', 'a.html'));
    const run = node(root, 'run.mjs', '--check');
    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /expected, not run: 1/);
    // And where only the suite it is in was asked for.
    const filtered = node(root, 'run.mjs', '--check', 'dom/nodes/');
    assert.equal(filtered.status, 1, filtered.out);
    assert.match(filtered.out, /expected, not run: 1/);
  });
});

test('a test process that dies is a CRASH, which --check fails', () => {
  inTemp('crash', (root) => {
    const at = checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    writeFileSync(join(at, 'dom', 'nodes', 'a.html'), page('process.exit(9);'));
    const run = node(root, 'run.mjs', '--check');
    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /CRASH dom\/nodes\/a\.html/);
  });
});

test('the runner refuses a checkout that is missing, of another commit, or not whole', () => {
  inTemp('refuse', (root) => {
    const missing = node(root, 'run.mjs', '--check');
    assert.equal(missing.status, 2, missing.out);
    assert.match(missing.out, /the tests are not fetched/);

    const at = checkout(root, { commit: 'another' });
    assert.match(node(root, 'run.mjs', '--check').out, /the tests are not fetched/);

    checkout(root);
    rmSync(join(at, 'resources', 'testharness.js'));
    assert.match(node(root, 'run.mjs', '--check').out, /the tests are not fetched/);

    checkout(root);
    rmSync(join(at, SUITES.at(-1)), { recursive: true });
    const partial = node(root, 'run.mjs', '--check');
    assert.equal(partial.status, 2, partial.out);
    assert.match(partial.out, /wpt run failed: ENOENT/);
  });
});

test('--check refuses to run with no expectations to check against', () => {
  inTemp('no-expectations', (root) => {
    checkout(root);
    const run = node(root, 'run.mjs', '--check');
    assert.equal(run.status, 2, run.out);
    assert.match(run.out, /there is no expectations.json to check against/);
  });
});

test('a fetch that fails exits non-zero and leaves no stamp', () => {
  inTemp('fetch', (root) => {
    const fetched = node(root, 'fetch.mjs');
    assert.equal(fetched.status, 1, fetched.out);
    assert.match(fetched.out, /wpt fetch failed/);
    assert.match(node(root, 'run.mjs', '--check').out, /the tests are not fetched/);
  });
});

/** A git repository holding `files`, committed: answers where it is and its commit. */
function repository(root: string, files: Record<string, string>) {
  const at = join(root, 'repository');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  const git = (...args: string[]) =>
    spawnSync('git', ['-C', at, ...args], { encoding: 'utf8' }).stdout.trim();
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'tests');
  return { at, commit: git('rev-parse', 'HEAD') };
}

test('a checkout that is truncated, partial, of another commit or changed is not taken', () => {
  const whole = { 'resources/testharness.js': 'x'.repeat(100_000), 'dom/nodes/a.html': 'a' };
  inTemp('verify', (root) => {
    const { at, commit } = repository(root, whole);
    assert.equal(verify(at, commit, ['resources', 'dom/nodes']), 2);
    assert.throws(() => verify(at, 'f'.repeat(40), ['dom/nodes']), /not the pinned/);
    assert.throws(() => verify(at, commit, ['dom/events']), /dom\/events came back with no files/);
    writeFileSync(join(at, 'dom/nodes/a.html'), 'changed');
    assert.throws(() => verify(at, commit, ['dom/nodes']), /the checkout is not clean/);
    rmSync(join(at, 'dom/nodes/a.html'));
    assert.throws(() => verify(at, commit, ['dom/nodes']), /a.html is listed but not on disk/);
  });
  inTemp('truncated', (root) => {
    const { at, commit } = repository(root, { ...whole, 'resources/testharness.js': 'short' });
    assert.throws(() => verify(at, commit, ['dom/nodes']), /testharness.js is truncated/);
  });
});
