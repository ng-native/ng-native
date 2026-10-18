/**
 * `scripts/pr-gate.mjs`: what it reads of the benchmarks and of `git diff`, and how it decides a
 * pull request is slower, has changed existing tests, or owes a version plan.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// A script of the repository's, not a package: loaded by its path, which no import can name.
const { compareBenches, editedTests, medians, needsPlan } = await import(
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
  });
});
