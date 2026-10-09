/**
 * A docked bar on a screen something covers. The keyboard it sits on belongs to the window, so it
 * would stay up over a screen pushed over the bar's own or a sheet presented from it; the dock
 * lets it go when its screen goes behind.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { Keyboard, type KeyboardMetrics } from '@ng-native/device';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/docked-stack.ts');
});

async function boot() {
  let dismissals = 0;
  const listeners = new Set<(metrics: KeyboardMetrics) => void>();
  const app = await render(mod['DockedShell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(mod['dockedRoutes'] as Routes),
      {
        provide: Keyboard.SOURCE,
        useValue: {
          subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          dismiss: () => {
            dismissals++;
            for (const listener of listeners) listener({ height: 0 });
          },
        },
      },
    ],
  });
  await settle();
  const navigation = app.componentRef.injector.get(NativeNavigation);
  const keyboard = async (metrics: KeyboardMetrics) => {
    for (const listener of listeners) listener(metrics);
    await settle();
  };
  return { ...app, navigation, keyboard, dismissals: () => dismissals };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a docked bar on a covered screen', () => {
  it('steps down when a screen is pushed over its own', async () => {
    const { navigation, keyboard, dismissals } = await boot();
    await keyboard({ height: 52, screenY: 822 });
    await navigation.push('/profile');
    await settle();
    assert.equal(dismissals(), 1, 'the bar gives up the keyboard');
    await wait(400);
    // And stays down: it does not claim the keyboard back over the screen in front.
    assert.equal(dismissals(), 1);
  });

  it('steps down when a sheet is presented from its screen', async () => {
    const { navigation, keyboard, dismissals } = await boot();
    await keyboard({ height: 52, screenY: 822 });
    await navigation.present('/profile', { as: 'formSheet' });
    await settle();
    assert.equal(dismissals(), 1);
  });
});
