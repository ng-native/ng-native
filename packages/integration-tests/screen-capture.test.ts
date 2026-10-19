/**
 * `ScreenCapture`, over a fake of `expo-screen-capture` that records every call.
 *
 * Screenshots taken are a signal, counted rather than held, since the event carries nothing; the
 * listener behind it ends with the app. The rest is the module's own functions.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector, runInInjectionContext } from '@angular/core';
import { ScreenCapture, type NativeScreenCapture } from '@ng-native/expo/screen-capture';
import { inAppWith, serviceWith } from './injected.ts';

function platform(granted = true) {
  const calls: unknown[][] = [];
  let screenshot: (() => void) | undefined;
  const record =
    <T>(name: string, answer?: T) =>
    async (...args: unknown[]) => (calls.push([name, ...args]), answer);
  const answer = { status: granted ? 'granted' : 'denied', granted, canAskAgain: true };
  const native = {
    isAvailableAsync: record('isAvailableAsync', true),
    preventScreenCaptureAsync: record('preventScreenCaptureAsync'),
    allowScreenCaptureAsync: record('allowScreenCaptureAsync'),
    enableAppSwitcherProtectionAsync: record('enableAppSwitcherProtectionAsync'),
    disableAppSwitcherProtectionAsync: record('disableAppSwitcherProtectionAsync'),
    getPermissionsAsync: record('getPermissionsAsync', answer),
    requestPermissionsAsync: record('requestPermissionsAsync', answer),
    addScreenshotListener: (listener: () => void) => {
      screenshot = listener;
      return { remove: () => void calls.push(['remove']) };
    },
  } as unknown as NativeScreenCapture;
  return Object.assign(native, { calls, screenshot: () => screenshot?.() });
}

const serviceOn = (native: NativeScreenCapture | null) =>
  serviceWith(ScreenCapture.SOURCE, native, () => new ScreenCapture());

describe('screen capture', () => {
  it('counts the screenshots taken', () => {
    const native = platform();
    const capture = serviceOn(native);
    assert.equal(capture.screenshots(), 0);
    native.screenshot();
    native.screenshot();
    assert.equal(capture.screenshots(), 2);
  });

  it('reaches every function of the module under its own name, with its arguments', async () => {
    const native = platform();
    const capture = serviceOn(native);
    assert.equal(await capture.available(), true);
    await capture.prevent('payment');
    await capture.allow('payment');
    await capture.prevent();
    await capture.allow();
    await capture.protectAppSwitcher(0.8);
    await capture.unprotectAppSwitcher();
    assert.deepEqual(native.calls, [
      ['isAvailableAsync'],
      ['preventScreenCaptureAsync', 'payment'],
      ['allowScreenCaptureAsync', 'payment'],
      ['preventScreenCaptureAsync', undefined],
      ['allowScreenCaptureAsync', undefined],
      ['enableAppSwitcherProtectionAsync', 0.8],
      ['disableAppSwitcherProtectionAsync'],
    ]);
  });

  it('checks and asks for the permission through the module s own pair', async () => {
    const native = platform(false);
    const capture = serviceOn(native);
    assert.equal(await capture.permission.ensure(), false);
    assert.deepEqual(
      native.calls.map(([name]) => name),
      ['getPermissionsAsync', 'requestPermissionsAsync'],
    );
  });

  it('stops listening when the app is destroyed', () => {
    const native = platform();
    const injector = Injector.create({
      providers: [{ provide: ScreenCapture.SOURCE, useValue: native }],
    });
    runInInjectionContext(injector, () => new ScreenCapture());
    injector.destroy();
    assert.deepEqual(native.calls, [['remove']]);
  });

  it('is inert rather than broken with no module installed', async () => {
    const capture = serviceOn(null);
    assert.equal(capture.screenshots(), 0);
    assert.equal(await capture.available(), false);
    assert.equal(await capture.permission.ensure(), false);
    await capture.prevent();
    await capture.allow();
    await capture.protectAppSwitcher();
    await capture.unprotectAppSwitcher();
  });
});

describe('screen capture two apps hold', () => {
  // Android recreates an activity after a font size change: the new app mounts and prevents
  // capture, and only then is the old app destroyed, letting go of what it held.
  const appOn = (native: NativeScreenCapture) =>
    inAppWith(ScreenCapture.SOURCE, native, () => new ScreenCapture());
  const allowed = (native: ReturnType<typeof platform>) =>
    native.calls.filter(([name]) => name === 'allowScreenCaptureAsync');

  it('keeps a key a later app holds when the earlier app allows it', async () => {
    const native = platform();
    const old = appOn(native);
    await old.service.prevent('card');
    const current = appOn(native);
    await current.service.prevent('card');

    await old.service.allow('card');
    old.destroy();
    await settle();
    assert.deepEqual(allowed(native), []);
  });

  it('releases the keys an app still holds when it goes, and not another app', async () => {
    const native = platform();
    const old = appOn(native);
    await old.service.prevent('card');
    await old.service.prevent();
    const current = appOn(native);
    await current.service.prevent('card');

    old.destroy();
    await settle();
    assert.deepEqual(allowed(native), [['allowScreenCaptureAsync', 'default']]);
  });

  it('prevents capture again in a window that comes to the front, while a key is held', async () => {
    let front = () => {};
    let again = 0;
    const native = Object.assign(platform(), {
      onWindowFront: (listener: () => void) => ((front = listener), () => {}),
      preventAgain: async () => void again++,
    });
    const capture = serviceOn(native);
    front();
    assert.equal(again, 0, 'nothing held yet');
    await capture.prevent('card');
    front();
    assert.equal(again, 1);
    await capture.allow('card');
    front();
    assert.equal(again, 1, 'nothing held any more');
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
