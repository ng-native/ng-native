/**
 * A press on `@expo/ui`'s switch flips it, as a tap does: SwiftUI's `Toggle` sends `isOnChange`
 * with the value it now has, and Compose's `Switch` sends `checkedChange`, which `ui-toggle`
 * reports as `isOnChange`. A switch bound to `isOn` flips from what it was given; one left to
 * itself flips from what it last switched to. SwiftUI's `disabled` modifier leaves it as it is.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { registerExpoUiViews } from '@ng-native/expo';
import { cleanup, fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  wifi(): boolean;
  readonly free: boolean[];
  readonly locked: boolean[];
  readonly stray: unknown[];
}

let Toggles: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/testing-expo-ui-toggle.ts');
  Toggles = mod['TestingExpoUiToggleFixture'] as Type<Fixture>;
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

for (const platform of ['ios', 'android', 'macos'] as const) {
  describe(`a press on an @expo/ui switch on ${platform}`, () => {
    async function boot(): Promise<Fixture> {
      registerPlatformComponents(platform);
      registerExpoUiViews(platform);
      return (await render(Toggles)).instance;
    }

    it('flips one bound to isOn, and back', async () => {
      const app = await boot();
      await userEvent.press(screen.getByTestId('wifi'));
      assert.equal(app.wifi(), false);
      await userEvent.press(screen.getByTestId('wifi'));
      assert.equal(app.wifi(), true);
    });

    it('sends nothing of the kind from a view that is not a switch', async () => {
      const app = await boot();
      await userEvent.press(screen.getByTestId('caption'));
      assert.deepEqual(app.stray, []);
    });

    it('flips one left to itself from what it last switched to', async () => {
      const app = await boot();
      await userEvent.press(screen.getByTestId('free'));
      await fireEvent.press(screen.getByTestId('free'));
      await userEvent.longPress(screen.getByTestId('free'), { duration: 0 });
      assert.deepEqual(app.free, [true, false, true]);
    });
  });
}

describe('a press on an @expo/ui switch on iOS', () => {
  it("does nothing when SwiftUI's disabled modifier turns it off", async () => {
    const app = (await render(Toggles)).instance;
    await userEvent.press(screen.getByTestId('locked'));
    assert.deepEqual(app.locked, []);
  });

  it('flips a new switch from off, not from what one before it switched to', async () => {
    const first = (await render(Toggles)).instance;
    await userEvent.press(screen.getByTestId('free'));
    assert.deepEqual(first.free, [true]);
    cleanup();
    const second = (await render(Toggles)).instance;
    await userEvent.press(screen.getByTestId('free'));
    assert.deepEqual(second.free, [true]);
  });
});

describe('a press on an @expo/ui switch on Android', () => {
  it("flips one SwiftUI's disabled modifier is on, which Compose does not read", async () => {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    const app = (await render(Toggles)).instance;
    await userEvent.press(screen.getByTestId('locked'));
    assert.deepEqual(app.locked, [false]);
  });
});
