/**
 * What the page's document holds, in order: its element, a doctype before it, and comments, put
 * in, moved and taken out as a browser refuses or allows.
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

const names = (doc: Dom) => [...doc.childNodes].map((node: Dom) => node.nodeName);

describe("what the page's document holds", () => {
  it('holds its doctype and its element, which is in it as a browser has it', async () => {
    const document = await page();
    const root = document.documentElement;
    assert.deepEqual(names(document), ['html', root.nodeName]);
    assert.equal(document.firstChild === document.doctype, true);
    assert.equal(document.lastChild === root, true);
    assert.equal(document.childElementCount, 1);
    assert.equal(document.firstElementChild === root, true);
    assert.equal(document.hasChildNodes(), true);
    assert.equal(root.parentNode === document, true, 'the element is in the document');
    assert.equal(root.parentElement, null);
    assert.equal(root.previousSibling === document.doctype, true);
    assert.equal(document.doctype.nextSibling === root, true);
    assert.equal(root.nextSibling, null);
    assert.equal(document.parentNode, null);
    assert.equal(document.previousSibling, null);
    assert.equal(document.nextSibling, null);
  });

  it('takes comments around its element, and keeps its element, which the app is drawn in', async () => {
    const document = await page();
    const root = document.documentElement;
    const before = document.createComment('before');
    const after = document.createComment('after');
    document.insertBefore(before, root);
    document.appendChild(after);
    assert.deepEqual(names(document), ['html', '#comment', root.nodeName, '#comment']);
    assert.equal(root.previousSibling === before, true);
    assert.equal(root.nextSibling === after, true);
    // Even moved within it, as a browser refuses: a document holds one element.
    assert.equal(
      nameOf(() => document.insertBefore(root, after)),
      'HierarchyRequestError',
    );
    assert.equal(document.documentElement === root, true);
    assert.equal(root.parentNode === document, true);
    assert.equal(
      nameOf(() => document.appendChild(document.createElement('div'))),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => document.removeChild(root)),
      'NotSupportedError',
    );
    assert.equal(
      nameOf(() => root.remove()),
      'NotSupportedError',
    );
    assert.equal(document.documentElement === root, true, 'still the element');
    document.removeChild(before);
    after.remove();
    assert.deepEqual(names(document), ['html', root.nodeName]);
  });
});

describe('a comment the page document holds', () => {
  it('is in the document until it is put in an element, and not after it leaves that', async () => {
    const document = await page();
    const comment = document.appendChild(document.createComment('c'));
    assert.equal(comment.isConnected, true);
    assert.equal(comment.getRootNode() === document, true);
    const element = document.getElementById('page');
    element.appendChild(comment);
    assert.deepEqual(names(document), ['html', document.documentElement.nodeName]);
    comment.remove();
    assert.equal(comment.parentNode, null);
    assert.equal(comment.isConnected, false);
    assert.equal(comment.getRootNode() === comment, true);
    assert.equal(document.childNodes.length, 2);
  });

  it('puts the doctype back where it may go, before the element', async () => {
    const document = await page();
    const { doctype, documentElement } = document;
    doctype.remove();
    assert.deepEqual([document.doctype, doctype.parentNode], [null, null]);
    assert.equal(
      nameOf(() => document.appendChild(doctype)),
      'HierarchyRequestError',
    );
    document.prepend(doctype);
    assert.equal(document.doctype === doctype, true);
    assert.equal(doctype.nextSibling === documentElement, true);
    assert.equal(
      nameOf(() => document.prepend(doctype.cloneNode())),
      'HierarchyRequestError',
    );
    document.replaceChildren(documentElement, document.createComment('end'));
    assert.deepEqual(names(document), [documentElement.nodeName, '#comment']);
  });
});
