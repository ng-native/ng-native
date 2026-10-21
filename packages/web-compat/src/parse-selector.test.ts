/**
 * A selector read as a browser reads one: what may come after a pseudo-element, what `:host()`
 * and `::slotted()` take, and an `an+b` too large to keep, each as `querySelector` and
 * `selectorText` see it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSelectorList } from './parse-selector.ts';
import { serializeSelectorList } from './serialize-selector.ts';

const written = (text: string): string => serializeSelectorList(parseSelectorList(text));
const refused = (text: string): void =>
  assert.throws(() => parseSelectorList(text), { name: 'SyntaxError' }, text);

describe('a selector', () => {
  it('has after a pseudo-element only what may follow it', () => {
    for (const text of [
      '::part(foo):lang(en)',
      '::part(foo):dir(ltr)',
      '::part(foo)::before',
      'span::-webkit-x:hover',
    ]) {
      assert.equal(written(text), text);
    }
    for (const text of [
      'span::-webkit-x::before',
      '::slotted(foo):hover',
      '::slotted(foo):first-child',
      '::part(foo):has(li)',
      '::before:first-child',
    ]) {
      refused(text);
    }
  });

  it('takes one compound in :host() and ::slotted(), and writes what does not fit as it was', () => {
    refused(':host(:not(.a .b))');
    refused('::slotted()');
    refused('::slotted(0)');
    assert.equal(written(':host(:is(.a, .b+.c, .d))'), ':host(:is(.a, .b+.c, .d))');
    assert.equal(written("::part(foo):is([attr='value'])"), "::part(foo):is([attr='value'])");
    assert.equal(
      written('::slotted(:has(:first-child:last-child))'),
      '::slotted(:has(:first-child:last-child))',
    );
  });

  it('writes a pseudo-element by its name, escaped where it must be', () => {
    assert.equal(written('::-WeBkIt-x, ::-webkit-\\ escaped'), '::-webkit-x, ::-webkit-\\ escaped');
  });

  it('keeps an an+b as a whole number of 32 bits', () => {
    assert.equal(written(':nth-child(100000000000000000000)'), ':nth-child(2147483647)');
    assert.equal(written(':nth-child(2n+100000000000000000000)'), ':nth-child(2n+2147483647)');
  });
});
