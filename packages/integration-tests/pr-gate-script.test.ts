/**
 * `scripts/pr-gate.mjs`: what it reads of the benchmarks and of `git diff`, and how it decides a
 * pull request is slower, has changed existing tests, or owes a version plan.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
// A script of the repository's, not a package: loaded by its path, which no import can name.
const script = new URL('../../scripts/pr-gate.mjs', import.meta.url);
const { compareBenches, editedTests, medians, needsPlan, options, publishedOf } = await import(
  new URL('../../scripts/pr-gate.mjs', import.meta.url).href
);

describe('pr-gate', () => {
  it('reads the medians each benchmark prints, by name', () => {
    const output = [
      'create     median   12.34ms  min   11.00ms  {"nodes":10}',
      'feed, frame    median    1.50ms  (200 runs)',
      '               p95       2.00ms per frame',
      'common    first commit     3.1ms   dark restyle     4.2ms   token retheme     5.3ms   (60 rows, 20 runs)',
    ].join('\n');
    assert.deepEqual(medians(output), {
      create: 12.34,
      'feed, frame': 1.5,
      'common first commit': 3.1,
      'common dark restyle': 4.2,
      'common token retheme': 5.3,
    });
  });

  it('takes the median of the rounds on each side, and fails one slower than the limit', () => {
    const rounds = [
      { base: { create: 10, update: 5 }, head: { create: 10.2, update: 6 } },
      { base: { create: 11, update: 5 }, head: { create: 10.1, update: 5.9 } },
      { base: { create: 10.5, update: 5.2 }, head: { create: 10.4, update: 6.1 } },
    ];
    const [create, update] = compareBenches(rounds, 3);
    assert.equal(create.before, 10.5);
    assert.equal(create.after, 10.2);
    assert.equal(create.slower, false, 'faster is never a failure');
    assert.equal(update.before, 5);
    assert.equal(update.after, 6);
    assert.equal(Math.round(update.change), 20);
    assert.equal(update.slower, true);
    // Within the limit passes.
    assert.equal(compareBenches([{ base: { a: 100 }, head: { a: 102.9 } }], 3)[0].slower, false);
  });

  it('takes rounds that overlap for the machine, however far apart the medians are', () => {
    // A busy machine: the change's median is 6% over, but one of its rounds beat one of the base's.
    const rounds = [
      { base: { retheme: 19 }, head: { retheme: 20.3 } },
      { base: { retheme: 19.1 }, head: { retheme: 18.9 } },
      { base: { retheme: 21 }, head: { retheme: 20.4 } },
    ];
    const [retheme] = compareBenches(rounds, 3);
    assert.ok(retheme.change > 3);
    assert.equal(retheme.slower, false);
    assert.equal(retheme.noisy, true, 'and is marked, to be run again');
  });

  it('reports a measure one side printed and the other did not, and fails neither', () => {
    const compared = compareBenches([{ base: { gone: 1 }, head: { added: 2 } }], 3);
    assert.deepEqual(compared, [
      { name: 'added', missing: 'base' },
      { name: 'gone', missing: 'change' },
    ]);
  });

  it('lists the tests that were there before and changed, were renamed or went', () => {
    const changes = [
      'M\tpackages/a/src/thing.ts',
      'M\tpackages/a/src/thing.test.ts',
      'A\tpackages/a/src/new.test.ts',
      'D\tpackages/b/old.test.ts',
      'R100\tpackages/c/was.test.ts\tpackages/c/now.test.ts',
    ].join('\n');
    assert.deepEqual(editedTests(changes), [
      { status: 'M', file: 'packages/a/src/thing.test.ts', renamed: undefined },
      { status: 'D', file: 'packages/b/old.test.ts', renamed: undefined },
      { status: 'R', file: 'packages/c/was.test.ts', renamed: 'packages/c/now.test.ts' },
    ]);
  });

  it('asks for a version plan where a package changed, and for none for tests or scripts', () => {
    assert.equal(needsPlan('M\tpackages/fabric/src/engine.ts'), true);
    assert.equal(needsPlan('M\tpackages/metro/css/compile.cjs'), true);
    assert.equal(
      needsPlan('M\tpackages/fabric/src/engine.ts\nA\t.nx/version-plans/fix-thing.md'),
      false,
    );
    assert.equal(needsPlan('M\tpackages/integration-tests/css.test.ts'), false);
    assert.equal(needsPlan('A\tscripts/pr-gate.mjs\nM\texamples/canary/src/app/app.ts'), false);
    // A package that is never published, as its package.json says, is released by no plan.
    assert.equal(needsPlan('A\tpackages/layout/src/compare.ts', { layout: null }), false);
    assert.equal(needsPlan('M\tpackages/fabric/src/css.ts', { layout: null }), true);
  });

  it('reads a build as the source it is made from, and fails closed where it cannot', () => {
    const build = { outDir: 'dist', rootDir: 'src' };
    assert.deepEqual(publishedOf({ files: ['dist'] }, build), ['src']);
    // As written with a slash or every file under it.
    assert.deepEqual(publishedOf({ files: ['dist/'] }, build), ['src']);
    assert.deepEqual(publishedOf({ files: ['dist/**'] }, { outDir: 'dist/', rootDir: 'src/' }), [
      'src',
    ]);
    // A build of the package itself, one with no source, and none at all: all of it counts.
    assert.equal(publishedOf({ files: ['dist'] }, { outDir: 'dist', rootDir: '.' }), undefined);
    assert.equal(publishedOf({ files: ['dist'] }, { outDir: 'dist' }), undefined);
    assert.equal(publishedOf({ files: ['dist'] }, undefined), undefined);
    // What is not built is published as written, and a private package not at all.
    assert.deepEqual(publishedOf({ files: ['index.cjs'] }, undefined), ['index.cjs']);
    assert.equal(publishedOf({ private: true, files: ['dist'] }, build), null);
  });

  it('asks for a plan only for a file the package publishes, or one its build is made from', () => {
    // Each read from the package.json and tsconfig.build.json on disk.
    // web-compat publishes `dist`, built from `src`, and `build.cjs`, but not its WPT runner.
    assert.equal(needsPlan('M\tpackages/web-compat/src/dom/node.ts'), true);
    assert.equal(needsPlan('M\tpackages/web-compat/build.cjs'), true);
    assert.equal(needsPlan('A\tpackages/web-compat/wpt/run.mjs'), false);
    // web publishes `dist` and `vite.mjs`, not the browser tests' page.
    assert.equal(needsPlan('M\tpackages/web/vite.mjs'), true);
    assert.equal(needsPlan('M\tpackages/web/src/reset.css'), true);
    assert.equal(needsPlan('M\tpackages/web/browser/boot.ts'), false);
    assert.equal(needsPlan('M\tpackages/web/vitest.config.ts'), false);
    // As npm reads a glob: a leading `./`, `?` and a class of characters.
    assert.equal(needsPlan('M\tpackages/kit/src/a.ts', { kit: ['./src'] }), true);
    assert.equal(needsPlan('M\tpackages/kit/a1.cjs', { kit: ['a?.cjs'] }), true);
    assert.equal(needsPlan('M\tpackages/kit/ab.cjs', { kit: ['a[bc].cjs'] }), true);
    assert.equal(needsPlan('M\tpackages/kit/ad.cjs', { kit: ['a[bc].cjs'] }), false);
    // `**` reaches into any directory under it.
    assert.equal(needsPlan('M\tpackages/kit/lib/a/b/file.cjs', { kit: ['lib/**/*.cjs'] }), true);
    assert.equal(needsPlan('M\tpackages/kit/lib/file.cjs', { kit: ['lib/**/*.cjs'] }), true);
    assert.equal(needsPlan('M\tpackages/kit/other/file.cjs', { kit: ['lib/**/*.cjs'] }), false);
    // A pattern in `files` is anchored at the package, and `*` stays within a directory.
    assert.equal(needsPlan('M\tpackages/metro/transformer.cjs'), true);
    assert.equal(needsPlan('M\tpackages/metro/css/compile.cjs'), true);
    assert.equal(needsPlan('M\tpackages/metro/css/tools/generate.cjs'), false);
    assert.equal(needsPlan('M\tpackages/nx/application/index.cjs'), true);
    assert.equal(needsPlan('M\tpackages/nx/files/src/main.ts'), true);
    assert.equal(needsPlan('M\tpackages/testing/runner/loader.mjs'), true);
    assert.equal(needsPlan('M\tpackages/testing/vitest.config.ts'), false);
    // A package with no `files` publishes all of it but its tests.
    assert.equal(needsPlan('M\tpackages/thing/tools/make.mjs', { thing: undefined }), true);
    assert.equal(needsPlan('M\tpackages/thing/tools/make.test.mjs', { thing: undefined }), false);
  });

  it('prints its usage for --help and -h, and runs nothing', () => {
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(process.execPath, [fileURLToPath(script), flag], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert.equal(result.status, 0, `${flag} exits 0`);
      assert.match(result.stdout, /Usage: node scripts\/pr-gate\.mjs/);
      assert.match(result.stdout, /--base <ref>/);
      assert.doesNotMatch(result.stdout, /✅|❌/, 'no check ran');
    }
  });

  it('exits non-zero with its usage on a flag it does not know, running nothing', () => {
    for (const argv of [['--bogus'], ['--base'], ['stray'], ['--rounds', '0'], ['--base', '-h']]) {
      const result = spawnSync(process.execPath, [fileURLToPath(script), ...argv], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert.notEqual(result.status, 0, `${argv.join(' ')} fails`);
      assert.match(result.stderr, /Usage: node scripts\/pr-gate\.mjs/);
      assert.doesNotMatch(result.stdout, /✅|❌/, 'no check ran');
    }
  });

  it('rejects an inherited property name, a short flag as a value, and a bad benchmark number', () => {
    assert.throws(() => options(['constructor', 'ignored']), /unknown option constructor/);
    assert.throws(() => options(['--base', '-h']), /--base needs a value/);
    for (const rounds of ['0', '1.5', 'nope', '']) {
      assert.throws(() => options(['--rounds', rounds]), /--rounds needs a positive whole number/);
    }
    for (const limit of ['nope', 'Infinity', '']) {
      assert.throws(() => options(['--limit', limit]), /--limit needs a number/);
    }
    assert.equal(options(['--rounds', '2', '--limit', '0']).rounds, 2);
  });
});
