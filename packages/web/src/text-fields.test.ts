/**
 * A styled text field and a one-time-code field, through `mount`.
 *
 * `controls.test.ts` already proves a real keystroke reaches `@ng-native/components`' own
 * `TextInput` and reflects a model write back into the field - not repeated here. What this file
 * proves instead is what a styled field built on top of it adds: `invalid`/`touched` ->
 * `data-invalid`, real focus (the field's own `(focus)` and `(blur)`) -> `data-focus`, blur ->
 * whatever a caller wires it to (a real form would wire it the same way `field-forms.test.ts`'s
 * `touch` output does), and the one-time-code field's one real, hidden control driving a row of
 * display-only glyphs computed from the value's length.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OtpApp, TextFieldApp } from './text-fields-app.ts';
import { installJsdomEnvironment } from './jsdom-env.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function bootTextField() {
  const { document } = installJsdomEnvironment();
  const view = document.defaultView as unknown as Window & typeof globalThis;
  const [{ mount }, { TextFieldApp }] = await Promise.all([
    import('./mount.ts'),
    import('./text-fields-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, TextFieldApp);
  await settle();
  const app = componentRef.instance as TextFieldApp;

  const field = (id: string) =>
    document.getElementById(id)!.querySelector<HTMLInputElement>('[data-rn="text-input"]')!;
  const type = async (id: string, text: string) => {
    const el = field(id);
    el.value = text;
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    applicationRef.tick();
    await settle();
  };
  const settled = async () => {
    applicationRef.tick();
    await settle();
  };

  return { document, componentRef, applicationRef, app, field, type, settled };
}

async function bootOtp() {
  const { document } = installJsdomEnvironment();
  const view = document.defaultView as unknown as Window & typeof globalThis;
  const [{ mount }, { OtpApp }] = await Promise.all([
    import('./mount.ts'),
    import('./text-fields-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, OtpApp);
  await settle();
  const app = componentRef.instance as OtpApp;

  const hiddenField = () =>
    document
      .getElementById('otp')!
      .querySelector('[data-slot="input-otp-field"]') as HTMLInputElement;
  const glyphs = () =>
    [
      ...document
        .getElementById('otp')!
        .querySelectorAll<HTMLInputElement>('[data-rn="text-input"]'),
    ].filter((el) => el !== hiddenField());
  const type = async (text: string) => {
    const el = hiddenField();
    el.value = text;
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    applicationRef.tick();
    await settle();
  };

  return { document, componentRef, applicationRef, app, hiddenField, glyphs, type };
}

describe('Input and Textarea, mounted through mount', () => {
  it('reflects a real keystroke into the value model', async () => {
    const { componentRef, app, type } = await bootTextField();
    await type('plain', 'hello@example.com');
    assert.equal(app.value(), 'hello@example.com');
    componentRef.destroy();
  });

  it('marks the box data-disabled, and stops editing, once disabled', async () => {
    const { document, componentRef, app, field, settled } = await bootTextField();
    assert.equal(document.getElementById('plain')!.getAttribute('data-disabled'), null);
    app.off.set(true);
    await settled();
    assert.equal(document.getElementById('plain')!.getAttribute('data-disabled'), '');
    assert.equal(field('plain').readOnly, true, 'disabled() -> editable=false -> readOnly');
    componentRef.destroy();
  });

  it('carries no data-invalid until both invalid and touched are true', async () => {
    const { document, componentRef, app, settled } = await bootTextField();
    const el = document.getElementById('validated')!;
    assert.equal(el.getAttribute('data-invalid'), null);
    app.invalid.set(true);
    await settled();
    assert.equal(el.getAttribute('data-invalid'), null, 'invalid alone is not enough');
    app.touched.set(true);
    await settled();
    assert.equal(el.getAttribute('data-invalid'), '', 'invalid and touched together');
    componentRef.destroy();
  });

  it('sets data-focus on a real focus, and clears it on blur', async () => {
    const { document, componentRef, field } = await bootTextField();
    const el = document.getElementById('validated')!;
    const input = field('validated');
    input.focus();
    await settle();
    assert.equal(el.getAttribute('data-focus'), '', 'a real DOM focus, not a simulated one');
    input.blur();
    await settle();
    assert.equal(el.getAttribute('data-focus'), null);
    componentRef.destroy();
  });

  it('fires touch on blur - the event Signal Forms marks a field touched from', async () => {
    const { componentRef, app, field } = await bootTextField();
    assert.equal(app.touchedFired(), false);
    const input = field('validated');
    input.focus();
    input.blur();
    await settle();
    assert.equal(app.touchedFired(), true);
    componentRef.destroy();
  });

  it('reflects a real keystroke into a textarea the same way', async () => {
    const { componentRef, app, type, field } = await bootTextField();
    assert.equal(field('notes').tagName, 'TEXTAREA', 'multiline, so a textarea');
    assert.equal(field('notes').getAttribute('rows'), '3');
    await type('notes', 'a couple of lines');
    assert.equal(app.notes(), 'a couple of lines');
    componentRef.destroy();
  });
});

describe('InputOtp, mounted through mount', () => {
  it('renders one glyph box per slot', async () => {
    const { componentRef, glyphs } = await bootOtp();
    assert.equal(glyphs().length, 4);
    componentRef.destroy();
  });

  it('reflects typed characters into the value model and the glyph boxes', async () => {
    const { componentRef, app, glyphs, type } = await bootOtp();
    await type('12');
    assert.equal(app.code(), '12');
    assert.equal(glyphs()[0]!.value, '1');
    assert.equal(glyphs()[1]!.value, '2');
    assert.equal(glyphs()[2]!.value, '');
    componentRef.destroy();
  });

  it('fires complete once the value reaches the configured length, and not before', async () => {
    const { componentRef, app, type } = await bootOtp();
    await type('123');
    assert.equal(app.completions.length, 0, 'one short still');
    await type('1234');
    assert.deepEqual(app.completions, ['1234']);
    componentRef.destroy();
  });

  it('does not accept edits while disabled', async () => {
    const { componentRef, app, hiddenField } = await bootOtp();
    app.disabled.set(true);
    await settle();
    assert.equal(hiddenField().readOnly, true, 'editable=false -> readOnly, same as Input');
    componentRef.destroy();
  });
});
