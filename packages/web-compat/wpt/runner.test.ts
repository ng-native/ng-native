/**
 * The runner and the fetch fail closed: a checkout that is not there or not whole, a fetch that
 * failed and a test process that died each fail the run, and `--check` fails on any difference
 * from the expectations. Run against a checkout made here, with a harness of a few lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './fetch.mjs';
import { CHECKOUT, COMMIT, SUITES, SUPPORT } from './pin.mjs';
import { inCheckout } from './tests.mjs';

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

/**
 * A page of two tests. The second passes where `PASSING` names the page, and the process dies
 * where `CRASH` does: what a run finds changes with the environment it is given, and the
 * checkout, which the runner refuses where it changed, stays as it was committed.
 */
const page = (body: string) =>
  `<!doctype html><script src="/resources/testharness.js"></script><script>${body}</script>`;
const twoTests = (name: string) =>
  page(
    `if (process.env.CRASH === '${name}') process.exit(9);
    test(function () {}, 'one');
    test(function () { if (!(process.env.PASSING || '').includes('${name}')) throw 1; }, 'two');
    done();`,
  );

/** `git -C at ...args`, committing as anyone. */
const gitIn = (at: string, ...args: string[]) =>
  spawnSync(
    'git',
    ['-C', at, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8' },
  ).stdout.trim();

/**
 * A checkout as a fetch that finished leaves it, of every suite, with two tests in one: a git
 * repository with what it holds committed, stamped as fetched at that commit.
 */
function checkout(root: string, stamp: object = {}, pages: Record<string, string> = {}) {
  const at = join(root, 'cache', 'wpt');
  for (const directory of SUITES) mkdirSync(join(at, directory), { recursive: true });
  mkdirSync(join(at, 'resources'), { recursive: true });
  writeFileSync(join(at, 'resources', 'testharness.js'), HARNESS);
  const all = { 'a.html': twoTests('a'), 'b.html': twoTests('b'), ...pages };
  for (const [name, text] of Object.entries(all))
    writeFileSync(join(at, 'dom', 'nodes', name), text);
  gitIn(at, 'init', '--quiet');
  gitIn(at, 'add', '.');
  gitIn(at, 'commit', '--quiet', '-m', 'tests');
  const stamped = { commit: commitOf(root), paths: [...SUITES, ...SUPPORT], files: 3, ...stamp };
  writeFileSync(join(root, 'cache', '.fetched.json'), JSON.stringify(stamped));
  return at;
}

/** The commit the checkout in `root` is at, which the runner is pinned to there. */
const commitOf = (root: string) =>
  existsSync(join(root, 'cache', 'wpt', '.git'))
    ? gitIn(join(root, 'cache', 'wpt'), 'rev-parse', 'HEAD')
    : COMMIT;

function inTemp(name: string, body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), `ng-native-wpt-${name}-`));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * `node wpt/<script> ...args`, with the cache and the expectations in `root`, pinned to the
 * commit of the checkout there, and `PASSING` page b's second test, as `env` does not say.
 */
function nodeWith(env: Record<string, string>, root: string, script: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [join(HERE, script), ...args], {
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    // A run that never ends fails the test, not the suite.
    timeout: 60_000,
    env: {
      ...process.env,
      WPT_CACHE: join(root, 'cache'),
      WPT_EXPECTATIONS: join(root, 'expectations.json'),
      WPT_REPOSITORY: join(root, 'no-repository'),
      WPT_COMMIT: commitOf(root),
      PASSING: 'b',
      ...env,
    },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}
const node = (root: string, script: string, ...args: string[]) =>
  nodeWith({}, root, script, ...args);

test('--check passes on what --update recorded, and fails on a file passing less or more', () => {
  inTemp('check', (root) => {
    checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    assert.equal(recorded.files['dom/nodes/a.html'].pass, 1);
    assert.equal(node(root, 'run.mjs', '--check').status, 0);

    const better = nodeWith({ PASSING: 'a b' }, root, 'run.mjs', '--check');
    assert.equal(better.status, 1, better.out);
    assert.match(better.out, /1 files differ from the expectations: record them with --update/);

    const worse = nodeWith({ PASSING: '' }, root, 'run.mjs', '--check');
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
    assert.equal(recorded.commit, commitOf(root));
    assert.equal(recorded.files['dom/nodes/gone.html'], undefined, 'none of the old carried over');
  });
});

test('--check fails where a recorded file was not run, with a filter too', () => {
  inTemp('missing', (root) => {
    checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    const path = join(root, 'expectations.json');
    const recorded = JSON.parse(readFileSync(path, 'utf8'));
    recorded.files['dom/nodes/gone.html'] = recorded.files['dom/nodes/a.html'];
    writeFileSync(path, JSON.stringify(recorded));
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
    checkout(root);
    assert.equal(node(root, 'run.mjs', '--update').status, 0);
    const run = nodeWith({ CRASH: 'a' }, root, 'run.mjs', '--check');
    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /CRASH dom\/nodes\/a\.html/);
  });
});

