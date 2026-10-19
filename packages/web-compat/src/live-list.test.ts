/**
 * What a library reads of the tree as lists, and how it asks one node how it stands to another:
 * the live lists `childNodes`, `children` and `getElementsBy*` answer, `compareDocumentPosition`
 * and `isEqualNode`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-list',
  template: `
    <div id="list" class="list">
      <span testID="one" class="item a" id="first"></span>
      <span testID="two" class="item"></span>
    </div>
  `,
})
class List {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async () => {
  const app = await render(List, { providers: [provideWebCompat()] });
  await settle();
  const document = app.fixture.componentInstance.document;
  return { document, list: document.getElementById('list') as Dom };
};

const globals = globalThis as Dom;

describe('live lists', () => {
  it('childNodes sees what is put in and taken out after it was asked for', async () => {
    const { document, list } = await page();
    const nodes = list.childNodes;
    assert.ok(nodes instanceof globals.NodeList);
    assert.equal(nodes, list.childNodes, 'the one list');
    assert.equal(nodes.length, 2);
    const added = document.createElement('span');
    list.appendChild(added);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[2], added);
    assert.equal(nodes.item(2), added);
    assert.equal(nodes.item(3), null);
    assert.equal(nodes[3], undefined);
    const seen: Dom[] = [];
    nodes.forEach((node: Dom) => seen.push(node));
    assert.deepEqual(seen, [...nodes]);
    list.removeChild(added);
    assert.equal(nodes.length, 2);
    assert.deepEqual(Object.keys(nodes), ['0', '1']);
  });

  it('children is the elements alone, and sees what is put in after it was asked for', async () => {
    const { document } = await page();
    const box = document.createElement('div');
    box.append('words', document.createElement('i'), document.createComment('note'));
    const children = box.children;
    assert.ok(children instanceof globals.HTMLCollection);
    assert.equal(children, box.children, 'the one list');
    assert.deepEqual(
      [...children].map((child: Dom) => child.nodeName),
      ['I'],
    );
    const added = document.createElement('b');
    box.append(added, 'more');
    assert.equal(children.length, 2);
    assert.equal(children[1], added);
    assert.equal(children.item(1), added);
    assert.equal(children[0], box.firstElementChild);
    assert.equal(box.childElementCount, children.length);
    box.removeChild(added);
    assert.equal(children.length, 1);
    assert.equal(document.createTextNode('words').children, undefined, 'a text has none');
  });

  it('getElementsByTagName and getElementsByClassName follow the tree and its classes', async () => {
    const { document, list } = await page();
    const spans = list.getElementsByTagName('SPAN');
    const items = document.getElementsByClassName('item a');
    assert.ok(spans instanceof globals.HTMLCollection);
    assert.equal(spans.length, 2);
    assert.equal(items.length, 1);
    const added = document.createElement('span');
    added.className = 'item';
    list.appendChild(added);
    assert.equal(spans.length, 3);
    assert.equal(items.length, 1);
    // A class, with nothing put in or taken out, changes what a list by class holds.
    added.classList.add('a');
    assert.equal(items.length, 2);
    assert.equal(items[1], added);
    // By id, as a property and by `namedItem`, and not where something else has the name.
    assert.equal(spans.namedItem('first'), spans[0]);
    assert.equal(spans.first, spans[0]);
    assert.equal(spans.namedItem('none'), null);
    assert.equal(document.getElementsByTagName('div').namedItem('list'), list);
    // No index past the end, and none to set.
    assert.equal(spans[3], undefined);
    assert.throws(() => {
      'use strict';
      spans[0] = null;
    }, TypeError);
    assert.equal(document.getElementsByClassName('  ').length, 0);
  });

  it('works out what it holds once for as long as the tree does not change', async () => {
    const { document, list } = await page();
    const spans = document.getElementsByTagName('span');
    let reads = 0;
    const children = list.childList;
    Object.defineProperty(list, 'childList', {
      configurable: true,
      get: () => (reads++, children),
      set: () => {},
    });
    try {
      assert.equal(spans.length, 2);
      const once = reads;
      for (let at = 0; at < spans.length; at++) assert.ok(spans[at]);
      assert.equal(reads, once, 'no walk of the page for each index');
      list.appendChild(document.createElement('span'));
      assert.equal(spans.length, 3);
      assert.ok(reads > once, 'and a walk again once it has changed');
    } finally {
      delete list.childList;
      list.childList = children;
    }
  });
});

describe('how one node stands to another', () => {
  it('compareDocumentPosition: before, after, around, in, and apart', async () => {
    const { document, list } = await page();
    const [one, two] = [...list.getElementsByTagName('span')];
    const text = document.createTextNode('in one');
    one.appendChild(text);
    assert.equal(one.compareDocumentPosition(two), 4);
    assert.equal(two.compareDocumentPosition(one), 2);
    assert.equal(text.compareDocumentPosition(two), 4, 'from a text, by what it is in');
    assert.equal(list.compareDocumentPosition(text), 16 | 4);
    assert.equal(text.compareDocumentPosition(list), 8 | 2);
    assert.equal(one.compareDocumentPosition(one), 0);
    const loose = document.createElement('span');
    const apart = one.compareDocumentPosition(loose);
    assert.equal(apart & 1, 1);
    assert.equal(apart & 32, 32);
    // The same answer each time, and the other way round from the other.
    assert.equal(one.compareDocumentPosition(loose), apart);
    assert.equal(loose.compareDocumentPosition(one) & 6, 6 - (apart & 6));
    assert.equal(list.contains(text), true);
    assert.equal(text.contains(text), true);
  });

  it('isEqualNode, normalize and hasChildNodes', async () => {
    const { document, list } = await page();
    const one = list.cloneNode(true);
    assert.equal(one.isEqualNode(list.cloneNode(true)), true);
    const two = list.cloneNode(true);
    two.firstChild.setAttribute('data-x', '1');
    assert.equal(one.isEqualNode(two), false);
    const box = document.createElement('div');
    box.append('a', '', 'b', document.createElement('i'), 'c');
    box.normalize();
    assert.deepEqual(
      [...box.childNodes].map((node: Dom) => node.nodeName),
      ['#text', 'I', '#text'],
    );
    assert.equal(box.firstChild.data, 'ab');
    assert.equal(box.hasChildNodes(), true);
    assert.equal(box.childElementCount, 1);
    assert.equal(box.lastElementChild.nodeName, 'I');
    const comment = document.createComment('a');
    assert.equal(comment.isEqualNode(document.createComment('a')), true);
    assert.equal(comment.isEqualNode(document.createComment('b')), false);
    assert.equal(comment.isSameNode(comment), true);
  });
});

describe('the keys of an HTMLCollection', () => {
  it('are its indices and then each name once, leaving out a name that is an index', async () => {
    const { document, list } = await page();
    const [one, two] = list.children;
    one.id = '0';
    two.id = 'same';
    const three = list.appendChild(document.createElement('span'));
    three.id = 'same';
    three.setAttribute('name', 'other');
    const children = list.children;
    assert.deepEqual(Object.keys(children), ['0', '1', '2']);
    assert.deepEqual(Reflect.ownKeys(children), ['0', '1', '2', 'same', 'other']);
    assert.deepEqual({ ...children }, { 0: one, 1: two, 2: three });
    assert.equal(children.same, two);
    assert.equal(children.namedItem('0'), one);
  });
});
