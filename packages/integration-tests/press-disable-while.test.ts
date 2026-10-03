/**
 * A component that composes `PressBehavior` refusing presses from its own state, as React
 * Native's `<Pressable disabled={loading || disabled}>` does: the press, what a stylesheet sees
 * and what is announced, together.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Host {
  loading: { set(value: boolean): void };
  disabled: { set(value: boolean | undefined): void };
  presses(): number;
}
let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/press-disable-while.ts', import.meta.url)),
  );
});
afterEach(cleanup);

const mount = async () => {
  const app = await render(mod['LoadingHost'] as Type<Host>);
  const button = () => app.getByTestId('button');
  return { app, button, host: app.instance };
};

describe('PressBehavior.disableWhile', () => {
  it('refuses presses while the condition holds, and takes them again after', async () => {
    const { button, host } = await mount();
    await fireEvent.press(button());
    assert.equal(host.presses(), 1);

    host.loading.set(true);
    await settle();
    await fireEvent.press(button());
    assert.equal(host.presses(), 1, 'refused while loading');

    host.loading.set(false);
    await settle();
    await fireEvent.press(button());
    assert.equal(host.presses(), 2);
  });

  it('is announced as disabled, and seen by a stylesheet, while it holds', async () => {
    const { button, host } = await mount();
    assert.equal(button().props['accessibilityState'], undefined);
    assert.equal(button().props['opacity'], 1);

    host.loading.set(true);
    await settle();
    assert.deepEqual(button().props['accessibilityState'], { disabled: true });
    assert.equal(button().props['opacity'], 0.5);

    host.loading.set(false);
    await settle();
    assert.notEqual(
      (button().props['accessibilityState'] as { disabled?: boolean } | undefined)?.disabled,
      true,
    );
    assert.equal(button().props['opacity'], 1);
  });

  it('is disabled when either the condition or the disabled input says so', async () => {
    const { button, host } = await mount();
    host.disabled.set(true);
    await settle();
    await fireEvent.press(button());
    assert.equal(host.presses(), 0, 'the input alone');

    host.loading.set(true);
    host.disabled.set(false);
    await settle();
    await fireEvent.press(button());
    assert.equal(host.presses(), 0, 'the condition, over a disabled of false');
    assert.deepEqual(button().props['accessibilityState'], { disabled: true });
  });
});
