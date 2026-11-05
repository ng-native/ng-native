/**
 * `injectToken` on the web host: a custom property read with the browser's own
 * `getComputedStyle`, at the mount root, where the `dark` class `mount` keeps switches the theme.
 *
 * jsdom has no `matchMedia`, so the OS setting is a stand-in for one, flipped by hand.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { installJsdomEnvironment } from './jsdom-env.ts';
import type { mount as Mount } from './mount.ts';
import type { TokenApp as App } from './token-app.ts';

let mount: typeof Mount;
let TokenApp: typeof App;
let document: Document;
let window: Window;

function system(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  (window as unknown as { matchMedia: unknown }).matchMedia = () => query;
  return (next: boolean) => {
    query.matches = next;
    for (const fn of [...listeners]) fn({ matches: next });
  };
}

before(async () => {
  ({ document, window } = installJsdomEnvironment());
  ({ mount } = await import('./mount.ts'));
  ({ TokenApp } = await import('./token-app.ts'));
});

beforeEach(() => {
  document.head.textContent = '';
  document.body.textContent = '';
  const sheet = document.createElement('style');
  sheet.textContent = 'app-root { --accent: #ff0000 } app-root.dark { --accent: #0000ff }';
  document.head.appendChild(sheet);
});

/** Mutation records and signal writes arrive after a microtask. */
const later = () => new Promise((done) => setTimeout(done, 0));

describe('a token read on the web host', () => {
  it('is the mount root’s value from the first frame, and follows the dark class', async () => {
    const flip = system(false);
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    const mounted = mount(root, TokenApp);
    const app = mounted.componentRef.instance as App;
    assert.equal(app.accent(), '#ff0000');
    flip(true);
    await later();
    assert.equal(app.accent(), '#0000ff');
    flip(false);
    await later();
    assert.equal(app.accent(), '#ff0000');
    mounted.applicationRef.destroy();
  });

  it('follows a class the app sets itself, with no change of scheme', async () => {
    system(false);
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    const mounted = mount(root, TokenApp, { darkClass: false });
    const app = mounted.componentRef.instance as App;
    root.classList.add('dark');
    await later();
    assert.equal(app.accent(), '#0000ff');
    mounted.applicationRef.destroy();
  });
});
