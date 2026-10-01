/**
 * `[formField]`/`touch` wired to a real Signal Form (`@angular/forms/signals`), through `mount`.
 * `[formField]` finds `value` on `text-input` by name and listens for `touch` to mark a field
 * touched, and the fixture's own error messages read `.errors()`/`.touched()` straight off the
 * field they are given - none of that is web-specific, but nothing had proven it runs over a
 * real DOM blur rather than the fabric `topBlur` `packages/integration-tests/ui-field.test.ts`
 * drives it from.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldFormsApp } from './field-forms-app.ts';
import { installJsdomEnvironment } from './jsdom-env.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boot() {
  const { document } = installJsdomEnvironment();
  const [{ mount }, { FieldFormsApp }] = await Promise.all([
    import('./mount.ts'),
    import('./field-forms-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, FieldFormsApp);
  await settle();
  const app = componentRef.instance as FieldFormsApp;

  const view = document.defaultView as unknown as Window & typeof globalThis;
  const field = (id: string) =>
    document.getElementById(id)!.querySelector<HTMLInputElement>('[data-rn="text-input"]')!;
  const messagesOf = (errorId: string) =>
    [...document.getElementById(errorId)!.querySelectorAll('text')].map((n) => n.textContent);
  const type = async (id: string, text: string) => {
    const el = field(id);
    el.value = text;
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    applicationRef.tick();
    await settle();
  };
  const touch = async (id: string) => {
    const el = field(id);
    el.focus();
    el.blur();
    await settle();
  };

  return { document, componentRef, applicationRef, app, field, messagesOf, type, touch };
}

describe('Field + Signal Forms, mounted through mount', () => {
  it('shows no error before the required field has been touched', async () => {
    const { componentRef, messagesOf } = await boot();
    assert.deepEqual(messagesOf('email-error'), []);
    componentRef.destroy();
  });

  it('shows the required message once a real blur marks the field touched', async () => {
    const { componentRef, messagesOf, touch } = await boot();
    await touch('email');
    assert.deepEqual(messagesOf('email-error'), ['Email is required']);
    componentRef.destroy();
  });

  it('clears the message once a real keystroke satisfies the rule', async () => {
    const { componentRef, messagesOf, touch, type } = await boot();
    await touch('email');
    assert.deepEqual(messagesOf('email-error'), ['Email is required']);
    await type('email', 'alex@example.com');
    assert.deepEqual(messagesOf('email-error'), []);
    componentRef.destroy();
  });

  it('writes the keystroke through to the Signal Form model, not just the field', async () => {
    const { componentRef, app, type } = await boot();
    await type('email', 'alex@example.com');
    assert.equal(app.model().email, 'alex@example.com');
    componentRef.destroy();
  });

  it('shows an always-on error immediately, with no touch needed', async () => {
    // `notes` starts at `'hi'` - two characters, short of `minLength(5)` - and its own error is
    // shown unconditionally in the fixture, not gated on `touched()`, so this is the one field
    // in the fixture that is wrong from the moment it mounts.
    const { componentRef, messagesOf } = await boot();
    assert.deepEqual(messagesOf('notes-error'), ['Say a little more']);
    componentRef.destroy();
  });

  it('clears the always-on error once a real keystroke satisfies minLength', async () => {
    const { componentRef, messagesOf, type } = await boot();
    await type('notes', 'a proper sentence');
    assert.deepEqual(messagesOf('notes-error'), []);
    componentRef.destroy();
  });
});
