/**
 * The words of a text and of a comment, as the DOM's `CharacterData` has them: what `data` is
 * given, and the offsets its methods take, which are WebIDL's `unsigned long` and are refused
 * past the end.
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

describe('CharacterData', () => {
  it('takes null as no words, as data, nodeValue and textContent', async () => {
    const document = await page();
    const text = document.createTextNode('test');
    text.data = null;
    assert.equal(text.data, '');
    text.data = undefined;
    assert.equal(text.data, 'undefined');
    text.nodeValue = 'a';
    assert.equal(text.data, 'a');
    text.nodeValue = null;
    assert.equal(text.data, '');
    text.textContent = 'b';
    text.textContent = null;
    assert.equal(text.data, '');
  });

  it('keeps the words of a comment, which nothing draws', async () => {
    const document = await page();
    const comment = document.createComment('test');
    assert.equal(comment.data, 'test');
    assert.equal(comment.nodeValue, 'test');
    assert.equal(comment.textContent, 'test');
    assert.equal(comment.length, 4);
    comment.appendData('ing');
    assert.equal(comment.data, 'testing');
    comment.data = null;
    assert.equal(comment.data, '');
    assert.equal(
      nameOf(() => document.createComment()),
      'TypeError',
    );
    assert.equal(document.createComment(undefined).data, 'undefined');
    const element = document.getElementById('page');
    element.appendChild(comment);
    element.appendChild(document.createTextNode('words'));
    comment.data = 'not words';
    assert.equal(element.textContent, 'words');
  });

  it('wraps an offset as an unsigned long, and refuses one past the end', async () => {
    const document = await page();
    const text = document.createTextNode('test');
    assert.equal(
      nameOf(() => text.deleteData(5, 10)),
      'IndexSizeError',
    );
    assert.equal(
      nameOf(() => text.insertData(5, 'x')),
      'IndexSizeError',
    );
    assert.equal(
      nameOf(() => text.replaceData(5, 1, 'x')),
      'IndexSizeError',
    );
    assert.equal(
      nameOf(() => text.substringData(5, 1)),
      'IndexSizeError',
    );
    assert.equal(
      nameOf(() => text.substringData(0)),
      'TypeError',
    );
    assert.equal(text.substringData(0, 0x100000000 + 2), 'te');
    assert.equal(text.substringData(-0x100000000 + 1, 2), 'es');
    assert.equal(text.substringData(1, -1), 'est');
    text.insertData(-0x100000000 + 2, 'X');
    assert.equal(text.data, 'teXst');
    text.deleteData(2, -0x100000000 + 1);
    assert.equal(text.data, 'test');
    text.replaceData(4, 0, '!');
    assert.equal(text.data, 'test!');
  });
});

describe('Text', () => {
  it('splits in two at an offset, the rest after it, and reads with the texts beside it', async () => {
    const document = await page();
    const element = document.getElementById('page');
    const text = element.appendChild(document.createTextNode('abcd'));
    element.appendChild(document.createElement('b'));
    const rest = text.splitText(1);
    assert.equal(text.data + '|' + rest.data, 'a|bcd');
    assert.equal(text.nextSibling === rest, true);
    assert.equal(rest.nextSibling?.nodeName, 'B');
    assert.equal(text.wholeText, 'abcd');
    assert.equal(
      nameOf(() => text.splitText(5)),
      'IndexSizeError',
    );
  });

  it('is a global to make one with and to ask of a node, as Comment and the rest are', async () => {
    const document = await page();
    const { Text, Comment, CharacterData, DocumentFragment } = globalThis as Dom;
    const text = new Text('a');
    assert.equal(text.data, 'a');
    assert.equal(text instanceof Text && text instanceof CharacterData, true);
    assert.equal(new Comment().data, '');
    assert.equal(document.createComment('') instanceof Comment, true);
    assert.equal(document.createElement('a') instanceof CharacterData, false);
    assert.equal(new DocumentFragment() instanceof DocumentFragment, true);
    assert.equal(
      nameOf(() => new CharacterData()),
      'TypeError',
    );
  });

  it('leaves an element no text node for no text', async () => {
    const document = await page();
    const element = document.getElementById('page');
    element.textContent = 'a';
    element.textContent = '';
    assert.equal(element.firstChild, null);
  });
});
