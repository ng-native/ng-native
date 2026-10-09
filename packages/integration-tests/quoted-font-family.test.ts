/**
 * A quoted `font-family` in a style a template sets on an element.
 *
 * A stylesheet rule unquotes a family and keeps the first of a stack, as CSS reads it. A style on
 * the element has to do the same, or `'Inter-Bold'` reaches native with its quotes, names no
 * registered font, and the text draws in the system font.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('a quoted font-family on an element', () => {
  let family: (id: string) => unknown;

  before(async () => {
    const mod = await compileFixture('fixtures/quoted-font-family.ts');
    await render(mod['QuotedFontFamily'] as Type<unknown>);
    const ids = [
      'sheet',
      'sheet-stack',
      'static',
      'static-double',
      'static-stack',
      'bound-string',
      'single',
      'token',
      'sheet-escaped',
      'single-escaped',
    ];
    const props = Object.fromEntries(ids.map((id) => [id, screen.getByTestId(id).props]));
    family = (id) => props[id]!['fontFamily'];
    cleanup();
  });

  it('commits what a stylesheet rule commits', () => {
    assert.equal(family('sheet'), 'Inter-Bold');
    assert.equal(family('sheet-stack'), 'Inter Display');
  });

  for (const id of ['static', 'static-double', 'bound-string', 'single', 'token']) {
    it(`unquotes the family set by ${id}`, () => {
      assert.equal(family(id), family('sheet'));
    });
  }

  it('reads an escaped quote in a family, as a rule does', () => {
    assert.equal(family('sheet-escaped'), "D'Angelo");
    assert.equal(family('single-escaped'), family('sheet-escaped'));
  });

  it('takes the first family of a stack, as a rule does', () => {
    assert.equal(family('static-stack'), family('sheet-stack'));
  });
});
