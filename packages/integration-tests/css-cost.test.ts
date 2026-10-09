/**
 * What the CSS engine costs, and the baseline the planned rework has to beat.
 *
 * Assertions are on **work counts**, never on milliseconds. A compound comparison is deterministic
 * and a stopwatch is not, so a count catches the regression that matters (the walk went quadratic,
 * the cache stopped hitting) without being flaky on a loaded machine. Timings are printed for a
 * human to read, and asserted on only with a ceiling loose enough to mean something is badly wrong.
 *
 * Recorded against push-down resolution. The numbers it replaced, when
 * resolution walked up from every node calling `cascade` once per ancestor, were 175,050 rule
 * tests and 89 compound tests per node.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { Engine, StyleResolver, type StyleSheet, type StyleTarget } from '@ng-native/fabric';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ROWS = 1000;

interface Scale {
  setRows(rows: { id: number; label: string }[]): void;
}

const makeRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: i, label: `row ${i}` }));

async function mountRows(Component: Type<unknown>, rows: number) {
  const fabric = createFakeFabric();
  const app = mount(1, Component, fabric);
  await settle();

  resetStyleStats();
  const started = performance.now();
  (app.componentRef.instance as Scale).setRows(makeRows(rows));
  await settle();
  const elapsed = performance.now() - started;

  return { elapsed, stats: { ...styleStats } };
}

describe('what CSS costs', () => {
  let Plain: Type<unknown>;
  let Styled: Type<unknown>;

  before(async () => {
    Plain = (await compileFixture('fixtures/scale.ts'))['Scale'] as Type<unknown>;
    Styled = (await compileFixture('fixtures/scale-styled.ts'))['ScaleStyled'] as Type<unknown>;
  });

  it('costs nothing at all when a component has no stylesheet', async () => {
    const { stats } = await mountRows(Plain, ROWS);
    // The resolver returns on `!sheet` before doing anything, so an app that writes no CSS pays
    // literally zero. This is also why every scale and device number recorded before this test
    // says nothing about CSS: they were all measured on this path.
    assert.deepEqual(stats, { compoundTests: 0, ruleTests: 0, nodesResolved: 0, rulesFiled: 0 });
  });

  it('prices a 1000 row mount with and without a stylesheet', async () => {
    const plain = await mountRows(Plain, ROWS);
    const styled = await mountRows(Styled, ROWS);

    console.log(
      `      ${ROWS} rows: ${plain.elapsed.toFixed(0)}ms plain, ${styled.elapsed.toFixed(0)}ms styled ` +
        `(${(styled.elapsed / plain.elapsed).toFixed(1)}x)`,
    );
    console.log(
      `      ${styled.stats.nodesResolved} nodes resolved, ${styled.stats.ruleTests} rule tests, ` +
        `${styled.stats.compoundTests} compound tests ` +
        `(${(styled.stats.compoundTests / styled.stats.nodesResolved).toFixed(1)} per node)`,
    );

    // Two per row, the pressable and its text. Raw text nodes carry no sheet, and the static
    // subtree was resolved on the first commit and is reused: nothing about it changed, so the
    // resolver hands back the same object rather than recomputing an equal one.
    assert.equal(styled.stats.nodesResolved, 2000);
    // Not nodes x rules any more: rules are filed by key selector, so a node is only offered the
    // buckets its own name, id and classes can reach, plus the ones nothing can be keyed on. The
    // fixture's twenty-five rules become one or two tries per node instead of twenty-five, which
    // is what makes a utility sheet of hundreds affordable. Each node is still cascaded once per
    // commit however many descendants ask it for inherited values.
    assert.equal(styled.stats.ruleTests, 3000, 'was 50,000 before the rules were indexed');
    assert.equal(styled.stats.compoundTests, 6000, 'was 53,000');
  });

  it('re-resolves nothing when a commit changes one row out of a thousand', async () => {
    const fabric = createFakeFabric();
    const app = mount(1, Styled, fabric);
    await settle();
    const instance = app.componentRef.instance as Scale;
    instance.setRows(makeRows(ROWS));
    await settle();

    // Edit one label. Nothing else about the tree moved, so every other node must be handed back
    // its previous result rather than cascaded again: that is what makes the cache worth having,
    // and it is the property that breaks first if invalidation is ever widened carelessly.
    const rows = makeRows(ROWS);
    rows[500] = { id: 500, label: 'edited' };
    resetStyleStats();
    instance.setRows(rows);
    await settle();

    console.log(
      `      one row of ${ROWS} edited: ${styleStats.nodesResolved} nodes re-resolved, ` +
        `${styleStats.compoundTests} compound tests`,
    );
    assert.equal(styleStats.nodesResolved, 0, 'nothing needed cascading again');
    assert.equal(styleStats.compoundTests, 0);
  });

  it('costs the same per node however deep the tree is', () => {
    // The property push-down resolution exists to give us. Same sheet, same leaf, only the
    // nesting differs, so if resolution ever goes back to walking ancestors this diverges.
    const sheet: StyleSheet = {
      rules: Array.from({ length: 30 }, (_, i) => ({
        compounds: [{ classes: [`c${i}`] }],
        combinators: [],
        specificity: 1000,
        order: i,
        declarations: { color: `#${i}` },
      })),
    };

    const leafAtDepth = (depth: number): StyleTarget => {
      let node: StyleTarget | null = null;
      for (let i = 0; i < depth; i++) {
        node = {
          name: 'view',
          parent: node,
          classes: new Set([`c${i % 30}`]),
          props: {},
          sheet,
          hostSheet: null,
          styleCache: null,
          styleDirty: true,
        };
      }
      return node!;
    };

    const resolver = new StyleResolver(null, { width: 0, height: 0, colorScheme: 'light' });
    const costAt = (depth: number, epoch: number): number => {
      resetStyleStats();
      // Resolve every node on the chain, which is what a commit does.
      const chain: StyleTarget[] = [];
      for (let n: StyleTarget | null = leafAtDepth(depth); n; n = n.parent) chain.push(n);
      for (const node of chain.reverse()) resolver.resolve(node, epoch);
      return styleStats.compoundTests / chain.length;
    };

    const shallow = costAt(3, 1);
    const deep = costAt(30, 2);
    console.log(
      `      ${shallow.toFixed(1)} compound tests per node at depth 3, ${deep.toFixed(1)} at depth 30`,
    );
    assert.ok(
      Math.abs(deep - shallow) < 1,
      `per-node cost must not track depth, got ${shallow.toFixed(1)} vs ${deep.toFixed(1)}`,
    );
  });

  it('matches a row once where its place changed and it comes to be styled again', () => {
    // A row whose place changed is matched to see whether it can keep its style. Under stripes
    // none can, and each is then styled from the rules just found, not matched a second time.
    const { compileCss } = createRequire(import.meta.url)('@ng-native/metro/css/compile.cjs');
    const engine = new Engine(createFakeFabric(), 1, {
      globalStyles: compileCss('.row:nth-child(odd) { border-top-width: 3px }', 'app.css'),
    });
    const list = engine.createElement('view');
    engine.appendChild(engine.root, list);
    const row = () => {
      const node = engine.createElement('view');
      engine.setClasses(node, 'row');
      return node;
    };
    for (let i = 0; i < 10; i++) engine.appendChild(list, row());
    engine.commit();

    engine.insertBefore(list, row(), list.children[0]!);
    resetStyleStats();
    engine.commit();
    assert.equal(styleStats.ruleTests, 11, 'the one rule, tried against each of eleven rows');
  });
});
