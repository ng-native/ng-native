/**
 * The `CSS` global a library asks before it decides what to write: `escape`, and `supports`,
 * which answers for what a stylesheet made at run time is read with.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { sheetOf } from './runtime-style.ts';

/** What a library sees of the window: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {}

afterEach(cleanup);

const page = async () => {
  await render(Page, { providers: [provideWebCompat()] });
  await settle();
};

const globals = globalThis as Dom;

describe('CSS.escape', () => {
  it('writes an identifier as the CSSOM serialises one', async () => {
    await page();
    const { escape } = globals.CSS;
    assert.equal(escape('a b'), 'a\\ b');
    assert.equal(escape('0a'), '\\30 a');
    assert.equal(escape('-0'), '-\\30 ');
    assert.equal(escape('-'), '\\-');
    assert.equal(escape('--a'), '--a');
    assert.equal(escape('a\0b'), 'a�b');
    assert.equal(escape('\x01\x7f'), '\\1 \\7f ');
    assert.equal(escape('é_-x9'), 'é_-x9');
    assert.equal(escape('a.b#c:d'), 'a\\.b\\#c\\:d');
    assert.equal(escape.length, 1);
    assert.equal(String(globals.CSS), '[object CSS]');
    assert.throws(() => escape(), TypeError);
  });
});

describe('CSS.supports', () => {
  it('says yes only to what a stylesheet made at run time is read with', async () => {
    await page();
    const { supports } = globals.CSS;
    assert.equal(supports('display', 'flex'), true);
    assert.equal(supports('DISPLAY', 'flex'), true, 'a property is named in any case');
    assert.equal(supports('width', '10px'), true);
    assert.equal(supports('color', 'red'), true);
    assert.equal(supports('padding', 'var(--gap)'), true);
    assert.equal(supports('--anything', 'at all'), true);
    // A mix, which a chart library asks before it brightens a colour of its palette by one.
    assert.equal(supports('color', 'color-mix(in srgb,red,blue 9%)'), true);
    assert.equal(supports('width', 'color-mix(in srgb,red,blue 9%)'), false);
    // But not a mix of a token, which the engine does not work out.
    assert.equal(supports('fill', 'color-mix(in srgb, var(--a), white 20%)'), true);
    // What that reader passes over: a library told yes would write what is dropped.
    assert.equal(supports('display', 'table-cell'), false);
    assert.equal(supports('transform', 'rotate(1deg)'), false);
    assert.equal(supports('-webkit-backdrop-filter', 'none'), false);
    assert.equal(supports('color', 'red !important'), false);
    assert.equal(supports(' width', '10px'), false);
    assert.equal(supports('width', 'wide'), false);
    assert.throws(() => supports(), TypeError);
  });

  it('reads a condition: not, and, or, and selector()', async () => {
    await page();
    const { supports } = globals.CSS;
    assert.equal(supports('(display: flex)'), true);
    assert.equal(supports('display: flex'), true, 'with no brackets, as a browser takes it');
    assert.equal(supports('not (display: table-cell)'), true);
    assert.equal(supports('(display: flex) and (transform: none)'), false);
    assert.equal(supports('(display: flex) or (transform: none)'), true);
    assert.equal(supports('((width: 1px) and (height: 2px)) or (x: y)'), true);
    assert.equal(supports('selector(.a > .b)'), true);
    assert.equal(supports('selector(:focus-visible)'), false);
    assert.equal(supports('font-tech(color-COLRv1)'), false);
    // No condition at all, which a browser says no to rather than throwing.
    assert.equal(supports('(display: flex) and (width: 1px) or (height: 1px)'), false);
    assert.equal(supports('not(display: flex)'), false);
    assert.equal(supports('(display: flex'), false);
  });

  it('is what @supports in a stylesheet made at run time holds for', () => {
    const sheet = sheetOf(
      '@supports (display: flex) { .a { width: 1px } } @supports (transform: none) { .b { width: 2px } }',
    );
    assert.deepEqual(
      sheet.rules.map((rule) => rule.compounds[0]!.classes),
      [['a']],
    );
  });
});
