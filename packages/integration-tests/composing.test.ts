/**
 * Composing a control out of the host behaviours: `PressBehavior` on a component's own host, and
 * a directive telling the view what it is through `contributeAccessibility`. What a behaviour
 * library builds on, written with the testing library an app would use.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('a control composed from the host behaviours', () => {
  let Composing: Type<{ on: { (): boolean }; locked: { set(v: boolean): void } }>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/composing.ts', import.meta.url)),
    );
    Composing = mod['Composing'] as typeof Composing;
  });

  const toggle = () => screen.getByRole('togglebutton', { name: 'Wi-Fi' });

  it('takes the role and state a directive contributes', async () => {
    await render(Composing);
    assert.deepEqual(toggle().props['accessibilityState'], { checked: false });
    // A press behaviour is an accessibility element and focusable, as `Pressable.js` is.
    assert.equal(toggle().props['accessible'], true);
    cleanup();
  });

  it('presses through the exposed output, and the contributed state follows', async () => {
    const { instance } = await render(Composing);
    await fireEvent.press(toggle());
    assert.equal(instance.on(), true);
    assert.deepEqual(toggle().props['accessibilityState'], { checked: true });
    cleanup();
  });

  it('merges disabled into the state, and stops taking presses', async () => {
    const { instance, rerender } = await render(Composing);
    instance.locked.set(true);
    await rerender();
    assert.deepEqual(toggle().props['accessibilityState'], { checked: false, disabled: true });
    await fireEvent.press(toggle());
    assert.equal(instance.on(), false, 'a disabled control does not claim the touch');
    cleanup();
  });

  it('takes a contributed role over the link a pressable text defaults to', async () => {
    await render(Composing);
    assert.ok(screen.getByRole('togglebutton', { name: 'Bluetooth' }));
    cleanup();
  });
});