test('the runner refuses a checkout that is missing, of another commit, changed or not whole', () => {
  inTemp('refuse', (root) => {
    const refused = (run: { status: number | null; out: string }) => {
      assert.equal(run.status, 2, run.out);
      assert.match(run.out, /the tests are not fetched/);
    };
    refused(node(root, 'run.mjs', '--check'));

    const at = checkout(root, { commit: 'another' });
    refused(node(root, 'run.mjs', '--check'));

    // Stamped as fetched at the pinned commit, and checked out at another since.
    checkout(root);
    const pinned = commitOf(root);
    gitIn(at, 'commit', '--quiet', '--allow-empty', '-m', 'moved');
    refused(nodeWith({ WPT_COMMIT: pinned }, root, 'run.mjs', '--check'));

    // A test changed, a file added and the harness gone are each not what was fetched.
    checkout(root);
    writeFileSync(join(at, 'dom', 'nodes', 'a.html'), twoTests('b'));
    refused(node(root, 'run.mjs', '--check'));
    gitIn(at, 'checkout', '--', '.');
    writeFileSync(join(at, 'dom', 'nodes', 'c.html'), twoTests('c'));
    refused(node(root, 'run.mjs', '--check'));
    rmSync(join(at, 'dom', 'nodes', 'c.html'));
    rmSync(join(at, 'resources', 'testharness.js'));
    refused(node(root, 'run.mjs', '--check'));

    checkout(root);
    rmSync(join(at, SUITES.at(-1)), { recursive: true });
    const partial = node(root, 'run.mjs', '--check');
    assert.equal(partial.status, 2, partial.out);
    assert.match(partial.out, /wpt run failed: ENOENT/);
  });
});

test('a count that is not a whole number above nothing is refused, not run on', () => {
  inTemp('options', (root) => {
    checkout(root);
    for (const flag of ['--batch=0', '--batch=-1', '--batch=many', '--timeout=0', '--hang=1.5']) {
      const run = node(root, 'run.mjs', flag);
      assert.equal(run.status, 2, `${flag}: ${run.out}`);
      assert.match(run.out, /must be a whole number above 0/);
    }
  });
});

test('a page with a module script is skipped, not run as a classic one', () => {
  inTemp('module', (root) => {
    const module = page('').replace('<script>', '<script type="module">');
    checkout(
      root,
      {},
      { 'm.html': `${module}<script>test(function () {}, 'one'); done();</script>` },
    );
    const run = node(root, 'run.mjs', '--update');
    assert.equal(run.status, 0, run.out);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    assert.equal(recorded.files['dom/nodes/m.html'], undefined, run.out);
    assert.ok(recorded.files['dom/nodes/a.html']);
    assert.match(run.out, /module script/);
  });
});

test('a classic script of any JavaScript type is run, with white space about it', () => {
  inTemp('types', (root) => {
    const typed = (type: string) =>
      page('').replace(
        '<script></script>',
        `<script type="${type}">test(function () {}, 'one'); done();</script>`,
      );
    checkout(
      root,
      {},
      { 'x.html': typed('text/x-javascript'), 'w.html': typed(' text/JavaScript\n') },
    );
    const run = node(root, 'run.mjs', '--update', '--timeout=500');
    assert.equal(run.status, 0, run.out);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    for (const name of ['x.html', 'w.html']) {
      assert.equal(recorded.files[`dom/nodes/${name}`].status, 'OK', name);
      assert.equal(recorded.files[`dom/nodes/${name}`].pass, 1, name);
    }
  });
});

