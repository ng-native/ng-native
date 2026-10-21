/**
 * How far today's layout is from Chrome's, fixture by fixture.
 *
 * `oracle/chrome.json` is where Chrome puts each box, and each candidate has a list of the fixtures
 * it gets wrong: `oracle/today.json` for what a device does now. A list is pinned both ways: a fixture that starts to fail is a
 * regression, and one that starts to pass has to come off the list, so the score cannot drift.
 *
 *   LAYOUT_UPDATE=1 pnpm test    rewrite the list after a deliberate change
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { firstDifference } from './compare.ts';
import { fixtureNames, parseFixture, type Box } from './fixture.ts';
import { layOutToday } from './yoga-baseline.ts';
import { layOutWithGrids } from './grid-yoga.ts';
import { lowerBlocks } from './flow-lowering.ts';
import { correctFromLayout } from './read-back.ts';

const file = (name: string) => fileURLToPath(new URL(`../oracle/${name}`, import.meta.url));
const oracle = JSON.parse(readFileSync(file('chrome.json'), 'utf8')) as Record<string, Box>;

/** A candidate that throws on a fixture gets it wrong, and says how. */
function attempt(compare: () => string | undefined): string | undefined {
  try {
    return compare();
  } catch (error) {
    return `threw ${(error as Error).message}`;
  }
}

/** Each way of laying a fixture out, and the file listing what it gets wrong. */
const CANDIDATES = {
  today: (name: string) => layOutToday(parseFixture(name)),
  strict: (name: string) => layOutToday(parseFixture(name), 'strict'),
  lowering: (name: string) => layOutToday(lowerBlocks(parseFixture(name))),
  'lowering-strict': (name: string) => layOutToday(lowerBlocks(parseFixture(name)), 'strict'),
  grid: (name: string) =>
    layOutWithGrids(correctFromLayout(lowerBlocks(parseFixture(name)), 'strict'), 'strict'),
  'read-back': (name: string) =>
    layOutToday(correctFromLayout(lowerBlocks(parseFixture(name)), 'strict'), 'strict'),
} as const;

for (const [candidate, layOut] of Object.entries(CANDIDATES)) {
  describe(`${candidate} against Chrome`, () => {
    const names = fixtureNames();
    const differences = new Map<string, string>();
    for (const name of names) {
      const expected = oracle[name];
      const difference = expected
        ? attempt(() => firstDifference(layOut(name), expected))
        : 'no recorded box: run pnpm record';
      if (difference) differences.set(name, difference);
    }
    const failing = [...differences.keys()];

    if (process.env['LAYOUT_UPDATE']) {
      writeFileSync(file(`${candidate}.json`), `${JSON.stringify(failing, null, 2)}\n`);
    }
    const known = new Set(JSON.parse(readFileSync(file(`${candidate}.json`), 'utf8')) as string[]);

    it('records every fixture', () => {
      assert.deepEqual(Object.keys(oracle).sort(), [...names].sort());
    });

    it('fails no fixture it used to pass', () => {
      const regressed = failing.filter((name) => !known.has(name));
      assert.deepEqual(
        regressed.map((name) => `${name}  ${differences.get(name)}`),
        [],
      );
    });

    it('lists no fixture that now passes', () => {
      assert.deepEqual(
        [...known].filter((name) => !differences.has(name)),
        [],
      );
    });

    it('reports the score', (t) => {
      t.diagnostic(`${names.length - failing.length} of ${names.length} fixtures match Chrome`);
      for (const suite of new Set(names.map((name) => name.split('/')[0]!))) {
        const inSuite = names.filter((name) => name.startsWith(`${suite}/`));
        const passing = inSuite.filter((name) => !differences.has(name));
        t.diagnostic(`  ${suite}: ${passing.length} of ${inSuite.length}`);
      }
    });
  });
}
