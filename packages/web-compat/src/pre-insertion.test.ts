/**
 * What a browser refuses to put in the tree or take out of it, and the error it names for each:
 * a library tells one from another by the name.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"><span id="one"></span></div>` })
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

describe('inserting and removing', () => {
  it('puts nothing in a text or a comment', async () => {
    const document = await page();
    for (const parent of [document.createTextNode('a'), document.createComment('a')]) {
      const child = document.createTextNode('b');
      assert.equal(
        nameOf(() => parent.appendChild(child)),
        'HierarchyRequestError',
      );
      assert.equal(
        nameOf(() => parent.insertBefore(child, null)),
        'HierarchyRequestError',
      );
      assert.equal(
        nameOf(() => parent.append(child)),
        'HierarchyRequestError',
      );
      assert.equal(
        nameOf(() => parent.prepend('c')),
        'HierarchyRequestError',
      );
      assert.equal(parent.childNodes.length, 0);
    }
  });

  it('puts no node in itself or in what it holds', async () => {
    const document = await page();
    const outer = document.getElementById('page');
    const inner = document.getElementById('one');
    assert.equal(
      nameOf(() => outer.appendChild(outer)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => inner.appendChild(outer)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => inner.insertBefore(outer, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => inner.replaceChild(outer, null)),
      'TypeError',
    );
    const child = inner.appendChild(document.createElement('i'));
    assert.equal(
      nameOf(() => inner.replaceChild(outer, child)),
      'HierarchyRequestError',
    );
    assert.equal(inner.parentNode === outer, true);
  });

  it('refuses what is not a node, and a child that is not one of its own', async () => {
    const document = await page();
    const outer = document.getElementById('page');
    const stray = document.createElement('div');
    assert.equal(
      nameOf(() => outer.appendChild(null)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => outer.appendChild({})),
      'TypeError',
    );
    assert.equal(
      nameOf(() => outer.insertBefore(stray)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => outer.appendChild(document)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => outer.removeChild(stray)),
      'NotFoundError',
    );
    assert.equal(
      nameOf(() => outer.insertBefore(stray, stray)),
      'NotFoundError',
    );
    assert.equal(
      nameOf(() => outer.replaceChild(stray, stray)),
      'NotFoundError',
    );
    assert.equal(stray.parentNode, null);
  });

  it('leaves a node where it is when it is put before itself or in its own place', async () => {
    const document = await page();
    const outer = document.getElementById('page');
    const one = document.getElementById('one');
    const two = outer.appendChild(document.createElement('b'));
    outer.insertBefore(one, one);
    assert.equal(outer.firstChild === one && one.nextSibling === two, true);
    assert.equal(outer.replaceChild(one, one) === one, true);
    assert.equal(outer.firstChild === one && one.nextSibling === two, true);
  });
});

describe('inserting in the body', () => {
  it('checks what is put in it as any element does', async () => {
    const document = await page();
    const { body } = document;
    const child = document.createElement('div');
    assert.equal(
      nameOf(() => body.insertBefore(child)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => body.appendChild(body)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => body.insertBefore(child, child)),
      'NotFoundError',
    );
    assert.equal(
      nameOf(() => body.appendChild('a')),
      'TypeError',
    );
    const fragment = document.createDocumentFragment();
    fragment.appendChild(child);
    body.appendChild(fragment);
    assert.equal(child.parentNode === body, true);
  });
});

describe('a document fragment', () => {
  it('puts what it holds where it is put, and is left empty', async () => {
    const document = await page();
    const outer = document.getElementById('page');
    const one = document.getElementById('one');
    const fragment = document.createDocumentFragment();
    assert.equal(fragment.nodeType, 11);
    assert.equal(fragment.nodeName, '#document-fragment');
    fragment.appendChild(document.createElement('a'));
    fragment.append('text');
    assert.equal(outer.insertBefore(fragment, one) === fragment, true);
    assert.equal(fragment.childNodes.length, 0);
    assert.deepEqual(
      [...outer.childNodes].map((node: Dom) => node.nodeName),
      ['A', '#text', 'SPAN'],
    );
    fragment.append(document.createElement('b'), document.createElement('i'));
    outer.append(fragment);
    fragment.appendChild(document.createElement('u'));
    outer.replaceChild(fragment, one);
    fragment.appendChild(document.createElement('s'));
    one.replaceWith(fragment);
    outer.appendChild(fragment);
    assert.deepEqual(
      [...outer.childNodes].map((node: Dom) => node.nodeName),
      ['A', '#text', 'U', 'B', 'I', 'S'],
    );
  });
});

describe('insertAdjacentElement and insertAdjacentText', () => {
  it('put a node at the place named around an element', async () => {
    const document = await page();
    const outer = document.getElementById('page');
    const one = document.getElementById('one');
    const named = (tag: string) => document.createElement(tag);
    assert.equal(one.insertAdjacentElement('beforeBegin', named('a')).nodeName, 'A');
    one.insertAdjacentElement('afterend', named('b'));
    one.insertAdjacentElement('afterbegin', named('i'));
    one.insertAdjacentText('beforeend', 'text');
    assert.deepEqual(
      [...outer.childNodes].map((node: Dom) => node.nodeName),
      ['A', 'SPAN', 'B'],
    );
    assert.deepEqual(
      [...one.childNodes].map((node: Dom) => node.nodeName),
      ['I', '#text'],
    );
    assert.equal(named('div').insertAdjacentElement('afterend', named('p')), null);
    assert.equal(
      nameOf(() => one.insertAdjacentElement('inside', named('p'))),
      'SyntaxError',
    );
    assert.equal(
      nameOf(() => one.insertAdjacentElement('afterend', 'p')),
      'TypeError',
    );
  });
});

describe('what an element and a doctype are handed', () => {
  it('say they take two arguments where they do', async () => {
    const document = await page();
    const made = document.implementation.createHTMLDocument('t');
    const nodes = [document.createElement('div'), document, document.doctype, made, made.doctype];
    for (const node of nodes) {
      assert.deepEqual([node.insertBefore.length, node.replaceChild.length], [2, 2]);
    }
  });

  it('refuse a doctype in an element, and make text of what is no node', async () => {
    const document = await page();
    const doctype = document.doctype;
    const div = document.createElement('div');
    assert.equal(
      nameOf(() => div.append(doctype)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => div.prepend(doctype)),
      'HierarchyRequestError',
    );
    assert.equal(doctype.parentNode, document, 'and it stays where it is');
    div.prepend(null, undefined);
    assert.equal(div.textContent, 'nullundefined');
    // One made in no document as well.
    const loose = document.implementation.createDocumentType('html', '', '');
    assert.equal(
      nameOf(() => div.append(loose)),
      'HierarchyRequestError',
    );
  });

  it('is a TypeError to hand a doctype what is no node', async () => {
    const document = await page();
    const doctype = document.implementation.createDocumentType('html', '', '');
    assert.equal(
      nameOf(() => doctype.insertBefore(null, null)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => doctype.appendChild(null)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => doctype.appendChild(document.createTextNode('t'))),
      'HierarchyRequestError',
    );
  });
});

describe('moveBefore', () => {
  it('moves a node within the page, before a child or to the end', async () => {
    const document = await page();
    const parent = document.getElementById('page');
    const one = document.getElementById('one');
    const two = parent.appendChild(document.createElement('b'));
    const text = parent.appendChild(document.createTextNode('t'));
    assert.equal(parent.moveBefore(two, one), undefined);
    assert.deepEqual([...parent.childNodes], [two, one, text]);
    parent.moveBefore(two, null);
    assert.deepEqual([...parent.childNodes], [one, text, two]);
    one.moveBefore(text, null);
    assert.equal(text.parentNode, one);
  });

  it('moves a node only within its own tree, a document or a tree out of one', async () => {
    const document = await page();
    const parent = document.getElementById('page');
    const loose = document.createElement('div');
    const one = document.getElementById('one');
    assert.equal(
      nameOf(() => parent.moveBefore(loose, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => loose.moveBefore(one, null)),
      'HierarchyRequestError',
    );
    assert.equal(one.parentNode, parent);
    // Out of the page, within one tree, a node moves.
    const holder = loose.appendChild(document.createElement('div'));
    const moved = loose.appendChild(document.createElement('p'));
    holder.moveBefore(moved, null);
    assert.equal(moved.parentNode, holder);
    assert.equal(
      nameOf(() => document.createElement('div').moveBefore(moved, null)),
      'HierarchyRequestError',
    );
    const other = document.implementation.createHTMLDocument('t');
    assert.equal(
      nameOf(() => parent.moveBefore(other.body, null)),
      'HierarchyRequestError',
    );
  });

  it('moves only an element or character data, and checks as an insertion does', async () => {
    const document = await page();
    const parent = document.getElementById('page');
    const one = document.getElementById('one');
    assert.equal(
      nameOf(() => parent.moveBefore(document.createDocumentFragment(), null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => parent.moveBefore(document.doctype, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => one.moveBefore(parent, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => parent.moveBefore(null, null)),
      'TypeError',
    );
    assert.equal(
      nameOf(() => parent.moveBefore(one)),
      'TypeError',
    );
  });
});

describe('moveBefore on a document', () => {
  it('moves what may be its child into it, from within its own tree only', async () => {
    const doc = await page();
    const document = doc;
    const comment = doc.body.appendChild(doc.createComment('c'));
    doc.moveBefore(comment, null);
    assert.equal(comment.parentNode, doc);
    assert.equal(doc.lastChild, comment);
    doc.moveBefore(comment, doc.documentElement);
    assert.equal(doc.documentElement.previousSibling, comment);
    // One element, and no text, as for any insertion; and not one from another document.
    assert.equal(
      nameOf(() => doc.moveBefore(doc.body, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(doc.body.appendChild(doc.createTextNode('t')), null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(document.createComment('c'), null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(doc.doctype, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(comment)),
      'TypeError',
    );
  });

  it("moves what may be a made document's child into it, from within its tree only", async () => {
    const document = await page();
    const doc = document.implementation.createHTMLDocument('t');
    const comment = doc.body.appendChild(doc.createComment('c'));
    doc.moveBefore(comment, null);
    assert.equal(comment.parentNode, doc);
    assert.equal(doc.lastChild, comment);
    doc.moveBefore(comment, doc.documentElement);
    assert.equal(doc.documentElement.previousSibling, comment);
    // One element, and no text, as for any insertion; and not one from another document.
    assert.equal(
      nameOf(() => doc.moveBefore(doc.body, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(doc.body.appendChild(doc.createTextNode('t')), null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(document.createComment('c'), null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(doc.doctype, null)),
      'HierarchyRequestError',
    );
    assert.equal(
      nameOf(() => doc.moveBefore(comment)),
      'TypeError',
    );
  });
});

describe('moveBefore, and what a node keeps', () => {
  it('keeps a focused field focused, with no blur', async () => {
    const document = await page();
    const parent = document.getElementById('page');
    const other = parent.appendChild(document.createElement('div'));
    // The platform's text field, by the name the engine has for it.
    const field = parent.appendChild(document.createElement('text-input'));
    await settle();
    field.focus();
    const heard: string[] = [];
    for (const type of ['blur', 'focusout', 'focus', 'focusin'])
      field.addEventListener(type, () => heard.push(type));
    other.moveBefore(field, null);
    await settle();
    assert.equal(document.activeElement, field);
    assert.deepEqual(heard, []);
  });

  it('keeps a transition running, where it had got to', async () => {
    let now = 1000;
    const app = await render(Page, { providers: [provideWebCompat()], now: () => now });
    await settle();
    const engine = app.componentRef.injector.get(Engine);
    const tick = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    const document: Dom = app.fixture.componentInstance.document;
    const parent = document.getElementById('page');
    const item = parent.appendChild(document.createElement('div'));
    const other = parent.appendChild(document.createElement('div'));
    // As a stylesheet the build compiled gives it: `transition: left 1000ms linear`.
    const transition = { left: { duration: 1000, delay: 0, easing: [0, 0, 1, 1] } };
    engine.setProp(item, 'style', { position: 'absolute', left: 0, $transition: transition });
    await settle();
    // A view no frame has shown yet starts nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    engine.setProp(item, 'style', { position: 'absolute', left: 400, $transition: transition });
    engine.commit();
    tick(500);
    const left = () => (item.committed?.props as { left?: number } | undefined)?.left;
    try {
      assert.equal(Math.round(left()!), 200);
      other.moveBefore(item, null);
      // What a move leaves to the end of the task, before the next frame.
      await new Promise((resolve) => setTimeout(resolve, 0));
      tick(0);
      assert.equal(Math.round(left()!), 200);
      tick(500);
      assert.equal(left(), 400);
    } finally {
      // Run out, so no frame waits on a clock that no longer moves.
      tick(10_000);
    }
  });
});