test('a file that throws as it is run is a CRASH with what its page had and how long it took', () => {
  inTemp('thrown', (root) => {
    // The paragraph cannot be made, which is a page error, nor the span made in its place.
    const refuse = "document.createElement = function () { throw new Error('refused'); };";
    const broken = `${page(refuse)}<p></p>`;
    checkout(root, {}, { 'z.html': broken });
    const run = node(root, 'run.mjs', '--update');
    assert.equal(run.status, 0, run.out);
    const results = JSON.parse(readFileSync(join(root, 'cache', 'results.json'), 'utf8'));
    const crashed = results['dom/nodes/z.html'];
    assert.equal(crashed.status, 'CRASH', run.out);
    assert.ok(crashed.ms > 0, JSON.stringify(crashed));
    assert.equal(crashed.pageErrors.length, 1, JSON.stringify(crashed));
    assert.deepEqual(crashed.namedAccess, []);
  });
});

test('a page that loads a script the checkout does not have is skipped as that', () => {
  inTemp('absent', (root) => {
    const absent = '<script src="/dom/absent.js"></script>';
    checkout(root, {}, { 'n.html': page('').replace('<script></script>', absent) });
    const run = node(root, 'run.mjs', '--update');
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /loads a script the checkout does not have/);
    assert.doesNotMatch(run.out, /outside the checkout/);
  });
});

test('an option the runner does not know is refused, not run without', () => {
  inTemp('unknown', (root) => {
    checkout(root);
    for (const flag of ['--chek', '--update=yes', '--dump']) {
      const run = node(root, 'run.mjs', flag);
      assert.equal(run.status, 2, `${flag}: ${run.out}`);
      assert.match(run.out, new RegExp(`${flag}: not an option`));
    }
  });
});

test('a pin replaced from the environment is said, so a stray variable is seen', () => {
  inTemp('overridden', (root) => {
    checkout(root);
    const run = node(root, 'run.mjs', '--update');
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /WPT_COMMIT, WPT_REPOSITORY, WPT_CACHE replace the pin/);
  });
});

test('a page that loads a script from outside the checkout is skipped, not run', () => {
  inTemp('outside', (root) => {
    const outside = '<script src="../../../outside.js"></script>';
    checkout(root, {}, { 'o.html': page('').replace('<script></script>', outside) });
    writeFileSync(join(root, 'cache', 'outside.js'), "test(function () {}, 'one'); done();");
    const run = node(root, 'run.mjs', '--update');
    assert.equal(run.status, 0, run.out);
    const recorded = JSON.parse(readFileSync(join(root, 'expectations.json'), 'utf8'));
    assert.equal(recorded.files['dom/nodes/o.html'], undefined, run.out);
    assert.match(run.out, /loads a script outside the checkout/);
  });
});

test('a path that climbs out of the checkout, or an encoded slash hides climbing, is not in it', () => {
  assert.equal(inCheckout('dom/nodes/a.html'), join(CHECKOUT, 'dom/nodes/a.html'));
  // What a frame's URL is read as, with `%2f` decoded after the URL took out its own `..`.
  const frame = new URL('http://web-platform.test:8000/dom/..%2f..%2foutside.html');
  for (const path of [
    '../outside.js',
    'dom/../../outside.js',
    decodeURIComponent(frame.pathname),
  ]) {
    assert.equal(inCheckout(path), undefined, path);
  }
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

test('a fetch run from a path a URL escapes still runs, and fails closed', () => {
  inTemp('escaped', (root) => {
    const at = join(root, 'a #1 %20');
    mkdirSync(at);
    for (const script of ['fetch.mjs', 'pin.mjs']) {
      writeFileSync(join(at, script), readFileSync(join(HERE, script)));
    }
    const ran = spawnSync(process.execPath, [join(at, 'fetch.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, WPT_CACHE: join(root, 'cache'), WPT_REPOSITORY: join(root, 'none') },
    });
    assert.equal(ran.status, 1, `${ran.stdout}${ran.stderr}`);
    assert.match(ran.stderr, /wpt fetch failed/);
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
