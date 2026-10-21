/**
 * Documents a script makes for itself, with `document.implementation` or `new Document()`: what
 * they are, what a sanitizer parses in one, and how an XML one names the elements it makes.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, ɵ_sanitizeHtml as sanitizeHtml } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
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

const globals = globalThis as Dom;

describe('made documents', () => {
  it('are an XMLDocument from createDocument and a Document from createHTMLDocument', async () => {
    const document = await page();
    const xml = document.implementation.createDocument(null, 'r', null);
    const html = document.implementation.createHTMLDocument('t');
    assert.equal(Object.getPrototypeOf(xml), globals.XMLDocument.prototype);
    assert.equal(Object.getPrototypeOf(html), globals.Document.prototype);
    assert.ok(xml instanceof globals.Document);
    assert.ok(!(html instanceof globals.XMLDocument));
    assert.ok(document instanceof globals.Document);
    assert.deepEqual(
      [xml.DOCUMENT_NODE, xml.nodeValue, xml.textContent, xml.location],
      [9, null, null, null],
    );
    xml.textContent = 'a';
    assert.equal(xml.documentElement.localName, 'r');
  });

  it('name an HTML element of an XML document as it is written, and one of the page upper case', async () => {
    const document = await page();
    const xhtml = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html');
    const made = xhtml.createElementNS('http://www.w3.org/1999/xhtml', 'Foo:bar');
    assert.deepEqual([made.tagName, made.nodeName], ['Foo:bar', 'Foo:bar']);
    assert.equal(xhtml.documentElement.tagName, 'html');
    const html = document.implementation.createHTMLDocument('');
    assert.equal(html.createElement('p').tagName, 'P');
    assert.equal(document.createElement('p').tagName, 'P');
  });

  it('compare an element by its names, not by tagName, which an XML document cases as written', async () => {
    const document = await page();
    const xhtml = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html');
    const html = document.implementation.createHTMLDocument();
    assert.ok(xhtml.createElement('head').isEqualNode(html.createElement('head')));
  });

  it('refuses a doctype that is none', async () => {
    const document = await page();
    assert.throws(() => document.implementation.createDocument(null, null, false), TypeError);
  });

  it('name an element an XML document makes as it is written, in no namespace', async () => {
    const document = await page();
    const xml = document.implementation.createDocument(null, 'r', null);
    const element = xml.createElement('DIV');
    assert.deepEqual(
      [element.localName, element.tagName, element.namespaceURI],
      ['DIV', 'DIV', null],
    );
    assert.equal(element.ownerDocument, xml);
    const xhtml = document.implementation.createDocument(
      'http://www.w3.org/1999/xhtml',
      'html',
      null,
    );
    assert.equal(xhtml.createElement('Div').namespaceURI, 'http://www.w3.org/1999/xhtml');
    const html = document.implementation.createHTMLDocument('t');
    assert.equal(html.createElement('DIV').localName, 'div');
  });

  it('is a blank XML document from new Document()', async () => {
    await page();
    const made = new globals.Document();
    assert.equal(Object.getPrototypeOf(made), globals.Document.prototype);
    assert.deepEqual(
      [made.contentType, made.doctype, made.documentElement],
      ['application/xml', null, null],
    );
    made.appendChild(made.createElement('html'));
    assert.equal(made.documentElement.localName, 'html');
  });

  it('makes an HTML document that a sanitizer parses markup in, and draws none of it', async () => {
    const document = await page();
    const { implementation } = document;
    assert.equal(implementation.hasFeature(), true);
    const made = implementation.createHTMLDocument('Inert');
    assert.equal(made.title, 'Inert');
    assert.equal(made.documentElement.localName, 'html');
    assert.equal(made.documentElement.parentNode, made);
    assert.equal(made.doctype.name, 'html');
    made.body.innerHTML = '<b id="bold">Shown</b><img src="x" onerror="steal()">';
    assert.equal(made.getElementById('bold').textContent, 'Shown');
    assert.equal(made.body.firstChild.ownerDocument, made);
    assert.equal(made.body.isConnected, true);
    assert.equal(made.getElementsByTagName('img')[0].getAttribute('onerror'), 'steal()');
    assert.equal(made.getElementsByTagName('b').length, 1);
    await settle();
    assert.equal(screen.queryByText('Shown'), null);
    // Made in it, then put in the page: the page's.
    const moved = made.createElement('span');
    assert.equal(moved.ownerDocument, made);
    document.body.appendChild(moved);
    assert.equal(moved.ownerDocument, document);
  });

  it('is what Angular sanitizes markup with where it is given this document', async () => {
    // The sanitizer makes its inert document the first time it is asked, of the document it is
    // handed: `DomSanitizer` hands it the one `DOCUMENT` is, which is this.
    const document = await page();
    assert.equal(sanitizeHtml(document, '<b>Bold</b><script>steal()</script>'), '<b>Bold</b>');
  });

  it('styles nothing with a <style> put in a document it made', async () => {
    const document = await page();
    document.getElementById('page').setAttribute('testID', 'page');
    const made = document.implementation.createHTMLDocument('');
    const style = made.createElement('style');
    style.textContent = '#page { width: 50px }';
    made.head.appendChild(style);
    await settle();
    assert.equal(screen.getByTestId('page').props['width'] ?? null, null);
    assert.equal(document.styleSheets.length, 0);
    assert.equal(style.sheet, null);
    // Put in the page, it is the page's, and styles it.
    document.head.appendChild(style);
    await settle();
    assert.equal(screen.getByTestId('page').props['width'], 50);
    assert.equal(document.styleSheets.length, 1);
  });

  it('makes an XML document, with or without an element, and a doctype', async () => {
    const document = await page();
    const { implementation } = document;
    const svg = implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
    assert.equal(svg.documentElement.localName, 'svg');
    assert.equal(svg.contentType, 'image/svg+xml');
    const empty = implementation.createDocument(null, '', null);
    assert.equal(empty.documentElement, null);
    const type = implementation.createDocumentType('html', '', '');
    assert.equal(type.nodeType, 10);
    assert.equal(type.ownerDocument, document);
    const html = implementation.createHTMLDocument('');
    assert.deepEqual(html.childNodes, [html.doctype, html.documentElement]);
    assert.throws(() => html.append(html.createElement('a')), { name: 'HierarchyRequestError' });
    assert.throws(() => html.append(html.createTextNode('a')), { name: 'HierarchyRequestError' });
    assert.throws(() => implementation.createDocument(), TypeError);
    assert.throws(() => implementation.createDocumentType('html'), TypeError);
  });
});
