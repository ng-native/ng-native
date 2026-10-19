/**
 * Attributes as nodes: the same `Attr` each time, its value the element's, its own again once
 * it is taken off, and `attributes` a `NamedNodeMap` of them.
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

describe('Attr', () => {
  it('is the same node each time, with the value the element has', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.setAttribute('title', 'a');
    const attr = div.getAttributeNode('title');
    assert.equal(attr === div.getAttributeNode('TITLE'), true);
    assert.equal(attr === div.attributes[0] && attr === div.attributes.getNamedItem('title'), true);
    assert.equal(
      attr.nodeType + '|' + attr.name + '|' + attr.value + '|' + attr.nodeValue,
      '2|title|a|a',
    );
    attr.value = 'b';
    assert.equal(div.getAttribute('title'), 'b');
    div.removeAttribute('title');
    assert.equal(attr.ownerElement, null);
    assert.equal(attr.value, 'b');
    assert.equal(div.getAttributeNode('title'), null);
  });

  it('is set under the name it has, in the case it was made in', async () => {
    const document = await page();
    const div = document.createElement('div');
    const attr = document.createAttributeNS('urn:x', 'p:Local');
    attr.value = 'v';
    div.setAttributeNode(attr);
    assert.deepEqual(div.getAttributeNames(), ['p:Local']);
    assert.equal(div.getAttributeNS('urn:x', 'Local'), 'v');
    assert.equal(attr.ownerElement === div, true);
  });

  it('finds a prefixed name by its local name only where it has no namespace', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.setAttributeNS('urn:a', 'p:x', 'v');
    assert.equal(div.getAttributeNS('urn:b', 'x'), null);
    assert.equal(div.hasAttributeNS('urn:b', 'x'), false);
    assert.equal(div.getAttributeNS('urn:a', 'x'), 'v');
    // One written with a prefix and no namespace, as a template does, is found in any.
    div.setAttribute('xlink:href', 'h');
    assert.equal(div.getAttributeNS('urn:b', 'href'), 'h');
  });

  it('is made on no element, and set on one', async () => {
    const document = await page();
    const div = document.createElement('div');
    const attr = document.createAttribute('Data-X');
    assert.equal(attr.name, 'data-x');
    attr.value = '1';
    assert.equal(div.setAttributeNode(attr), null);
    assert.equal(div.getAttribute('data-x'), '1');
    assert.equal(attr.ownerElement === div, true);
    const other = document.createElement('div');
    assert.equal(
      nameOf(() => other.setAttributeNode(attr)),
      'InUseAttributeError',
    );
    assert.equal(div.removeAttributeNode(attr) === attr, true);
    assert.equal(div.hasAttribute('data-x'), false);
    assert.equal(
      nameOf(() => div.removeAttributeNode(attr)),
      'NotFoundError',
    );
    assert.equal(
      nameOf(() => document.createAttribute('a b')),
      'InvalidCharacterError',
    );
  });

  it('keeps its namespace and prefix, and is found by them', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.setAttributeNS('urn:x', 'p:local', 'v');
    const attr = div.getAttributeNodeNS('urn:x', 'local');
    assert.equal([attr.prefix, attr.localName, attr.namespaceURI].join('|'), 'p|local|urn:x');
    assert.equal(div.getAttributeNS('urn:x', 'local'), 'v');
    assert.equal(div.getAttributeNS(null, 'local'), null);
    div.setAttributeNS('urn:x', 'q:local', 'w');
    assert.equal(div.getAttribute('p:local'), 'w');
    div.removeAttributeNS('urn:x', 'local');
    assert.equal(div.hasAttribute('p:local'), false);
  });

  it('keeps the capitals of a name written in a namespace, and is found by them alone', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.setAttributeNS('http://www.w3.org/1999/xhtml', 'Abc:aBC', 'v');
    const [attr] = div.attributes;
    assert.equal([attr.prefix, attr.localName, attr.name].join('|'), 'Abc|aBC|Abc:aBC');
    assert.equal(div.getAttributeNS('http://www.w3.org/1999/xhtml', 'aBC'), 'v');
    assert.equal(div.getAttributeNS('http://www.w3.org/1999/xhtml', 'abc'), null);
    const none = document.createElement('div');
    none.setAttributeNS(null, 'Abc', 'v');
    assert.equal(none.attributes[0].localName, 'Abc');
    assert.equal(none.getAttributeNS(null, 'Abc'), 'v');
    assert.equal(none.getAttributeNS(null, 'abc'), null);
    assert.equal(none.hasAttributeNS(null, 'abc'), false);
  });

  it('says whether an element has any attribute', async () => {
    const document = await page();
    const div = document.createElement('div');
    assert.equal(div.hasAttributes(), false);
    div.setAttribute('class', 'a');
    assert.equal(div.hasAttributes(), true);
    div.removeAttribute('class');
    div.setAttribute('data-x', '');
    assert.equal(div.hasAttributes(), true);
    assert.equal(document.getElementById('page').hasAttributes(), true);
    assert.equal(document.createTextNode('t').hasAttributes(), false);
  });

  it('lists the class among the attributes, and its methods on the list are not its own', async () => {
    const document = await page();
    const div = document.createElement('div');
    div.className = 'a';
    div.setAttribute('title', 't');
    assert.deepEqual(div.getAttributeNames(), ['class', 'title']);
    assert.deepEqual(Object.getOwnPropertyNames(div.attributes), ['0', '1']);
    assert.equal(
      nameOf(() => div.attributes.removeNamedItem('nope')),
      'NotFoundError',
    );
  });

  it('lists the attributes of an element, and takes one written with a namespace', async () => {
    const document = await page();
    const box = document.createElement('div');
    box.setAttribute('class', 'a b');
    box.setAttribute('data-kind', 'box');
    box.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#there');
    const named = [...box.attributes].map((each: Dom) => [each.name, each.value]);
    assert.deepEqual(named, [
      ['class', 'a b'],
      ['data-kind', 'box'],
      ['xlink:href', '#there'],
    ]);
    assert.equal(box.attributes.getNamedItem('data-kind').value, 'box');
    assert.equal(box.attributes.item(0).ownerElement, box);
    assert.equal(box.getAttributeNS('http://www.w3.org/1999/xlink', 'href'), '#there');
    assert.equal(box.hasAttributeNS(null, 'data-kind'), true);
    box.removeAttributeNS(null, 'data-kind');
    assert.deepEqual([box.hasAttribute('data-kind'), box.attributes.length], [false, 2]);
  });
});
