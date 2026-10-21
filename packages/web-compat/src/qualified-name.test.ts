/**
 * The names of an element a script makes, and of its attributes, as the DOM gives and refuses
 * them: a library reads `localName` and `namespaceURI` back, and tells an error by its name.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page" data-e2="2"></div>` })
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

const names = (element: Dom) =>
  [element.prefix, element.localName, element.tagName, element.namespaceURI].join('|');

describe('qualified names', () => {
  it('gives an element made in a namespace its prefix and local name as written', async () => {
    const document = await page();
    assert.equal(
      names(document.createElementNS('http://example.com/', 'f:oO')),
      'f|oO|f:oO|http://example.com/',
    );
    assert.equal(names(document.createElementNS(null, 'foo')), '|foo|foo|');
    assert.equal(names(document.createElementNS('', 'foo')), '|foo|foo|');
    assert.equal(
      names(document.createElementNS('http://www.w3.org/1999/xhtml', 'FOO')),
      '|FOO|FOO|http://www.w3.org/1999/xhtml',
    );
    assert.equal(names(document.createElement('dIv')), '|div|DIV|http://www.w3.org/1999/xhtml');
    assert.equal(
      names(document.createElementNS('http://www.w3.org/2000/svg', 'rect')),
      '|rect|rect|http://www.w3.org/2000/svg',
    );
    const copy = document.createElementNS('http://example.com/', 'f:oo').cloneNode();
    assert.equal(names(copy), 'f|oo|f:oo|http://example.com/');
  });

  it('names no text and no comment as an element', async () => {
    const document = await page();
    const text = document.createTextNode('a');
    assert.equal(text.localName, null);
    assert.equal(text.namespaceURI, null);
    assert.equal(text.tagName, undefined);
  });

  it('refuses a name a browser refuses, with the error it names', async () => {
    const document = await page();
    assert.equal(
      nameOf(() => document.createElement('')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.createElement('1foo')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.createElement('a b')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.createElement('_x:y')),
      'none',
    );
    assert.equal(
      nameOf(() => document.createElementNS(null, 'f:oo')),
      'NamespaceError',
    );
    assert.equal(
      nameOf(() => document.createElementNS('urn:x', 'xml:a')),
      'NamespaceError',
    );
    assert.equal(
      nameOf(() => document.createElementNS('urn:x', 'foo:')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => document.createElementNS('http://www.w3.org/2000/xmlns/', 'a')),
      'NamespaceError',
    );
    const element = document.createElement('div');
    assert.equal(
      nameOf(() => element.setAttribute('a b', '')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => element.setAttribute('', '')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => element.toggleAttribute('a=b')),
      'InvalidCharacterError',
    );
    assert.equal(
      nameOf(() => element.setAttribute('a:b', '')),
      'none',
    );
  });

  it('keeps an attribute HTML has in lower case, however its property is written', async () => {
    const document = await page();
    const made = document.createElement('p');
    // `accessKey` is a property's name, and the attribute is `accesskey`: a native prop written
    // so, `testID`, is not one of HTML's.
    made.setAttribute('accessKey', 'a');
    made.setAttribute('tabIndex', '2');
    assert.deepEqual(made.getAttributeNames(), ['accesskey', 'tabindex']);
    made.accessKey = 'b';
    assert.equal(made.getAttribute('accessKey'), 'b');
    assert.deepEqual(made.getAttributeNames(), ['accesskey', 'tabindex']);
    // A class attribute reads back as written: a vertical tab is not a space between classes.
    made.setAttribute('class', ' x\vy  z ');
    assert.equal(made.getAttribute('class'), ' x\vy  z ');
    assert.deepEqual([...made.classList], ['x\vy', 'z']);
  });

  it("reads an HTML element's attributes by any case of their names", async () => {
    const document = await page();
    const made = document.createElement('div');
    made.setAttribute('Data-X', '1');
    assert.equal(made.getAttribute('data-x'), '1');
    assert.equal(made.getAttribute('DATA-X'), '1');
    assert.deepEqual(made.getAttributeNames(), ['data-x']);
    // A native view's prop, which an app passes through, is kept as it is written.
    made.setAttribute('testID', 'made');
    assert.equal(made.props['testID'], 'made');
    assert.equal(made.getAttribute('testid'), 'made');
    const element = document.getElementById('page');
    assert.equal(element.hasAttribute('data-E2'), true);
    assert.equal(element.getAttribute('DATA-E2'), '2');
    const drawn = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawn.setAttribute('viewBox', '0 0 1 1');
    assert.equal(drawn.getAttribute('viewbox'), null);
    assert.equal(drawn.getAttribute('viewBox'), '0 0 1 1');
  });

  it('finds an element by an id that is not a string, as the string of it', async () => {
    const document = await page();
    const element = document.getElementById('page');
    element.id = 'null';
    assert.equal(document.getElementById(null) === element, true);
  });
});

describe('namespace lookups', () => {
  it('finds what a prefix stands for from an element, what it is in, and what it declares', async () => {
    const document = await page();
    const XMLNS = 'http://www.w3.org/2000/xmlns/';
    const outer = document.createElementNS('urn:foo', 'p:outer');
    outer.setAttributeNS(XMLNS, 'xmlns:bar', 'urn:bar');
    outer.setAttributeNS(XMLNS, 'xmlns', 'urn:baz');
    const comment = outer.appendChild(document.createComment('c'));
    assert.equal(outer.lookupNamespaceURI('p'), 'urn:foo');
    assert.equal(comment.lookupNamespaceURI('bar'), 'urn:bar');
    assert.equal(comment.lookupNamespaceURI(null), 'urn:baz');
    assert.equal(comment.isDefaultNamespace('urn:baz'), true);
    assert.equal(outer.lookupPrefix('urn:foo'), 'p');
    assert.equal(outer.lookupPrefix('urn:bar'), 'bar');
    outer.setAttribute('xmlns:bar', 'urn:bar');
    assert.equal(outer.lookupPrefix('urn:bar'), null);
    assert.equal(
      document.createElement('div').lookupNamespaceURI(null),
      'http://www.w3.org/1999/xhtml',
    );
    const fragment = document.createDocumentFragment();
    assert.equal(fragment.lookupNamespaceURI('xml'), null);
    assert.equal(fragment.isDefaultNamespace(null), true);
    assert.equal(
      nameOf(() => outer.setAttributeNS(null, 'a:b', '')),
      'NamespaceError',
    );
  });
});
