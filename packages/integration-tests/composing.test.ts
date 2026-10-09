/**
 * Composing a control out of the host behaviours: `PressBehavior` on a component's own host, and
 * a directive telling the view what it is through `contributeAccessibility`. What a behaviour
 * library builds on, written with the testing library an app would use.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Checked = () => { checked(): boolean };
type ComposingCheckboxes = {
  checkbox: Checked;
  unforwarded: Checked;
  injected: Checked;
  presses(): number;
};

describe('a control composed from the host behaviours', () => {
  let Composing: Type<{ on: { (): boolean }; locked: { set(v: boolean): void } }>;

  before(async () => {
    const mod = await compileFixture('fixtures/composing.ts');
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

  it('reacts to its own press through a host listener once press is forwarded', async () => {
    const { instance } = await render(Composing);
    const host = instance as unknown as ComposingCheckboxes;
    await fireEvent.press(screen.getByTestId('checkbox'));
    assert.equal(host.checkbox().checked(), true, 'the host listener ran');
    assert.equal(host.presses(), 1, 'and a listener outside still hears it');

    await fireEvent.press(screen.getByTestId('unforwarded'));
    assert.equal(
      host.unforwarded().checked(),
      false,
      'unforwarded, the host listener hears nothing',
    );

    await fireEvent.press(screen.getByTestId('injected'));
    assert.equal(host.injected().checked(), true, 'the injected behaviour needs nothing forwarded');
    cleanup();
  });

  it('takes a contributed role over the link a pressable text defaults to', async () => {
    await render(Composing);
    assert.ok(screen.getByRole('togglebutton', { name: 'Bluetooth' }));
    cleanup();
  });

  it('takes no link role when a directive contributes disabled to a pressable text', async () => {
    await render(Composing);
    const props = screen.getByTestId('locked').props;
    assert.deepEqual(props['accessibilityState'], { disabled: true });
    assert.equal(props['accessibilityRole'] ?? null, null);
    cleanup();
  });
});
