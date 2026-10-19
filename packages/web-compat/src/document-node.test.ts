/**
 * A document as the node it is: taking nodes in, comparing itself, and the live list of the
 * elements by their name.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of a node or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document;
};

const nameOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).name;
  }
  return 'none';
};

describe('a document as a node', () => {
  it('imports a copy of a node, as deep as it is asked', async () => {
    const document = await page();
    const div = document.getElementById('page');
    div.appendChild(document.createElement('span'));
    const shallow = document.importNode(div);
    assert.equal(shallow.ownerDocument, document);
    assert.equal(shallow.firstChild, null);
    assert.equal(shallow.parentNode, null);
    const deep = document.importNode(div, true);
    assert.equal(deep.firstChild.ownerDocument, document);
    assert.notEqual(deep.firstChild, div.firstChild);
    assert.equal(div.parentNode === null, false, 'and the node is left where it is');
    assert.equal(document.importNode(document.doctype).ownerDocument, document);
    assert.equal(
      nameOf(() => document.importNode(document)),
      'NotSupportedError',
    );
    assert.equal(
      nameOf(() => document.importNode({})),
      'TypeError',
    );
  });

  it('adopts a node, taking it out of where it is', async () => {
    const document = await page();
    const element = document.createElement('div');
    document.getElementById('page').appendChild(element);
    assert.equal(document.adoptNode(element), element);
    assert.equal(element.parentNode, null);
    assert.equal(element.ownerDocument, document);
    const doctype = document.doctype;
    assert.equal(document.adoptNode(doctype), doctype);
    assert.equal(doctype.parentNode, null);
    assert.equal(document.doctype, null);
    assert.equal(
      nameOf(() => document.adoptNode(document)),
      'NotSupportedError',
    );
  });

  it('is the same as itself, and equal to a document that holds what it does', async () => {
    const document = await page();
    assert.equal(document.isSameNode(document), true);
    assert.equal(document.isSameNode(document.documentElement), false);
    assert.equal(document.isEqualNode(document), true);
    assert.equal(document.isEqualNode(document.documentElement), false);
  });

  it('places a document and a doctype among the nodes they hold', async () => {
    const document = await page();
    const element = document.getElementById('page');
    assert.equal(document.compareDocumentPosition(element), 16 | 4);
    assert.equal(element.compareDocumentPosition(document), 8 | 2);
    assert.equal(document.contains(element), true);
    assert.equal(document.contains(document.doctype), true);
    assert.equal(document.contains(null), false);
    assert.equal(document.doctype.compareDocumentPosition(element), 4);
    assert.equal(element.compareDocumentPosition(document.doctype), 2);
    assert.equal(
      nameOf(() => element.compareDocumentPosition(null)),
      'TypeError',
    );
  });

  it('names the page a document with no value, text or parent', async () => {
    const document = await page();
    assert.deepEqual(
      [document.nodeName, document.nodeValue, document.textContent, document.parentNode],
      ['#document', null, null, null],
    );
    assert.deepEqual([document.parentElement, document.ownerDocument], [null, null]);
    document.textContent = 'a';
    assert.equal(document.textContent, null);
  });

  it('has no element above what is in a fragment', async () => {
    const document = await page();
    const fragment = document.createDocumentFragment();
    const element = fragment.appendChild(document.createElement('i'));
    assert.equal(element.parentNode, fragment);
    assert.equal(element.parentElement, null);
    assert.deepEqual([fragment.tagName, fragment.localName], [undefined, null]);
  });
});

describe('getElementsByName', () => {
  it('is a live list of the HTML elements with that name, in the order of the page', async () => {
    const document = await page();
    const list = document.getElementsByName('a');
    assert.equal(Object.prototype.toString.call(list), '[object NodeList]');
    assert.equal(list.length, 0);
    const input = document.body.appendChild(document.createElement('input'));
    const span = document.body.appendChild(document.createElement('span'));
    const other = document.body.appendChild(document.createElement('i'));
    try {
      input.setAttribute('name', 'a');
      span.setAttribute('name', 'a');
      other.setAttribute('name', 'A');
      assert.deepEqual(
        [...list].map((each) => each.localName),
        ['input', 'span'],
      );
      input.removeAttribute('name');
      assert.deepEqual(
        [...list].map((each) => each.localName),
        ['span'],
      );
    } finally {
      for (const each of [input, span, other]) each.remove();
    }
  });
});
