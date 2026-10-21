/**
 * The kinds of node a script tells apart, and the interfaces it asks a node whether it is one of:
 * a library compares `nodeType` with `Node`'s constants and reads them off a node as well.
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

const CONSTANTS: Record<string, number> = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12,
  DOCUMENT_POSITION_DISCONNECTED: 0x01,
  DOCUMENT_POSITION_PRECEDING: 0x02,
  DOCUMENT_POSITION_FOLLOWING: 0x04,
  DOCUMENT_POSITION_CONTAINS: 0x08,
  DOCUMENT_POSITION_CONTAINED_BY: 0x10,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 0x20,
};

describe('node constants', () => {
  it('are on Node, its prototype, every node and the document', async () => {
    const document = await page();
    const Node = (globalThis as Dom).Node;
    const holders = [
      Node,
      Node.prototype,
      document.createElement('foo'),
      document.createTextNode('bar'),
      document.createComment('baz'),
      document,
    ];
    for (const holder of holders) {
      for (const [name, value] of Object.entries(CONSTANTS))
        assert.equal(holder[name], value, name);
    }
  });

  it('has a document and a doctype be a Node, as an element is', async () => {
    const document = await page();
    const Node = (globalThis as Dom).Node;
    const made = document.implementation.createHTMLDocument('t');
    for (const node of [document, made, made.doctype, document.createElement('i')]) {
      assert.ok(node instanceof Node);
    }
    assert.ok(!({ nodeType: 9 } instanceof Node));
  });

  it('has an element of HTML be its interface, and one in another namespace none', async () => {
    const document = await page();
    const globals = globalThis as Dom;
    assert.ok(document.createElement('h3') instanceof globals.HTMLHeadingElement);
    assert.ok(document.createElement('td') instanceof globals.HTMLTableCellElement);
    assert.ok(document.createElement('span') instanceof globals.HTMLSpanElement);
    assert.ok(!(document.createElement('span') instanceof globals.HTMLDivElement));
    assert.ok(document.createElement('foo') instanceof globals.HTMLUnknownElement);
    assert.ok(!(document.createElement('x-foo') instanceof globals.HTMLUnknownElement));
    assert.ok(!(document.createElement('abbr') instanceof globals.HTMLUnknownElement));
    assert.ok(!(document.createElementNS('urn:x', 'span') instanceof globals.HTMLSpanElement));
    assert.throws(() => new globals.HTMLDivElement(), TypeError);
  });

  it('says what kind of element one is, to a library that asks by its class', async () => {
    const document = await page();
    const globals = globalThis as Dom;
    const made = (name: string) => document.createElement(name);
    assert.equal(made('label') instanceof globals.HTMLLabelElement, true);
    assert.equal(made('textarea') instanceof globals.HTMLTextAreaElement, true);
    assert.equal(made('button') instanceof globals.HTMLButtonElement, true);
    assert.equal(made('a') instanceof globals.HTMLAnchorElement, true);
    assert.equal(made('select') instanceof globals.HTMLSelectElement, true);
    assert.equal(made('form') instanceof globals.HTMLFormElement, true);
    assert.equal(made('div') instanceof globals.HTMLLabelElement, false);
    assert.equal(document.getElementById('page') instanceof globals.HTMLDivElement, true);
    assert.equal(document.createTextNode('a') instanceof globals.HTMLTextAreaElement, false);
    assert.equal((null as unknown) instanceof globals.HTMLLabelElement, false);
    assert.throws(() => new globals.HTMLDivElement(), TypeError);
  });
});
