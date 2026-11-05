/**
 * `injectToken` in a real browser, for what jsdom cannot show: it hands a custom property down to
 * no element, styles an element that is not in the document as if it were, and has no
 * `prefers-color-scheme` to change.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { TokenApp } from '../src/token-app.ts';
import { boot, settle, waitFor } from './boot.ts';

let sheet: HTMLStyleElement;

beforeEach(() => {
  sheet = document.createElement('style');
  sheet.textContent =
    'app-root { --brand: #ff0000; --accent: var(--brand) }' +
    ' @media (prefers-color-scheme: dark) { app-root { --brand: #0000ff } }' +
    ' .local { --accent: #00ff00 }';
  document.head.appendChild(sheet);
});

afterEach(async () => {
  sheet.remove();
  await commands.emulateColorScheme('light');
});

describe('a token read in a browser', () => {
  it('follows a media query on the colour scheme, with no class to change', async () => {
    const { componentRef } = boot(TokenApp);
    const app = componentRef.instance as TokenApp;
    expect(app.accent()).toBe('#ff0000');
    await commands.emulateColorScheme('dark');
    await waitFor(() => app.accent() === '#0000ff', 'the dark value');
  });

  it('reads at a node put in after it was built, as a class above it sets the token', async () => {
    const { componentRef, root } = boot(TokenApp);
    const app = componentRef.instance as TokenApp;
    app.scoped.set(true);
    await settle();
    await waitFor(() => root.querySelector('app-scoped')?.textContent?.trim() === '#00ff00');
  });
});
