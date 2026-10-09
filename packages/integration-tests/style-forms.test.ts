/**
 * A style written as a string, which is the form this project's own doc comments recommend.
 *
 * `<view style="flex: 1">` reaches the renderer as one `setAttribute('style', 'flex: 1')` rather
 * than as a styling instruction, and `setAttribute` handed the whole string to the engine as the
 * `style` prop. `flattenStyle` merges objects and arrays of objects; a string is neither, so it
 * fell through and returned the props unchanged - the declaration compiled, committed nothing, and
 * said nothing about it. Every `style="flex: 1"` in this repo's documentation was a no-op.
 *
 * The bound-string form did arrive, because Angular parses it, but not intact: a unitless number
 * reached Fabric as the string `'1'` where the object form gives `1`. Yoga wants a number, and the
 * two forms of the same declaration disagreeing is its own bug.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('the four ways to write a style', () => {
  let props: Record<string, Record<string, unknown>>;

  before(async () => {
    const mod = await compileFixture('fixtures/style-forms.ts');
    await render(mod['StyleForms'] as Type<unknown>);
    props = Object.fromEntries(
      ['static', 'bound-string', 'bound-object', 'single'].map((id) => [
        id,
        screen.getByTestId(id).props,
      ]),
    );
    cleanup();
  });

  it('commits a static string attribute', () => {
    assert.equal(props['static']!['flex'], 1);
    assert.equal(props['static']!['marginTop'], 4);
  });

  it('commits a bound string', () => {
    assert.equal(props['bound-string']!['flex'], 1);
    assert.equal(props['bound-string']!['marginTop'], 5);
  });

  it('commits an object, which is the form that always worked', () => {
    assert.equal(props['bound-object']!['flex'], 1);
    assert.equal(props['bound-object']!['marginTop'], 6);
  });

  it('commits a single property with a unit', () => {
    assert.equal(props['single']!['marginTop'], 7);
  });

  it('agrees with itself: every form gives the same node the same props', () => {
    // The point of the other four. A design that reads `flex: 1` should not depend on which of
    // four spellings the author reached for.
    assert.deepEqual(
      new Set(['static', 'bound-string', 'bound-object'].map((id) => props[id]!['flex'])),
      new Set([1]),
    );
  });
});
