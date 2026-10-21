/**
 * XML markup parsed into a made document: names in the namespace declared for them, every kind
 * of node, references, and a `<parsererror>` for markup that is not well-formed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { PARSER_ERROR, parseXml } from './xml.ts';

type Dom = any;

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function parsed(markup: string): Promise<[Dom, boolean]> {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = app.fixture.componentInstance.document;
  const xml = document.implementation.createDocument(null, null, null);
  return [xml, parseXml(markup, xml)];
}

describe('parseXml', () => {
  it('keeps names as written, in the namespace declared for them', async () => {
    const [xml, ok] = await parsed(
      '<?xml version="1.0"?><Root xmlns="urn:a" xmlns:b="urn:b"><b:Child b:at="1" plain="2"/>' +
        '<Other/></Root>',
    );
    assert.equal(ok, true);
    const root = xml.documentElement;
    assert.deepEqual([root.localName, root.namespaceURI], ['Root', 'urn:a']);
    const [child, other] = root.children;
    assert.deepEqual([child.localName, child.prefix, child.namespaceURI], ['Child', 'b', 'urn:b']);
    assert.equal(child.getAttributeNS('urn:b', 'at'), '1');
    assert.equal(child.getAttributeNS(null, 'plain'), '2');
    assert.equal(other.namespaceURI, 'urn:a');
  });

  it('makes text, comments, CDATA, processing instructions and a doctype', async () => {
    const [xml] = await parsed(
      '<!DOCTYPE r SYSTEM "r.dtd"><!--before--><r>a &lt;&amp;&#65;&#x42; <![CDATA[<raw>]]>' +
        '<?go now?></r>',
    );
    assert.equal(xml.doctype.name, 'r');
    assert.equal(xml.doctype.systemId, 'r.dtd');
    assert.equal(xml.childNodes[1].nodeType, 8);
    const kinds = [...xml.documentElement.childNodes].map((node: Dom) => node.nodeType);
    assert.deepEqual(kinds, [3, 4, 7]);
    assert.equal(xml.documentElement.firstChild.data, 'a <&AB ');
    assert.equal(xml.documentElement.childNodes[1].data, '<raw>');
    assert.equal(xml.documentElement.childNodes[2].target, 'go');
  });

  it('is a parsererror where the markup is not well-formed', async () => {
    for (const markup of [
      '<a><b></a>',
      '<a>',
      '',
      '<a/><b/>',
      '<a x=1/>',
      '<p:a/>',
      '<a>&nbsp;</a>',
      '<a>&#xZZ;</a>',
      '<a>&#;</a>',
      '<a>&#x110000;</a>',
      '<a>&#0;</a>',
      '<a xmlns:p="u"><p:/></a>',
    ]) {
      const [xml, ok] = await parsed(markup);
      assert.equal(ok, false, markup);
      assert.equal(xml.documentElement.localName, 'parsererror', markup);
      assert.equal(xml.documentElement.namespaceURI, PARSER_ERROR, markup);
      assert.equal(xml.childNodes.length, 1, markup);
    }
  });
});
