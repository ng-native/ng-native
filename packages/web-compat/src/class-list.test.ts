/**
 * `classList` as a browser's `DOMTokenList`: read by place, written as a whole, each class it is
 * handed checked before any is put in.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const element = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document.createElement('div');
};

const nameOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).name;
  }
  return 'none';
};

describe('classList', () => {
  it('is the same list each time, read by place and as a string', async () => {
    const div = await element();
    assert.equal(div.classList === div.classList, true);
    div.className = 'a b';
    assert.equal(div.classList[0], 'a');
    assert.equal(div.classList[1], 'b');
    assert.equal(div.classList[2], undefined);
    assert.equal(1 in div.classList, true);
    assert.equal(String(div.classList), 'a b');
    assert.deepEqual([...div.classList], ['a', 'b']);
  });

  it('takes the classes written to it, and to its value', async () => {
    const div = await element();
    div.classList = 'x y';
    assert.equal(div.className, 'x y');
    div.classList.value = 'z';
    assert.equal(div.className, 'z');
  });

  it('checks every class before it changes any, and takes a non-string as its string', async () => {
    const div = await element();
    assert.equal(
      nameOf(() => div.classList.add('a', '')),
      'SyntaxError',
    );
    assert.equal(
      nameOf(() => div.classList.toggle(' ', true)),
      'InvalidCharacterError',
    );
    assert.equal(div.getAttribute('class'), null);
    div.classList.add(null);
    assert.equal(div.classList.contains(null), true);
    assert.equal(div.classList.toggle(null), false);
    assert.equal(div.classList.replace('a', 'a'), false);
    div.classList.add('a');
    assert.equal(div.classList.replace('a', 'a'), true);
    assert.equal(
      nameOf(() => div.classList.supports('a')),
      'TypeError',
    );
  });

  it('leaves no class attribute where there was none and nothing changes', async () => {
    const div = await element();
    div.classList.remove('a');
    div.classList.toggle('a', false);
    assert.equal(div.getAttribute('class'), null);
  });
});

describe('the class attribute', () => {
  it('reads back as it was written while the classes are still those', async () => {
    const div = await element();
    div.setAttribute('class', '  a  a b ');
    assert.equal(div.getAttribute('class'), '  a  a b ');
    assert.equal(String(div.classList), '  a  a b ');
    div.classList.toggle('a', true);
    assert.equal(div.className, '  a  a b ');
    div.classList.remove('a');
    assert.equal(div.className, 'b');
    div.setAttribute('class', '');
    assert.equal(div.getAttribute('class'), '');
    assert.equal(div.hasAttribute('class'), true);
    div.removeAttribute('class');
    assert.equal(div.getAttribute('class'), null);
  });

  it('reads the classes where something else changed them since', async () => {
    const div = await element();
    div.setAttribute('class', ' a ');
    div.classList.add('b');
    assert.equal(div.getAttribute('class'), 'a b');
    div.setAttribute('class', ' c ');
    (div as { classes: Set<string> }).classes.add('d');
    assert.equal(div.getAttribute('class'), 'c d');
  });
});
