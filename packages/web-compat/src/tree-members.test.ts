/**
 * What a library does to the tree around a node: copies it, puts nodes beside it and in its
 * place, and asks what the top of its tree is.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-card',
  imports: [Text, View],
  template: `
    <view class="card" testID="card" data-kind="a" [attr.name]="name()">
      <view class="row first"><text>One</text></view>
      <view class="row" id="second"><text>Two</text></view>
    </view>
  `,
})
class Card {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly name = signal<string | null>(null);
}

afterEach(cleanup);

const mount = async () => {
  const app = await render(Card, { providers: [provideWebCompat()] });
  await settle();
  const { host, document } = app.instance;
  return { app, document, card: host.firstElementChild as Dom };
};

describe('cloneNode', () => {
  it('copies what is set on an element, and with deep what it holds', async () => {
    // The CDK's autosize measures a line of a textarea on a copy of it, put beside it and
    // taken away again.
    const { card } = await mount();
    card.setAttribute('style', 'width: 40px');
    const shallow = card.cloneNode(false);
    assert.notEqual(shallow, card);
    assert.equal(shallow.tagName, card.tagName);
    assert.equal(shallow.className, 'card');
    assert.equal(shallow.getAttribute('data-kind'), 'a');
    assert.equal(shallow.getAttribute('style'), 'width: 40px');
    assert.equal(shallow.childNodes.length, 0);
    assert.equal(shallow.parentNode, null, 'in no tree until it is put in one');
    // A copy is its own element: what is set on one is not set on the other.
    shallow.setAttribute('data-kind', 'b');
    shallow.classList.add('copy');
    assert.equal(card.getAttribute('data-kind'), 'a');
    assert.equal(card.className, 'card');

    const deep = card.cloneNode(true);
    assert.equal(deep.textContent, 'OneTwo');
    assert.equal(deep.children.length, 2);
    assert.notEqual(deep.firstChild, card.firstChild);
    assert.equal(deep.isEqualNode(card), true);
    card.parentNode.appendChild(deep);
    assert.equal(deep.isConnected, true);
    await settle();
    assert.equal(screen.getAllByText('One').length, 2, 'and is drawn where it is put');
    deep.remove();
    assert.equal(deep.isConnected, false);
  });

  it('copies a text, a comment and a fragment as what each is', async () => {
    const { document } = await mount();
    const text = document.createTextNode('words').cloneNode();
    assert.deepEqual([text.nodeType, text.data], [3, 'words']);
    const comment = document.createComment('note').cloneNode();
    assert.deepEqual([comment.nodeType, comment.data], [8, 'note']);
    const fragment = document.createDocumentFragment();
    fragment.append('a', document.createElement('b'));
    const copy = fragment.cloneNode(true);
    assert.equal(copy.nodeType, 11);
    assert.deepEqual(
      [...copy.childNodes].map((node: Dom) => node.nodeName),
      ['#text', 'B'],
    );
  });
});

describe('putting nodes beside a node', () => {
  it('puts nodes before, after and in place of a node, and text for what is no node', async () => {
    const { document } = await mount();
    const list = document.createElement('div');
    const [a, b, c] = ['a', 'b', 'c'].map((id) =>
      Object.assign(document.createElement('p'), { id }),
    );
    list.append(b);
    b.before(a, 'one');
    b.after('two', c);
    const said = () => [...list.childNodes].map((node: Dom) => node.id || node.textContent);
    assert.deepEqual(said(), ['a', 'one', 'b', 'two', 'c']);
    // Among what it is handed, a node is put where the rest go.
    b.after(c, b);
    assert.deepEqual(said(), ['a', 'one', 'c', 'b', 'two']);
    b.replaceWith('gone');
    assert.deepEqual([said(), b.parentNode], [['a', 'one', 'c', 'gone', 'two'], null]);
    list.replaceChildren(c, 'last');
    assert.deepEqual(said(), ['c', 'last']);
    list.prepend('first');
    assert.deepEqual(said(), ['first', 'c', 'last']);
    list.append(null);
    assert.equal(list.lastChild.textContent, 'null');
    // A node in no parent has nowhere to put anything.
    b.before('x');
    assert.equal(b.previousSibling, null);
  });

  it('puts a node at the place named around an element', async () => {
    const { document } = await mount();
    const outer = document.createElement('div');
    const one = outer.appendChild(document.createElement('span'));
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
    assert.throws(() => one.insertAdjacentElement('inside', named('p')), { name: 'SyntaxError' });
    assert.throws(() => one.insertAdjacentElement('afterend', 'p'), TypeError);
  });
});

describe('getRootNode', () => {
  it('is the document for a node in the page, and the top of its tree for one that is not', async () => {
    const { document, card } = await mount();
    assert.equal(card.getRootNode(), document);
    assert.equal(document.documentElement.getRootNode(), document);
    const loose = document.createElement('div');
    const inner = loose.appendChild(document.createElement('i'));
    assert.equal(inner.getRootNode(), loose);
    assert.equal(loose.getRootNode(), loose);
  });
});

describe('a live list by name', () => {
  it('follows a name a template binds', async () => {
    const { app, document, card } = await mount();
    const named = document.getElementsByName('panel');
    assert.equal(named.length, 0);
    app.instance.name.set('panel');
    await settle();
    assert.equal(named[0], card);
    app.instance.name.set(null);
    await settle();
    assert.equal(named.length, 0);
  });
});
