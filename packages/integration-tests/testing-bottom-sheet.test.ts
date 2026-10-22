/**
 * A `ui-bottom-sheet` under `@ng-native/testing`'s `render()`, driven as a user would: its rows
 * pressed and the items in its bar there to press, as they are on a device.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { registerExpoUiViews } from '@ng-native/expo';
import { cleanup, fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  count(): number;
  saved(): number;
}

let Sheet: Type<Fixture>;

before(async () => {
  Sheet = (await compileFixture('fixtures/testing-bottom-sheet.ts'))[
    'TestingBottomSheetFixture'
  ] as Type<Fixture>;
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

for (const platform of ['ios', 'android'] as const) {
  describe(`an open sheet on ${platform}`, () => {
    it('takes a press on a row of its own', async () => {
      registerPlatformComponents(platform);
      registerExpoUiViews(platform);
      await render(Sheet);
      await userEvent.setup().press(screen.getByRole('button'));
      assert.ok(screen.getByText('Tap 1'));
    });

    it('takes none on a row under a view in it that takes no touch', async () => {
      registerPlatformComponents(platform);
      registerExpoUiViews(platform);
      await render(Sheet);
      await userEvent.setup().press(screen.getByTestId('covered'));
      assert.ok(screen.getByText('Tap 0'));
    });
  });
}

describe('an open sheet with an item in its bar', () => {
  it('has the item in the tree on iOS, to press', async () => {
    const { instance } = await render(Sheet);
    await fireEvent(screen.getByTestId('save'), 'buttonPress');
    assert.equal(instance.saved(), 1);
  });

  it('answers for the build only while something is rendered', async () => {
    const scope = globalThis as { expo?: unknown };
    assert.equal(scope.expo, undefined);
    await render(Sheet);
    cleanup();
    assert.equal(scope.expo, undefined, 'gone with the render');
    await render(Sheet);
    assert.ok(screen.getByTestId('save'), 'and back for the next one');
  });

  it('leaves an expo global a test set as it was', async () => {
    const scope = globalThis as { expo?: unknown };
    const own = {};
    scope.expo = own;
    try {
      await render(Sheet);
      assert.equal(screen.queryByTestId('save'), null, 'a build that does not say it has the bar');
      cleanup();
      assert.equal(scope.expo, own);
      delete scope.expo;
      await render(Sheet);
      scope.expo = own;
      cleanup();
      assert.equal(scope.expo, own, 'and one set while a render was up');
    } finally {
      delete scope.expo;
    }
  });
});
