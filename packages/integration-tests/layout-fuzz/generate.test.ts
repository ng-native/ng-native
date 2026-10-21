/**
 * The layout fuzzer's own parts that need no browser: a seed gives the same case every time, and
 * shrinking finds the smallest case a test still fails on.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boxes, stylesheet, type Case, type CaseNode } from './case.ts';
import { FEATURES, generate } from './generate.ts';
import { shrink } from './shrink.ts';

const ALL = new Set(FEATURES);

describe('the layout fuzzer', () => {
  it('generates the same case from the same seed', () => {
    for (const seed of [1, 2, 99, 12345]) {
      assert.deepEqual(generate(seed, ALL), generate(seed, ALL));
    }
  });

  it('generates different cases from different seeds', () => {
    const sheets = new Set(Array.from({ length: 50 }, (_, i) => stylesheet(generate(i, ALL).root)));
    assert.ok(sheets.size > 45, `only ${sheets.size} different cases of 50`);
  });

  it('writes only what the features it is given cover', () => {
    for (let seed = 0; seed < 200; seed++) {
      const css = stylesheet(generate(seed, new Set(['flex'])).root);
      assert.doesNotMatch(css, /grid|block|absolute|padding|margin|min-|max-|inline|none/, css);
    }
  });

  it('writes a later feature over the case the first ones make, moving none of their draws', () => {
    const first = new Set(FEATURES.slice(0, FEATURES.indexOf('margin-auto') + 1));
    const strip = (node: CaseNode): CaseNode => ({
      ...node,
      declarations: node.declarations.filter(([p]) => p !== 'order'),
      children: node.children.map(strip),
    });
    let written = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const widened = generate(seed, new Set([...first, 'order']));
      if (stylesheet(widened.root).includes('order')) written++;
      assert.deepEqual(strip(widened.root), generate(seed, first).root);
    }
    assert.ok(written > 10, `order written in only ${written} cases`);
  });

  it('shrinks a failing case to the boxes and declarations the failure needs', async () => {
    // Fails while some box has a percentage height under a box with a row direction.
    const fails = (test: Case) =>
      boxes(test.root).some(
        ({ node, parent }) =>
          node.declarations.some(([p, v]) => p === 'height' && v.endsWith('%')) &&
          parent?.declarations.some(([p, v]) => p === 'flex-direction' && v === 'row'),
      );
    const big = (() => {
      for (let seed = 0; ; seed++) {
        const test = generate(seed, ALL);
        if (fails(test) && boxes(test.root).length > 4) return test;
      }
    })();
    const small = await shrink(big, async (cases) => cases.map(fails));
    assert.ok(fails(small));
    assert.equal(boxes(small.root).length <= 3, true, stylesheet(small.root));
    const declarations = boxes(small.root).flatMap(({ node }) => node.declarations);
    assert.equal(declarations.length, 2, stylesheet(small.root));
  });
});
