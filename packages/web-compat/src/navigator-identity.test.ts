/**
 * `navigator` as a phone's browser has it: a user agent a library reads for a touch device, and
 * how many fingers the screen takes. Put in where the runtime has none, and taken away again.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {}

type Navigator = Record<string, unknown>;
const target = globalThis as unknown as { navigator?: Navigator };
const navigator = () => target.navigator;

/** Run `body` with `navigator` as given, and put the runtime's own back after. */
async function withNavigator(value: Navigator, body: () => Promise<void>): Promise<void> {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value });
  try {
    await body();
  } finally {
    cleanup();
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete target.navigator;
  }
}

describe('navigator', () => {
  it('says it is a phone, as a library reads a touch device from the user agent', async () => {
    // As React Native has it: a navigator that says nothing of a browser.
    await withNavigator({ product: 'ReactNative' }, async () => {
      await render(Page, { providers: [provideWebCompat()] });
      await settle();
      const agent = String(navigator()?.['userAgent']);
      // Highcharts' own test for a touch device, and the CDK's for iOS.
      assert.match(agent, /(Mobile|Android|Windows Phone)/);
      assert.match(agent, /iPad|iPhone|iPod/);
      assert.equal(navigator()?.['maxTouchPoints'], 5);
      cleanup();
      assert.deepEqual(navigator(), { product: 'ReactNative' }, 'taken away with the page');
    });
  });

  it('names no version of the system or the browser, which it cannot know', async () => {
    // A library that reads a version from it would read one the phone may not have.
    await render(Page, { providers: [provideWebCompat()] });
    const agent = String(navigator()?.['userAgent']);
    assert.match(agent, /iPhone/);
    assert.doesNotMatch(agent, /OS \d|Version\/\d|Android \d/);
  });

  it('names a phone of the platform the app runs on', async () => {
    await withNavigator({ product: 'ReactNative' }, async () => {
      try {
        registerPlatformComponents('android');
        await render(Page, { providers: [provideWebCompat()] });
        const agent = String(navigator()?.['userAgent']);
        assert.match(agent, /Android/);
        assert.match(agent, /Mobile/);
        assert.doesNotMatch(agent, /iPhone/);
      } finally {
        registerPlatformComponents('ios');
      }
    });
  });

  it("replaces Node's own user agent, and gives back its own after", async () => {
    // Node's navigator is `Node.js/<major>`: no browser, so no touch device.
    const own = navigator()?.['userAgent'];
    assert.match(String(own), /^Node\.js/);
    await render(Page, { providers: [provideWebCompat()] });
    assert.match(String(navigator()?.['userAgent']), /iPhone/);
    cleanup();
    assert.equal(navigator()?.['userAgent'], own);
    assert.equal(navigator()?.['maxTouchPoints'], undefined);
  });

  it('leaves a user agent and a touch count the runtime has as they are', async () => {
    await withNavigator({ userAgent: 'Mozilla/5.0 (X11) jsdom', maxTouchPoints: 0 }, async () => {
      await render(Page, { providers: [provideWebCompat()] });
      await settle();
      assert.equal(navigator()?.['userAgent'], 'Mozilla/5.0 (X11) jsdom');
      assert.equal(navigator()?.['maxTouchPoints'], 0);
      cleanup();
      assert.equal(navigator()?.['userAgent'], 'Mozilla/5.0 (X11) jsdom');
      assert.equal(navigator()?.['maxTouchPoints'], 0);
    });
  });

  it('gives back a user agent of its own that names no browser, as it was', async () => {
    // React Native's own navigator, or a runtime's, that says what it is and is no browser.
    await withNavigator({ product: 'ReactNative', userAgent: 'Hermes' }, async () => {
      await render(Page, { providers: [provideWebCompat()] });
      assert.match(String(navigator()?.['userAgent']), /iPhone/);
      cleanup();
      assert.equal(navigator()?.['userAgent'], 'Hermes');
      assert.deepEqual(Object.keys(navigator()!).sort(), ['product', 'userAgent']);
    });
  });

  it('is left as it is for an app that did not ask for the package', async () => {
    await withNavigator({ product: 'ReactNative' }, async () => {
      await render(Page);
      assert.deepEqual(navigator(), { product: 'ReactNative' });
    });
  });
});
