/**
 * A document's `<!DOCTYPE>`, as `document.doctype` answers and `createDocumentType` makes one: a
 * node a script reads, compares, copies, takes out of its document, puts back and moves between
 * documents.
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

describe('document types', () => {
  it('are nodes with no value, no text and nothing in them', async () => {
    const document = await page();
    const doctype = document.doctype.cloneNode();
    assert.ok(doctype instanceof (globalThis as Dom).DocumentType);
    assert.deepEqual(
      [doctype.nodeType, doctype.nodeName, doctype.name, doctype.publicId, doctype.systemId],
      [10, 'html', 'html', '', ''],
    );
    assert.equal(doctype.ownerDocument, document);
    assert.equal(doctype.nodeValue, null);
    doctype.textContent = 'b';
    assert.equal(doctype.textContent, null);
    assert.equal(doctype.DOCUMENT_TYPE_NODE, 10);
    assert.equal(doctype.hasChildNodes(), false);
    assert.equal(
      nameOf(() => doctype.appendChild(document.createTextNode('a'))),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doctype.removeChild(document.createTextNode('a'))),
      'NotFoundError',
    );
    assert.equal(
      nameOf(() => new (globalThis as Dom).DocumentType()),
      'TypeError',
    );
  });

  it('are the same only as themselves, and equal by their names', async () => {
    const document = await page();
    const one = document.doctype;
    const copy = one.cloneNode();
    assert.equal(one.isSameNode(one), true);
    assert.equal(one.isSameNode(copy), false);
    assert.notEqual(copy, one);
    assert.equal(copy.isEqualNode(one), true);
    assert.equal(copy.isEqualNode(document.documentElement), false);
  });

  it('are in the document they are given to, until they are removed', async () => {
    const document = await page();
    const doctype = document.doctype.cloneNode();
    assert.equal(doctype.parentNode, null);
    assert.equal(doctype.isConnected, false);
    doctype.remove();
    document.doctype.remove();
    document.prepend(doctype);
    assert.equal(doctype.parentNode, document);
    assert.equal(doctype.isConnected, true);
    assert.equal(document.doctype, doctype);
    assert.equal(document.childNodes[0], doctype);
    assert.equal(doctype.getRootNode(), document);
    doctype.remove();
    assert.equal(doctype.parentNode, null);
    assert.equal(document.doctype, null);
    assert.equal(document.childNodes.length, 1);
  });

  it('is the page’s, an HTML one', async () => {
    const document = await page();
    assert.ok(document.doctype instanceof (globalThis as Dom).DocumentType);
    assert.ok(document.doctype instanceof (globalThis as Dom).Node);
    assert.ok(document instanceof (globalThis as Dom).Node);
    assert.equal(document.doctype.name, 'html');
    assert.equal(document.doctype.parentNode, document);
    assert.equal(document.doctype, document.doctype);
  });

  it('are made with a name and two ids, and are in no namespace', async () => {
    const document = await page();
    const doctype = document.implementation.createDocumentType('foo', 'pub', 'sys');
    assert.ok(doctype instanceof (globalThis as Dom).DocumentType);
    assert.deepEqual(
      [doctype.nodeType, doctype.nodeName, doctype.name, doctype.publicId, doctype.systemId],
      [10, 'foo', 'foo', 'pub', 'sys'],
    );
    assert.equal(doctype.ownerDocument, document);
    assert.equal(doctype.lookupNamespaceURI(null), null);
    assert.equal(doctype.lookupPrefix('foo'), null);
    assert.equal(doctype.isDefaultNamespace(null), true);
    assert.equal(doctype.isDefaultNamespace('foo'), false);
  });

  it('refuses a name with whitespace or a closing bracket in it', async () => {
    const document = await page();
    assert.equal(
      nameOf(() => document.implementation.createDocumentType('edi:>', '', '')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.implementation.createDocumentType('edi:a ', '', '')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.implementation.createDocumentType('edi:"', '', '')),
      'none',
    );
  });

  it('is given to a document made with one', async () => {
    const document = await page();
    const doctype = document.implementation.createDocumentType('foo', '', '');
    const made = document.implementation.createDocument(null, 'foo', doctype);
    assert.equal(made.doctype, doctype);
    assert.equal(doctype.ownerDocument, made);
    assert.equal(doctype.parentNode, made);
    assert.equal(doctype.nextSibling, made.documentElement);
    const html = document.implementation.createHTMLDocument('t');
    assert.equal(html.doctype.name, 'html');
    assert.equal(html.doctype.parentNode, html);
  });

  it('are equal by their names and ids, and put in a made document until removed', async () => {
    const document = await page();
    const make = (name: string) => document.implementation.createDocumentType(name, 'p', 's');
    const one = make('a');
    assert.equal(one.isSameNode(make('a')), false);
    assert.equal(one.isEqualNode(make('a')), true);
    assert.equal(one.isEqualNode(make('b')), false);
    const made = document.implementation.createDocument(null, '', null);
    made.appendChild(one);
    assert.equal(one.parentNode, made);
    assert.equal(one.ownerDocument, made);
    assert.equal(made.doctype, one);
    assert.equal(made.childNodes[0], one);
    one.remove();
    assert.equal(one.parentNode, null);
    assert.equal(made.doctype, null);
    assert.equal(made.childNodes.length, 0);
  });
});
