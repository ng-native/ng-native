/**
 * Whether `aria-disabled` and `accessibilityState.disabled` stop a press, per component, as in
 * React Native 0.86.
 *
 * `TouchableOpacity.js` passes `disabled ?? aria-disabled ?? accessibilityState.disabled` to
 * Pressability, and `Text.js` is only pressable while the same merge is not true. `Pressable.js`
 * passes `disabled` alone, so there the other two change what is announced and nothing else.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = { off: { set(value: boolean): void }; pressed: string[] };

let AriaDisabledPress: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/aria-disabled-press.ts');
  AriaDisabledPress = mod['AriaDisabledPress'] as Type<Fixture>;
});

after(cleanup);

const ids = [
  'fade-aria',
  'fade-state',
  'fade-own-false',
  'text-aria',
  'text-state',
  'text-own-false',
  'pressable-aria',
  'pressable-state',
];

describe('aria-disabled and accessibilityState.disabled stop presses as React Native does', () => {
  it('block a touchable-opacity and a pressable text, unless disabled is false, and not a pressable', async () => {
    const { instance, getByTestId, rerender } = await render(AriaDisabledPress);
    const pressAll = async () => {
      instance.pressed.length = 0;
      for (const id of ids) await fireEvent.press(getByTestId(id));
      return [...instance.pressed];
    };

    assert.deepEqual(await pressAll(), [
      'fade-own-false',
      'text-own-false',
      'pressable-aria',
      'pressable-state',
    ]);

    instance.off.set(false);
    await rerender();
    assert.deepEqual(await pressAll(), ids, 'every one presses once enabled');

    instance.off.set(true);
    await rerender();
    assert.deepEqual(await pressAll(), [
      'fade-own-false',
      'text-own-false',
      'pressable-aria',
      'pressable-state',
    ]);
    cleanup();
  });
});
