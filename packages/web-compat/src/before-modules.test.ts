/**
 * The window's listeners as a library reaches for them while its modules load, before any app
 * has asked for `provideWebCompat()`: Metro runs `before-modules.js` first, where the config has
 * `withWebCompat`, and what its stand-ins are given is handed to the window once an app is up.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { provideWebCompat } from './provide-web-compat.ts';

type Window = {
  addEventListener(type: string, listener: unknown, options?: unknown): void;
  removeEventListener(type: string, listener: unknown, options?: unknown): void;
  dispatchEvent(event: unknown): boolean;
};
const win = globalThis as unknown as Window & Record<string, unknown>;

/** Run as Metro runs a polyfill: a script, given the global. */
const runBeforeModules = () =>
  new Function('global', readFileSync(new URL('../before-modules.js', import.meta.url), 'utf8'))(
    globalThis,
  );

afterEach(() => {
  cleanup();
  for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) delete win[name];
});

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {}

it('answers a library that asks, as it loads, whether a listener can be passive', () => {
  runBeforeModules();
  // What the CDK's `supportsPassiveEventListeners()` does as its modules load.
  let passive = false;
  const options = Object.defineProperty({}, 'passive', { get: () => (passive = true) });
  win.addEventListener('test', null, options);
  assert.equal(passive, true);
  assert.equal(win.dispatchEvent(new Event('test')), true);
});

it('hands what was listened for to the window once an app is up', async () => {
  runBeforeModules();
  const heard: string[] = [];
  const removed = () => void heard.push('removed');
  win.addEventListener('picked', () => void heard.push('kept'));
  win.addEventListener('picked', removed);
  win.removeEventListener('picked', removed);
  // Taken off as a browser takes one off: by the capture it was added with.
  const captured = () => void heard.push('captured');
  win.addEventListener('picked', captured, { capture: true });
  win.removeEventListener('picked', captured);
  await render(Page, { providers: [provideWebCompat()] });
  win.dispatchEvent(new Event('picked'));
  // A capturing listener first, at the window as anywhere, as a browser has it.
  assert.deepEqual(heard, ['captured', 'kept']);
});

it('puts the stand-ins back once the app is gone, for the next app to be handed', async () => {
  runBeforeModules();
  const standIn = win.addEventListener;
  await render(Page, { providers: [provideWebCompat()] });
  assert.notEqual(win.addEventListener, standIn);
  cleanup();
  assert.equal(win.addEventListener, standIn);
  const heard: string[] = [];
  win.addEventListener('picked', () => void heard.push('later'));
  await render(Page, { providers: [provideWebCompat()] });
  win.dispatchEvent(new Event('picked'));
  assert.deepEqual(heard, ['later']);
});

it('drops a listener whose signal aborts before an app is up, as a browser does', async () => {
  runBeforeModules();
  const heard: string[] = [];
  const early = new AbortController();
  win.addEventListener('picked', () => void heard.push('aborted'), { signal: early.signal });
  early.abort();
  const already = new AbortController();
  already.abort();
  win.addEventListener('picked', () => void heard.push('already'), { signal: already.signal });
  win.addEventListener('picked', () => void heard.push('kept'));
  await render(Page, { providers: [provideWebCompat()] });
  win.dispatchEvent(new Event('picked'));
  assert.deepEqual(heard, ['kept']);
});

it("hands what a library listened for on the document, as it loaded, to an app's document", async () => {
  // Metro's `animation-globals.js` gives the runtime a `document` with no listeners of its own:
  // a library that notes the last touch on it as its module loads threw.
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const early = { documentElement: { getAnimations: () => [] } } as Record<string, unknown>;
  Object.defineProperty(globalThis, 'document', {
    value: early,
    configurable: true,
    writable: true,
  });
  try {
    runBeforeModules();
    const heard: string[] = [];
    const listen = early['addEventListener'] as Window['addEventListener'];
    listen('picked', () => void heard.push('kept'));
    const removed = () => void heard.push('removed');
    listen('picked', removed);
    (early['removeEventListener'] as Window['removeEventListener'])('picked', removed);
    await render(Page, { providers: [provideWebCompat()] });
    const document = (globalThis as unknown as { document: Window }).document;
    assert.notEqual(document, early, "the app's own document");
    document.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, ['kept']);
    // The library keeps the document it listened on, and takes its listener off that one later,
    // or listens there again: the app's document follows it.
    const kept = () => void heard.push('kept');
    heard.length = 0;
    listen('later', kept);
    document.dispatchEvent(new Event('later'));
    assert.deepEqual(heard, ['kept'], 'a listener added after the app is up is heard');
    (early['removeEventListener'] as Window['removeEventListener'])('later', kept);
    document.dispatchEvent(new Event('later'));
    assert.deepEqual(heard, ['kept'], 'and taken off again');

    // Each app is handed them, a second as the first is up, and one that went is told no more.
    const second = await render(Page, { providers: [provideWebCompat()] });
    const other = (globalThis as unknown as { document: Window }).document;
    assert.notEqual(other, document, "the second app's own document");
    heard.length = 0;
    other.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, ['kept'], 'the second app hears what was listened for early');
    const both = () => void heard.push('both');
    heard.length = 0;
    listen('later', both);
    document.dispatchEvent(new Event('later'));
    other.dispatchEvent(new Event('later'));
    assert.deepEqual(heard, ['both', 'both'], 'a later listener reaches both');
    second.unmount();
    const gone = () => void heard.push('gone');
    heard.length = 0;
    listen('after', gone);
    other.dispatchEvent(new Event('after'));
    document.dispatchEvent(new Event('after'));
    assert.deepEqual(heard, ['gone'], 'and not the document of an app that went');
  } finally {
    cleanup();
    if (had) Object.defineProperty(globalThis, 'document', had);
    else delete (globalThis as { document?: unknown }).document;
  }
});
