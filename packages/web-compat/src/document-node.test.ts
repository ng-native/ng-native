/**
 * A document as the node it is, the page's and one a script makes: taking nodes in from other
 * documents, comparing itself, looking up a namespace, copying itself, the attributes it
 * reflects, and the live list of the elements by their name.
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

  it('places a made document and its doctype among the nodes they hold', async () => {
    const document = await page();
    const doctype = document.implementation.createDocumentType('r', '', '');
    const doc = document.implementation.createDocument(null, 'r', doctype);
    const child = doc.documentElement.appendChild(doc.createElement('c'));
    assert.equal(doc.compareDocumentPosition(child), 16 | 4);
    assert.equal(child.compareDocumentPosition(doc), 8 | 2);
    assert.equal(doctype.compareDocumentPosition(doc.documentElement), 4);
    assert.equal(doc.documentElement.compareDocumentPosition(doctype), 2);
    assert.deepEqual(
      [doc.contains(child), doc.contains(doctype), doc.contains(null)],
      [true, true, false],
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

  it('imports a copy of a node of a made document, and back', async () => {
    const document = await page();
    const doc = document.implementation.createHTMLDocument('t');
    const div = doc.body.appendChild(doc.createElement('div'));
    div.appendChild(doc.createElement('span'));
    const shallow = document.importNode(div);
    assert.equal(shallow.ownerDocument, document);
    assert.equal(shallow.firstChild, null);
    const deep = document.importNode(div, true);
    assert.equal(deep.firstChild.ownerDocument, document);
    assert.equal(div.ownerDocument, doc);
    const back = doc.importNode(deep, true);
    assert.equal(back.ownerDocument, doc);
    assert.equal(
      nameOf(() => document.importNode(doc)),
      'NotSupportedError',
    );
    assert.equal(
      nameOf(() => document.importNode({})),
      'TypeError',
    );
  });

  it('adopts a node into a made document, and back', async () => {
    const document = await page();
    const element = document.createElement('div');
    document.getElementById('page').appendChild(element);
    const doc = document.implementation.createDocument(null, null, null);
    assert.equal(doc.adoptNode(element), element);
    assert.equal(element.parentNode, null);
    assert.equal(element.ownerDocument, doc);
    document.adoptNode(element);
    assert.equal(element.ownerDocument, document);
    const doctype = document.doctype;
    assert.equal(document.adoptNode(doctype), doctype);
    assert.equal(doctype.parentNode, null);
    assert.equal(document.doctype, null);
    assert.equal(
      nameOf(() => document.adoptNode(doc)),
      'NotSupportedError',
    );
  });

  it('is the same as itself, and equal to a copy of itself', async () => {
    const document = await page();
    const doc = document.implementation.createDocument(null, 'r', null);
    doc.documentElement.appendChild(doc.createElement('c'));
    assert.equal(doc.isSameNode(doc), true);
    assert.equal(document.isSameNode(doc), false);
    const copy = doc.cloneNode(true);
    assert.notEqual(copy, doc);
    assert.equal(Object.getPrototypeOf(copy), Object.getPrototypeOf(doc));
    assert.equal(copy.documentElement.firstChild.localName, 'c');
    assert.equal(copy.documentElement.ownerDocument, copy);
    assert.equal(doc.isEqualNode(copy), true);
    assert.equal(doc.cloneNode().documentElement, null);
    assert.equal(doc.isEqualNode(doc.cloneNode()), false);
  });

  it('looks a namespace up through its element', async () => {
    const document = await page();
    assert.equal(document.lookupNamespaceURI(null), 'http://www.w3.org/1999/xhtml');
    assert.equal(document.isDefaultNamespace('http://www.w3.org/1999/xhtml'), true);
    const doc = document.implementation.createDocument(null, null, null);
    assert.equal(doc.lookupNamespaceURI(null), null);
    assert.equal(doc.isDefaultNamespace(null), true);
  });

  it('gives a made HTML document a title holding its text, an empty one too', async () => {
    const document = await page();
    const made = document.implementation.createHTMLDocument('');
    const title = made.head.firstChild;
    assert.equal(title.localName, 'title');
    assert.equal(title.childNodes.length, 1);
    assert.equal(title.firstChild.data, '');
    assert.equal(document.implementation.createHTMLDocument().head.childNodes.length, 0);
  });
});

describe("a document's reflected attributes", () => {
  it('reads and sets dir on its element', async () => {
    const document = await page();
    assert.equal(document.dir, '');
    document.dir = 'RTL';
    assert.equal(document.documentElement.getAttribute('dir'), 'RTL');
    assert.equal(document.dir, 'rtl');
    document.documentElement.setAttribute('dir', 'sideways');
    assert.equal(document.dir, '');
    document.documentElement.removeAttribute('dir');
  });

  it("reads and sets the colours on its body, by the body's attribute names", async () => {
    const document = await page();
    const names = {
      fgColor: 'text',
      linkColor: 'link',
      vlinkColor: 'vlink',
      alinkColor: 'alink',
      bgColor: 'bgcolor',
    };
    try {
      for (const [property, attribute] of Object.entries(names)) {
        assert.equal(document[property], '');
        document[property] = 'red';
        assert.equal(document.body.getAttribute(attribute), 'red');
        document.body.setAttribute(attribute, 'blue');
        assert.equal(document[property], 'blue');
      }
    } finally {
      for (const attribute of Object.values(names)) document.body.removeAttribute(attribute);
    }
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
    const svg = document.body.appendChild(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    );
    const other = document.body.appendChild(document.createElement('i'));
    try {
      input.setAttribute('name', 'a');
      span.setAttribute('name', 'a');
      svg.setAttribute('name', 'a');
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
      for (const each of [input, span, svg, other]) each.remove();
    }
  });
});
