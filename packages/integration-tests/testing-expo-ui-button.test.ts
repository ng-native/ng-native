/**
 * An `@expo/ui` button under `@ng-native/testing`, found and pressed as a core one is. SwiftUI's and
 * Compose's buttons are read out as buttons by their label, and fire `buttonPress` (iOS) or
 * `buttonPressed` (Android) when tapped, which is what the queries and `userEvent` follow.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { registerExpoUiViews } from '@ng-native/expo';
import { cleanup, fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Counter {
  (): number;
}

interface Fixture {
  readonly saved: Counter;
  readonly composed: Counter;
  readonly shared: Counter;
  readonly deleted: Counter;
  readonly sent: Counter;
}

let Buttons: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/testing-expo-ui-button.ts');
  Buttons = mod['TestingExpoUiButtonFixture'] as Type<Fixture>;
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

for (const platform of ['ios', 'android'] as const) {
  describe(`an @expo/ui button on ${platform}`, () => {
    async function boot() {
      registerPlatformComponents(platform);
      registerExpoUiViews(platform);
      return (await render(Buttons)).instance;
    }

    it('is found by role and by the label it draws', async () => {
      await boot();
      assert.equal(screen.getAllByRole('button').length, 4);
      assert.ok(screen.getByRole('button', { name: 'Save' }));
      assert.ok(screen.getByRole('button', { name: 'Delete' }));
    });

    it('is named by the text inside it when it has no label', async () => {
      await boot();
      assert.ok(screen.getByRole('button', { name: 'Share' }));
    });

    it('is pressed with userEvent', async () => {
      const app = await boot();
      await userEvent.press(screen.getByRole('button', { name: 'Save' }));
      assert.equal(app.saved(), 1);
      await userEvent.setup().press(screen.getByRole('button', { name: 'Share' }));
      assert.equal(app.shared(), 1);
      assert.equal(app.deleted(), 0, 'and only the one pressed fires');
      assert.equal(
        app.composed(),
        platform === 'android' ? 1 : 0,
        "with Compose's buttonPressed on Android, SwiftUI's buttonPress on iOS",
      );
    });

    it('is pressed with fireEvent.press and a long press', async () => {
      const app = await boot();
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      await fireEvent(screen.getByRole('button', { name: 'Delete' }), 'press');
      await userEvent.longPress(screen.getByRole('button', { name: 'Save' }), { duration: 0 });
      assert.equal(app.saved(), 2);
      assert.equal(app.deleted(), 1);
    });
  });
}

describe('an @expo/ui button on Android', () => {
  it('is pressed with SwiftUI disabled modifier, which Compose does not read', async () => {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    const { instance } = await render(Buttons);
    assert.equal(screen.queryByRole('button', { disabled: true }), null);
    await userEvent.press(screen.getByRole('button', { name: 'Send' }));
    assert.equal(instance.sent(), 1);
  });
});

describe('an @expo/ui button on iOS', () => {
  it('is not found by SwiftUI role, which says what it does and not what it is', async () => {
    await render(Buttons);
    assert.equal(screen.queryByRole('destructive'), null);
  });

  it('is disabled by SwiftUI disabled modifier, and a press does nothing', async () => {
    const { instance } = await render(Buttons);
    const send = screen.getByRole('button', { name: 'Send', disabled: true });
    assert.equal(
      screen.queryByRole('button', { name: 'Save', disabled: true }),
      null,
      'not by a disabled modifier set to false',
    );
    await userEvent.press(send);
    await fireEvent.press(send);
    assert.equal(instance.sent(), 0);
  });
});
