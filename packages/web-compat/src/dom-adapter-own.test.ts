/**
 * An app that set Angular's DOM adapter itself before it asked for the package keeps it. Angular
 * takes an adapter once, so this runs in a process of its own, as each test file does.
 */
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import {
  ɵDomAdapter as DomAdapter,
  ɵgetDOM as getDOM,
  ɵsetRootDomAdapter as setRootDomAdapter,
} from '@angular/common';
import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { cleanup, render } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {
  readonly meta = inject(Meta);
}

afterEach(() => cleanup());

it("leaves an adapter the app set itself, and Meta makes its tags with the app's", async () => {
  const made: string[] = [];
  const own = {
    createElement(tagName: string) {
      made.push(tagName);
      return globalThis.document.createElement(tagName);
    },
  } as unknown as DomAdapter;
  setRootDomAdapter(own);
  const { meta } = (await render(Page, { providers: [provideWebCompat()] })).instance;
  assert.equal(getDOM(), own);
  meta.addTag({ name: 'x', content: 'y' });
  assert.deepEqual(made, ['meta']);
  cleanup();
  assert.equal(getDOM(), own);
});
