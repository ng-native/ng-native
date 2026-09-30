/**
 * A press from a keyboard or an accessibility service on Android, which arrives as a click rather
 * than a touch.
 *
 * Android's `performClick()` on a focusable React Native view, which is what Enter, the D-pad
 * centre and TalkBack's double-tap all do, reaches JavaScript as `topClick` with no touch around
 * it. `Pressability.js` handles it in `onClick`: `onPress` alone, not while disabled, only on the
 * view that was clicked, and never for a click that carries a `pointerType`, which is the pointer
 * event a touch already pressed through.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { cleanup, fireEvent, render } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = { off: { set(value: boolean): void }; events: string[] };

let ClickPress: Type<Fixture>;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/click-press.ts', import.meta.url)),
  );
  ClickPress = mod['ClickPress'] as Type<Fixture>;
  registerPlatformComponents('android');
});

afterEach(cleanup);

after(() => {
  registerPlatformComponents('ios');
  registerViewName('switch', 'Switch');
  registerViewName('text-input', 'TextInput');
  registerViewName('activity-indicator', 'ActivityIndicatorView');
  registerViewName('refresh-control', 'PullToRefreshView');
  registerViewName('safe-area-view', 'SafeAreaView');
  registerViewName('input-accessory-view', 'InputAccessoryView');
});

describe('a click presses a touchable on Android, as Pressability does', () => {
  it('fires press alone, on every kind of touchable', async () => {
    const { instance, getByTestId } = await render(ClickPress);
    for (const id of ['pressable', 'fade', 'text', 'composed']) {
      await fireEvent(getByTestId(id), 'click');
    }
    assert.deepEqual(
      instance.events.filter((event) => event !== 'outer click'),
      ['pressable', 'fade', 'text', 'composed'],
    );
  });

  it('does not press while disabled, by whatever stops a touch', async () => {
    const { instance, getByTestId, rerender } = await render(ClickPress);
    await fireEvent(getByTestId('off'), 'click');
    await fireEvent(getByTestId('fade-aria'), 'click');
    assert.deepEqual(instance.events, ['outer click', 'outer click']);

    instance.off.set(false);
    await rerender();
    instance.events.length = 0;
    await fireEvent(getByTestId('off'), 'click');
    await fireEvent(getByTestId('fade-aria'), 'click');
    await fireEvent(getByTestId('text-toggle'), 'click');
    assert.deepEqual(instance.events, [
      'off',
      'outer click',
      'fade-aria',
      'outer click',
      'text-toggle',
      'outer click',
    ]);

    instance.off.set(true);
    await rerender();
    instance.events.length = 0;
    await fireEvent(getByTestId('text-toggle'), 'click');
    assert.deepEqual(instance.events, ['outer click'], 'a text no longer pressable');
  });

  it('presses only the control clicked, not a pressable around it', async () => {
    const { instance, getByTestId } = await render(ClickPress);
    await fireEvent(getByTestId('button'), 'click');
    assert.deepEqual(instance.events, ['button', 'outer click']);
  });

  it('ignores a click that is a pointer event, which the touch already pressed', async () => {
    const { instance, getByTestId } = await render(ClickPress);
    await fireEvent(getByTestId('pressable'), 'click', { pointerType: 'touch' });
    assert.deepEqual(instance.events, ['outer click']);
  });
});
