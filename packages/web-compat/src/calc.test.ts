/**
 * `calc()` in an inline style, worked out here: what a library computes and binds as the app
 * runs, where a stylesheet's is worked out as the app is built.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reduceCalc } from './calc.ts';

describe('@ng-native/web-compat calc()', () => {
  it('works a sum of percentages and pixels out to the one sum of the two', () => {
    // A grid list's tile, three columns of four with a gutter of 8.
    assert.equal(reduceCalc('calc(((25% - (8px * 0.75)) * 3) + (2 * 8px))'), 'calc(75% + -2px)');
    assert.equal(reduceCalc('calc((100% - 24px) / 4)'), 'calc(25% + -6px)');
    assert.equal(reduceCalc('calc(50% - 2px)'), 'calc(50% + -2px)');
    assert.equal(reduceCalc('calc(10px + 30%)'), 'calc(30% + 10px)');
  });

  it('answers a number of points or a percentage where that is all it comes to', () => {
    assert.equal(reduceCalc('calc(2 * 8px)'), 16);
    assert.equal(reduceCalc('calc((80px * 2) + 8px)'), 168);
    assert.equal(reduceCalc('calc(50% * 2)'), '100%');
    assert.equal(reduceCalc('calc(25% - 25%)'), 0);
    assert.equal(reduceCalc('calc(10px - -2.5px)'), 12.5);
    assert.equal(reduceCalc('CALC( 4px+4px )'), 8);
  });

  it('answers nothing for what is not such a sum, which is left as written', () => {
    for (const value of [
      '12px',
      'calc(var(--gap) * 2)',
      'calc(1em + 2px)',
      'calc(10px * 10px)',
      'calc(2 / 10px)',
      'calc(10px / 0)',
      'calc(10px + 2)',
      'calc((10px + 2px)',
      'calc(10px 2px)',
      'calc()',
    ]) {
      assert.equal(reduceCalc(value), undefined, value);
    }
  });
});
