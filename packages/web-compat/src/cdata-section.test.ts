/**
 * `<![CDATA[...]]>`, as `createCDATASection` makes one in an XML document: a text that says it is
 * a section, and that an HTML document refuses to make.
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

const globals = globalThis as Dom;

describe('CDATA sections', () => {
  it('are texts of an XML document, with a kind and a name of their own', async () => {
    const document = await page();
    const xml = document.implementation.createDocument(null, 'r', null);
    const section = xml.createCDATASection('a<b');
    assert.deepEqual(
      [section.nodeType, section.nodeName, section.data],
      [4, '#cdata-section', 'a<b'],
    );
    assert.ok(section instanceof globals.CDATASection);
    assert.ok(section instanceof globals.Text);
    assert.ok(!(xml.createTextNode('t') instanceof globals.CDATASection));
    assert.equal(section.cloneNode().nodeType, 4);
    xml.documentElement.appendChild(section);
    assert.equal(
      new globals.XMLSerializer().serializeToString(xml.documentElement),
      '<r><![CDATA[a<b]]></r>',
    );
  });

  it('are refused by an HTML document, and where the data would end one', async () => {
    const document = await page();
    assert.equal(
      nameOf(() => document.createCDATASection('a')),
      'NotSupportedError',
    );
    const html = document.implementation.createHTMLDocument('t');
    assert.equal(
      nameOf(() => html.createCDATASection('a')),
      'NotSupportedError',
    );
    const xml = document.implementation.createDocument(null, 'r', null);
    assert.equal(
      nameOf(() => xml.createCDATASection(' ]]> ')),
      'InvalidCharacterError',
    );
  });
});
