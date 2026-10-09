/**
 * A DOM component's file imported by native code, under `node --test`: a reference to its page, as
 * in a native bundle. Evaluated, its `mountInWebView` fails as it is imported, with no `window`.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import page from './dom-component-page.ts';

it("imports a 'use dom' file as a reference to its page", () => {
  assert.match(
    page.domComponent,
    /^dom-component-page\.ts\?file=file:\/\/.*dom-component-page\.ts$/,
  );
});
