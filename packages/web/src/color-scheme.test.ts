/**
 * The `dark` class `mount` keeps on its root, which is what `@ng-native/tailwind`'s `dark:` variant
 * and a theme's `.dark { --token: ... }` block match beneath, as `watchConditions` keeps it on a
 * device's root.
 *
 * jsdom has no `matchMedia`, so the OS setting is a stand-in for one, flipped by hand.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { installJsdomEnvironment } from './jsdom-env.ts';
import type { mount as Mount, MountOptions } from './mount.ts';
import type { ColorSchemeApp as App } from './color-scheme-app.ts';

let mount: typeof Mount;
let ColorSchemeApp: typeof App;
let document: Document;
let window: Window;

/** `prefers-color-scheme: dark`, as the OS would answer it and change it. */
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

function start(options: MountOptions = {}) {
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const mounted = mount(root, ColorSchemeApp, options);
  const tick = () => mounted.applicationRef.tick();
  return { root, mounted, tick, app: mounted.componentRef.instance as App };
}

before(async () => {
  ({ document, window } = installJsdomEnvironment());
  ({ mount } = await import('./mount.ts'));
  ({ ColorSchemeApp } = await import('./color-scheme-app.ts'));
});

beforeEach(() => {
  document.body.textContent = '';
});

describe('the dark class on the root', () => {
  it('is there from the first frame when the system is dark', () => {
    system(true);
    const { root } = start();
    assert.equal(root.classList.contains('dark'), true);
  });

  it('follows the system as it changes', () => {
    const flip = system(false);
    const { root, tick } = start();
    assert.equal(root.classList.contains('dark'), false);
    flip(true);
    tick();
    assert.equal(root.classList.contains('dark'), true);
    flip(false);
    tick();
    assert.equal(root.classList.contains('dark'), false);
  });

  it('follows ColorScheme.set over the system, and the system again after set(null)', () => {
    const flip = system(false);
    const { root, tick, app } = start();
    app.scheme.set('dark');
    tick();
    assert.equal(root.classList.contains('dark'), true);
    assert.equal(app.scheme.current(), 'dark');
    flip(false);
    tick();
    assert.equal(root.classList.contains('dark'), true, 'the app chose dark');
    app.scheme.set(null);
    tick();
    assert.equal(root.classList.contains('dark'), false);
    assert.equal(app.scheme.current(), 'light');
  });

  it('is left to the app with darkClass: false', () => {
    const flip = system(true);
    const { root, tick } = start({ darkClass: false });
    flip(true);
    tick();
    assert.equal(root.classList.contains('dark'), false);
  });

  it('comes off with the app', () => {
    system(true);
    const { root, mounted } = start();
    mounted.destroy();
    assert.equal(root.classList.contains('dark'), false);
  });
});
