/**
 * A tap on an `<input-accessory-view>` written inside a scroll view. On iOS the bar is drawn above
 * the keyboard, outside the scroll view, so a tap on it is not a tap outside the field and leaves
 * the keyboard up, as UIKit's own accessory bars do. React Native's `ScrollView.js` dismisses it,
 * since its responder walks the element tree; this diverges on purpose. Android has no accessory
 * view, and the element is a plain view in the scroll view there.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  readonly persist: { set(value: 'never' | 'handled'): void };
}

let Taps: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/input-accessory-taps.ts');
  Taps = mod['InputAccessoryTapsFixture'] as Type<Fixture>;
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
});

const touch = (node: FakeFabricNode, type: string) =>
  fireEvent(node, type, { pageX: 0, pageY: 0, touches: type === 'topTouchEnd' ? [] : [{}] });

async function tap(id: string): Promise<void> {
  await touch(screen.getByTestId(id), 'topTouchStart');
  await touch(screen.getByTestId(id), 'topTouchEnd');
}

async function focused(persist: 'never' | 'handled') {
  const { fabric, instance } = await render(Taps);
  instance.persist.set(persist);
  await fireEvent(screen.getByTestId('field'), 'focus', {});
  return fabric;
}

for (const persist of ['handled', 'never'] as const) {
  describe(`an input accessory view in a scroll view with taps ${persist}, on iOS`, () => {
    it('leaves the keyboard up for a tap on a disabled button in the bar', async () => {
      const fabric = await focused(persist);
      await tap('up');
      assert.deepEqual(fabric.commands, []);
    });

    it('leaves the keyboard up for a tap on the bar between its controls', async () => {
      const fabric = await focused(persist);
      await tap('gap');
      assert.deepEqual(fabric.commands, []);
    });

    it('still dismisses the keyboard for a tap on the scroll view outside the bar', async () => {
      const fabric = await focused(persist);
      await tap('elsewhere');
      assert.deepEqual(fabric.commands, [{ viewName: 'TextInput', name: 'blur', args: [] }]);
    });
  });
}

describe('an input accessory view in a scroll view, on Android', () => {
  it('is a plain view in the scroll view, and a tap on it dismisses the keyboard', async () => {
    registerPlatformComponents('android');
    const fabric = await focused('handled');
    await tap('gap');
    assert.deepEqual(fabric.commands, [{ viewName: 'AndroidTextInput', name: 'blur', args: [] }]);
  });
});
