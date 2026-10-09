/**
 * A DOM component's file imported by native code, under Vitest: a reference to its page, as in a
 * native bundle. Evaluated, its `mountInWebView` fails as it is imported, with no `window`.
 */
import { expect, it } from 'vitest';
import page from './dom-component-page.ts';

it("imports a 'use dom' file as a reference to its page", () => {
  expect(page.domComponent).toMatch(
    /^dom-component-page\.ts\?file=file:\/\/.*dom-component-page\.ts$/,
  );
});
