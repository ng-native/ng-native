/**
 * An element's event handler properties, `onclick` and the rest: called for their event in the
 * order they were first written among the listeners, cancelling it with `false`.
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

const globals = globalThis as Dom;

describe('event handler properties', () => {
  it('call the handler written, with the element as this, among the listeners', async () => {
    const document = await page();
    const div = document.createElement('div');
    document.getElementById('page').appendChild(div);
    const heard: string[] = [];
    assert.equal(div.onclick, null);
    div.addEventListener('click', () => heard.push('before'));
    div.onclick = function (this: Dom, event: Dom) {
      heard.push(`handler ${this === div} ${event.type}`);
    };
    div.addEventListener('click', () => heard.push('after'));
    div.dispatchEvent(new globals.Event('click'));
    assert.deepEqual(heard, ['before', 'handler true click', 'after']);
    // Written again, it keeps its place.
    div.onclick = () => heard.push('again');
    heard.length = 0;
    div.dispatchEvent(new globals.Event('click'));
    assert.deepEqual(heard, ['before', 'again', 'after']);
  });

  it('cancels the event where the handler answers false, and is taken off with null', async () => {
    const document = await page();
    const div = document.createElement('div');
    let calls = 0;
    div.oninput = () => {
      calls++;
      return false;
    };
    const event = new globals.Event('input', { cancelable: true });
    div.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    div.oninput = null;
    assert.equal(div.oninput, null);
    div.dispatchEvent(new globals.Event('input'));
    assert.equal(calls, 1);
    div.onchange = 'not a function';
    assert.equal(div.onchange, null);
    assert.equal(document.createTextNode('t').onclick, undefined);
  });

  it('checks a checkbox before its click handler runs', async () => {
    const document = await page();
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.getElementById('page').appendChild(input);
    let checked: boolean | undefined;
    input.onclick = () => (checked = input.checked);
    input.click();
    assert.equal(checked, true);
  });
});
