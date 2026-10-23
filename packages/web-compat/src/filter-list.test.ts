/**
 * A filter's text as the list a native view reads: what the text of each function comes to, and
 * the text that comes to no filter at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filtersOf } from './filter-list.ts';

describe('filtersOf', () => {
  it('is no filter where any function has a value native has no form of', () => {
    for (const text of [
      'brightness(red)',
      'blur(1em)',
      'hue-rotate(10)',
      'drop-shadow(1px red)',
      'drop-shadow(1px 2px 3px 4px)',
      'drop-shadow(1px 2px red blue)',
      'blur(2px) sepia(1',
    ]) {
      assert.equal(filtersOf(text), null, text);
    }
  });

  it('keeps a list it is given, and is no filter for anything else that is not text', () => {
    const list = [{ blur: 2 }];
    assert.equal(filtersOf(list), list);
    assert.equal(filtersOf(undefined), null);
    assert.equal(filtersOf(3), null);
  });
});
