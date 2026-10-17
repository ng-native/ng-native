import { NativeScript, type NativeScriptRuntime } from '@ng-native/nativescript';
import { cleanup, render, screen } from '@ng-native/testing';
import { afterEach, expect, test } from 'vitest';
import { App } from './app.ts';

afterEach(() => cleanup());

/** What the facts read, stood in for on `globalThis` as NativeScript would put them there. */
const IOS = {
  UIDevice: { currentDevice: { model: 'iPhone', systemName: 'iOS', systemVersion: '27.0' } },
  NSProcessInfo: { processInfo: { activeProcessorCount: 6 } },
  NSTimeZone: { localTimeZone: { name: 'Europe/London' } },
};

/** An iOS runtime with no UI thread: it builds no views, so the torus needs no SceneKit. */
const ios: NativeScriptRuntime = {
  platform: 'ios',
  install: () => {},
  runOnUI: async () => undefined as never,
  loadFramework: () => true,
};

test('renders in Node, where there is no NativeScript, saying what it could not read', async () => {
  await render(App);
  expect(screen.getAllByText('Unknown')).toHaveLength(4);
  expect(screen.queryByTestId('scene')).toBeNull();
});

test('reads the device through call() and shows the torus on iOS', async () => {
  Object.assign(globalThis, IOS);
  try {
    await render(App, {
      providers: [{ provide: NativeScript.RUNTIME, useValue: ios }],
    });
    for (const value of ['iPhone', 'iOS 27.0', '6', 'Europe/London']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.getByTestId('scene').viewName).toBe('NativeScriptUIView');
  } finally {
    for (const name of Object.keys(IOS)) delete (globalThis as Record<string, unknown>)[name];
  }
});
