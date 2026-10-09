/**
 * A text field as a whole Signal Forms control: the half of the contract past the value.
 *
 * `signal-forms.test.ts` already proves `<text-input [formField]>` carries the value both ways and takes the
 * imperative `focus`/`blur` commands, and `primitives-behaviour.test.ts` the change echo and
 * `submitBehavior`. What is left is what Signal Forms reads and writes by name - `touch` out,
 * `disabled`, `readonly`, `invalid` and `touched` in - on a bare `<text-input [formField]>`, plus
 * the keyboard-only props the web has no equivalent for reaching the native field untouched.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { fireEvent, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The field publishes invalid and touched separately; waiting for both is the stylesheet's call.
const SHEET = `
  [data-invalid][data-touched] { border-top-color: rgb(9, 9, 9) }
  [data-disabled] { opacity: 0.5 }
`;

describe('a text input as a Signal Forms control', () => {
  let host: {
    model: { set(v: { email: string }): void };
    locked: { set(v: boolean): void };
    frozen: { set(v: boolean): void };
    signUp: { email: () => { touched: () => boolean } };
  };

  before(async () => {
    const mod = await compileFixture('fixtures/text-input-form.ts');
    const { instance } = await render(mod['TextInputForm'] as Type<unknown>, {
      globalStyles: compileCss(SHEET, 'global'),
    });
    host = instance as typeof host;
  });

  // `<text-input>` is a directive on the native field itself, not a wrapper around one, so the
  // node a nativeID finds already is the field - there is no separate "wrapper" to look under.
  const field = (id: string) => screen.getByTestId(id);

  it('passes the keyboard-only props straight through to the native field', () => {
    const typed = field('typed');
    assert.equal(typed.props['placeholder'], 'you@example.com');
    assert.equal(typed.props['keyboardType'], 'email-address');
    assert.equal(typed.props['secureTextEntry'], true);
    assert.equal(typed.props['autoCapitalize'], 'none');
  });

  it('passes multiline and its alignment through, and leaves a one-line field alone', () => {
    assert.equal(field('notes').props['multiline'], true);
    assert.equal(field('notes').props['textAlignVertical'], 'top');
    assert.equal(field('typed').props['multiline'], undefined, 'one line never grows lines');
  });

  it('waits for touched before publishing invalid, though the field is invalid already', () => {
    // Required and empty, so invalid from the start - and silent, which is what a form that has
    // just appeared should be.
    assert.equal(field('email').props['borderTopColor'], undefined);
  });

  it('reads invalid and touched written as static attributes', () => {
    assert.equal(field('said-invalid').props['borderTopColor'], 'rgb(9, 9, 9)');
    assert.equal(
      field('said-valid').props['borderTopColor'],
      undefined,
      'invalid="false" is valid',
    );
  });

  it('marks the field touched when native focus leaves it', async () => {
    // Signal Forms marks a field touched from the control's `touch` output. There is no DOM blur
    // here, so without the native one forwarded a required field stays untouched forever.
    assert.equal(host.signUp.email().touched(), false, 'nobody has been near it');
    await fireEvent.focus(field('email'));
    await fireEvent.blur(field('email'));
    assert.equal(host.signUp.email().touched(), true);
  });

  it('publishes invalid once touched, and clears it when the value becomes valid', async () => {
    assert.equal(field('email').props['borderTopColor'], 'rgb(9, 9, 9)', 'touched just now');
    host.model.set({ email: 'ada@example.com' });
    await settle();
    // `null` rather than absent: clearing a prop on the native side means sending null.
    assert.equal(field('email').props['borderTopColor'], null);
  });

  it('turns editable off when the form disables the field, and back on', async () => {
    assert.notEqual(field('email').props['editable'], false, 'editable to begin with');
    host.locked.set(true);
    await settle();
    assert.equal(field('email').props['editable'], false);
    assert.equal(
      (field('email').props['accessibilityState'] as { disabled?: boolean } | undefined)?.disabled,
      true,
      'and is announced',
    );
    assert.equal(field('email').props['opacity'], 0.5, 'and disabled reaches the cascade');
    host.locked.set(false);
    await settle();
    assert.notEqual(field('email').props['editable'], false);
  });

  it('turns editable off for a read-only field without announcing it disabled', async () => {
    host.frozen.set(true);
    await settle();
    assert.equal(field('email').props['editable'], false);
    assert.notEqual(
      (field('email').props['accessibilityState'] as { disabled?: boolean } | undefined)?.disabled,
      true,
    );
    host.frozen.set(false);
    await settle();
    assert.notEqual(field('email').props['editable'], false);
  });
});
