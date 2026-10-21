/**
 * What a library reads from the window and only asks the page's state of: `localStorage` and
 * `sessionStorage`, `getSelection`, `open` and `ShadowRoot`. Each is there while an app that asked
 * for the package is up, and gone after, and one the runtime has is left alone.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, ElementRef, inject } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees: loosely typed, as its own code would be against the DOM. */
type Dom = any;

const globals = globalThis as Dom;
const NAMES = ['localStorage', 'sessionStorage', 'getSelection', 'open', 'ShadowRoot'];

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

describe('the window of an app that asked for the package', () => {
  it('has a localStorage and a sessionStorage that keep what is set, apart from each other', async () => {
    await render(Page, { providers: [provideWebCompat()] });
    const { localStorage, sessionStorage } = globals;
    assert.equal(localStorage.length, 0);
    assert.equal(localStorage.getItem('table'), null);
    localStorage.setItem('table', '{"first":10}');
    localStorage.setItem('count', 3);
    assert.equal(localStorage.getItem('table'), '{"first":10}');
    assert.equal(localStorage.getItem('count'), '3', 'a value is kept as text');
    // And a name is text too, as a browser keeps it.
    localStorage.setItem(7, 'seven');
    assert.equal(localStorage.getItem('7'), 'seven');
    localStorage.removeItem(7);
    assert.equal(localStorage.getItem(7), null);
    assert.equal(localStorage.length, 2);
    assert.equal(localStorage.key(0), 'table');
    assert.equal(localStorage.key(1), 'count');
    assert.equal(localStorage.key(2), null);
    assert.equal(sessionStorage.getItem('table'), null, 'the two are not one');
    localStorage.removeItem('table');
    assert.equal(localStorage.getItem('table'), null);
    assert.equal(localStorage.length, 1);
    localStorage.clear();
    assert.equal(localStorage.length, 0);
    assert.equal(localStorage.getItem('count'), null);
  });

  it('keeps nothing from one app to the next', async () => {
    await render(Page, { providers: [provideWebCompat()] });
    globals.localStorage.setItem('left', 'over');
    cleanup();
    await render(Page, { providers: [provideWebCompat()] });
    assert.equal(globals.localStorage.getItem('left'), null);
  });

  it('has a selection with nothing in it, on the window and the document', async () => {
    await render(Page, { providers: [provideWebCompat()] });
    for (const holder of [globals, globals.document]) {
      const selection = holder.getSelection();
      assert.equal(selection.rangeCount, 0);
      assert.equal(selection.toString(), '');
      assert.equal(selection.isCollapsed, true);
      assert.equal(selection.anchorNode, null);
      assert.doesNotThrow(() => selection.removeAllRanges());
      assert.doesNotThrow(() => selection.addRange({}));
      assert.equal(selection.rangeCount, 0, 'a range added is not kept');
    }
  });

  it('opens no window, and has no element in a shadow tree', async () => {
    const app = await render(Page, { providers: [provideWebCompat()] });
    assert.equal(globals.open('https://example.test'), null);
    assert.equal(typeof globals.ShadowRoot, 'function');
    assert.equal(app.instance.host instanceof globals.ShadowRoot, false);
    assert.equal(globals.document.body instanceof globals.ShadowRoot, false);
  });

  it('takes all of it away again when the app is destroyed', async () => {
    for (const name of NAMES) assert.equal(globals[name], undefined, `${name} before`);
    await render(Page, { providers: [provideWebCompat()] });
    for (const name of NAMES) assert.notEqual(globals[name], undefined, `${name} while up`);
    cleanup();
    for (const name of NAMES) assert.equal(globals[name], undefined, `${name} after`);
  });

  it('leaves one the runtime has, and puts it back as it was', async () => {
    const own = { getItem: () => 'own' };
    globals.localStorage = own;
    try {
      await render(Page, { providers: [provideWebCompat()] });
      assert.equal(globals.localStorage, own);
      cleanup();
      assert.equal(globals.localStorage, own);
    } finally {
      delete globals.localStorage;
    }
  });
});

describe('the window of an app that did not ask for the package', () => {
  it('has none of them', async () => {
    await render(Page);
    for (const name of NAMES) assert.equal(globals[name], undefined, name);
  });
});
