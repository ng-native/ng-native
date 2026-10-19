/**
 * `TreeWalker` and `NodeIterator`, walked as they are asked: a focus trap walks what can take the
 * focus in a box, back and forth, and an editor's iterator is moved off a node that is taken out.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const globals = globalThis as Dom;

/**
 * root > [ "a", b > [ c, <!--d--> ], e ], with ids for the elements and the text's words, so a
 * walk can be read back as a string.
 */
async function tree() {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  const element = (id: string) => Object.assign(document.createElement('div'), { id });
  const root = element('root');
  const b = element('b');
  const c = element('c');
  const e = element('e');
  root.append(document.createTextNode('a'), b, e);
  b.append(c, document.createComment('d'));
  return { document, root, b, c, e };
}

// A comment by its words, which it keeps as a browser's does.
const nameOf = (node: Dom): string => (node == null ? 'null' : node.id || node.data || '#');

/** Each step taken until one answers nothing, as names. */
function walk(step: () => Dom): string {
  const seen: string[] = [];
  for (let node = step(); node; node = step()) seen.push(nameOf(node));
  return seen.join(' ');
}

describe('document.createTreeWalker', () => {
  it('walks forwards and backwards over what it is told to show', async () => {
    const { document, root } = await tree();
    const { SHOW_ELEMENT } = globals.NodeFilter;
    const walker = document.createTreeWalker(root, SHOW_ELEMENT);
    assert.equal(
      walk(() => walker.nextNode()),
      'b c e',
    );
    assert.equal(nameOf(walker.currentNode), 'e');
    assert.equal(
      walk(() => walker.previousNode()),
      'c b root',
    );
    const all = document.createTreeWalker(root);
    assert.equal(
      walk(() => all.nextNode()),
      'a b c d e',
    );
  });

  it('moves to children, siblings and parents, and takes a currentNode set', async () => {
    const { document, root, c } = await tree();
    const walker = document.createTreeWalker(root, globals.NodeFilter.SHOW_ELEMENT);
    assert.equal(nameOf(walker.firstChild()), 'b');
    assert.equal(nameOf(walker.nextSibling()), 'e');
    assert.equal(nameOf(walker.previousSibling()), 'b');
    assert.equal(nameOf(walker.lastChild()), 'c');
    assert.equal(nameOf(walker.parentNode()), 'b');
    assert.equal(nameOf(walker.parentNode()), 'root');
    assert.equal(walker.parentNode(), null, 'not past its root');
    walker.currentNode = c;
    assert.equal(nameOf(walker.nextNode()), 'e');
    assert.throws(() => (walker.currentNode = null), TypeError);
  });

  it('asks a filter, a function or an object, and skips or rejects what it says to', async () => {
    const { document, root } = await tree();
    const { FILTER_ACCEPT, FILTER_SKIP, FILTER_REJECT, SHOW_ELEMENT } = globals.NodeFilter;
    const skip = document.createTreeWalker(root, SHOW_ELEMENT, (node: Dom) =>
      node.id === 'b' ? FILTER_SKIP : FILTER_ACCEPT,
    );
    assert.equal(
      walk(() => skip.nextNode()),
      'c e',
      'what is under a skipped node is walked',
    );
    const reject = document.createTreeWalker(root, SHOW_ELEMENT, {
      acceptNode: (node: Dom) => (node.id === 'b' ? FILTER_REJECT : FILTER_ACCEPT),
    });
    assert.equal(
      walk(() => reject.nextNode()),
      'e',
      'and under a rejected one is not',
    );
    const broken = document.createTreeWalker(root, SHOW_ELEMENT, {});
    assert.throws(() => broken.nextNode(), TypeError);
  });

  it('is a TreeWalker, and its filter cannot walk it again while it runs', async () => {
    const { document, root } = await tree();
    const walker: Dom = document.createTreeWalker(root, 1, () => walker.nextNode());
    assert.equal(walker instanceof globals.TreeWalker, true);
    assert.equal(String(walker), '[object TreeWalker]');
    assert.throws(() => walker.nextNode(), { name: 'InvalidStateError' });
  });
});

describe('document.createNodeIterator', () => {
  it('walks every node it shows in order, and back', async () => {
    const { document, root } = await tree();
    const iterator = document.createNodeIterator(root, globals.NodeFilter.SHOW_TEXT);
    assert.equal(nameOf(iterator.nextNode()), 'a');
    assert.equal(iterator.nextNode(), null);
    const all = document.createNodeIterator(root);
    assert.equal(
      walk(() => all.nextNode()),
      'root a b c d e',
    );
    assert.equal(
      walk(() => all.previousNode()),
      'e d c b a root',
    );
    assert.equal(all.whatToShow, 0xffffffff);
    assert.equal(all.filter, null);
  });

  it('is moved off a node taken out of the tree, to the node before it', async () => {
    const { document, root, b } = await tree();
    const iterator = document.createNodeIterator(root, globals.NodeFilter.SHOW_ELEMENT);
    iterator.nextNode();
    iterator.nextNode();
    iterator.nextNode();
    assert.equal(nameOf(iterator.referenceNode), 'c');
    b.remove();
    assert.equal(nameOf(iterator.referenceNode), 'a', 'the last node before the one taken out');
    assert.equal(nameOf(iterator.nextNode()), 'e');
  });

  it('is moved off a node moved elsewhere, as taking it out first', async () => {
    const { document, root, b, e } = await tree();
    const iterator = document.createNodeIterator(root, globals.NodeFilter.SHOW_ELEMENT);
    iterator.nextNode();
    iterator.nextNode();
    assert.equal(iterator.pointerBeforeReferenceNode, false);
    e.appendChild(b);
    assert.equal(nameOf(iterator.referenceNode), 'a');
  });

  it('walks a document from its doctype on to its element, and off a doctype taken out', async () => {
    const { document } = await tree();
    const all = 0xffffffff;
    const walker = document.createTreeWalker(document, all);
    assert.equal(walker.firstChild() === document.doctype, true);
    assert.equal(walker.nextSibling() === document.documentElement, true);
    assert.equal(walker.parentNode() === document, true);
    const iterator = document.createNodeIterator(document, all);
    iterator.nextNode();
    iterator.nextNode();
    assert.equal(iterator.referenceNode === document.doctype, true);
    document.doctype.remove();
    assert.equal(iterator.referenceNode === document, true, 'moved back to the document');
  });

  it('walks a made document, and off a doctype taken out of it', async () => {
    const { document } = await tree();
    const all = 0xffffffff;
    const walker = document.createTreeWalker(document, all);
    assert.equal(walker.firstChild() === document.doctype, true);
    assert.equal(walker.nextSibling() === document.documentElement, true);
    assert.equal(walker.parentNode() === document, true);
    const made = document.implementation.createHTMLDocument('made');
    const iterator = document.createNodeIterator(made, all);
    iterator.nextNode();
    iterator.nextNode();
    assert.equal(iterator.referenceNode === made.doctype, true);
    made.doctype.remove();
    assert.equal(iterator.referenceNode === made, true, 'moved back to the document');
  });
});
