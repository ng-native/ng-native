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
