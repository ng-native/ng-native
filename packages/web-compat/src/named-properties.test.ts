/**
 * The window's named properties: an element with an id is a global of that name, as a page's
 * script reads it, and a global the window has comes first.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const global = globalThis as Dom;

describe('a named property of the window', () => {
  it('is the element of that id, or each of them, and none once it is gone', async () => {
    const app = await render(Page, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    const target = document.createElement('div');
    target.id = 'namedTarget';
    document.body.appendChild(target);
    assert.equal(global.namedTarget, target);
    assert.equal('namedTarget' in globalThis, true);
    assert.equal(Object.hasOwn(globalThis, 'namedTarget'), false);
    target.remove();
    assert.equal(global.namedTarget, undefined);
    assert.equal('namedTarget' in globalThis, false);
    // Two of a name are each of them, from the next task.
    const form = document.createElement('form');
    form.setAttribute('name', 'namedTarget');
    document.body.appendChild(target);
    document.body.appendChild(form);
    await Promise.resolve();
    assert.equal(global.namedTarget.length, 2);
    assert.equal(global.namedTarget.item(1), form);
    // An id written in place, with nothing else changed.
    form.remove();
    target.id = 'renamedTarget';
    assert.equal(global.renamedTarget, target);
    // A global the window has is not shadowed by an element of its name.
    const shadow = document.createElement('div');
    shadow.id = 'setTimeout';
    document.body.appendChild(shadow);
    assert.equal(typeof global.setTimeout, 'function');
  });

  it('is taken away with the window', async () => {
    const before = Object.getPrototypeOf(globalThis);
    await render(Page, { providers: [provideWebCompat()] });
    cleanup();
    assert.equal(Object.getPrototypeOf(globalThis), before);
  });
});
