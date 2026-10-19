/**
 * Constraint validation, and the pseudo-classes a control's state answers: `:valid`, `:checked`,
 * `:placeholder-shown` and the rest. Angular's forms and Material read a field's `validity`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: '<form id="form"></form>' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = app.instance.document;
  const form = document.getElementById('form');
  /** An element of a name with attributes, put in the form. */
  const make = (name: string, attributes: Record<string, string> = {}) => {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    form.appendChild(element);
    return element;
  };
  return { document, form, make };
};

describe('constraint validation', () => {
  it("finds a url field's mismatch where the runtime's URL takes anything, as React Native's does", async () => {
    const { make } = await page();
    const url = make('input', { type: 'url' });
    const had = globalThis.URL;
    // React Native's: with no base it keeps what it is given, and throws for nothing.
    (globalThis as Dom).URL = class {
      readonly href: string;
      constructor(href: string) {
        this.href = href;
      }
    };
    try {
      url.value = 'not a url';
      assert.equal(url.validity.typeMismatch, true);
      url.value = 'https://example.com/a';
      assert.equal(url.validity.typeMismatch, false);
    } finally {
      globalThis.URL = had;
    }
  });

  it("works each flag out from the control as it is read, and a script's message", async () => {
    const { make } = await page();
    const name = make('input', { required: '' });
    assert.equal(name.willValidate, true);
    assert.equal(name.validity.valueMissing, true);
    assert.equal(name.validity.valid, false);
    assert.equal(name.validationMessage, 'Please fill out this field.');
    assert.equal(name.validity, name.validity, 'one object for as long as the control is');
    assert.equal(name.validity instanceof (globalThis as Dom).ValidityState, true);
    name.value = 'Ada';
    assert.equal(name.validity.valid, true, 'worked out again when it is read');
    name.setCustomValidity('Taken');
    assert.deepEqual([name.validity.customError, name.validationMessage], [true, 'Taken']);
    name.setCustomValidity('');
    assert.equal(name.validity.valid, true, 'and gone once it is nothing');
    const email = make('input', { type: 'email' });
    email.value = 'not an address';
    assert.equal(email.validity.typeMismatch, true);
    const number = make('input', { type: 'number', min: '2', max: '8', step: '2' });
    number.value = '1';
    assert.equal(number.validity.rangeUnderflow, true);
    number.value = '5';
    assert.equal(number.validity.stepMismatch, true);
    number.value = '10';
    assert.equal(number.validity.rangeOverflow, true);
    const code = make('input', { pattern: '[0-9]{3}' });
    code.value = '12a';
    assert.equal(code.validity.patternMismatch, true);
    const off = make('input', { required: '', disabled: '' });
    assert.deepEqual([off.willValidate, off.validity.valid], [false, true]);
    const check = make('input', { type: 'checkbox', required: '' });
    assert.equal(check.validity.valueMissing, true);
    check.checked = true;
    assert.equal(check.validity.valueMissing, false);
  });

  it("checks a radio's group as one: any of it checked is enough for all", async () => {
    const { make } = await page();
    const [one, two] = [1, 2].map(() => make('input', { type: 'radio', name: 'r', required: '' }));
    assert.equal(two.validity.valueMissing, true);
    one.checked = true;
    assert.equal(two.validity.valueMissing, false);
  });

  it('tells each control that fails `invalid`, from the control and from its form', async () => {
    const { form, make } = await page();
    const name = make('input', { required: '' });
    make('input');
    const heard: string[] = [];
    name.addEventListener('invalid', (event: Dom) => heard.push(event.type));
    assert.equal(name.checkValidity(), false);
    assert.equal(name.reportValidity(), false);
    assert.equal(form.checkValidity(), false);
    assert.deepEqual(heard, ['invalid', 'invalid', 'invalid']);
    name.value = 'x';
    assert.equal(form.checkValidity(), true);
    assert.equal(heard.length, 3);
  });

  it('is not asked of a control in a disabled fieldset', async () => {
    const { document, make } = await page();
    const set = make('fieldset', { disabled: '' });
    const name = document.createElement('input');
    name.setAttribute('required', '');
    set.appendChild(name);
    assert.equal(name.willValidate, false);
    set.disabled = false;
    assert.equal(name.willValidate, true);
  });
});

describe('the pseudo-classes of a form control', () => {
  it('match :valid and :invalid, of a control and of the form it is in', async () => {
    const { form, make } = await page();
    const name = make('input', { required: '' });
    assert.equal(name.matches(':invalid'), true);
    assert.equal(form.matches(':invalid'), true);
    name.value = 'Ada';
    assert.equal(name.matches(':valid'), true);
    assert.equal(form.matches(':valid'), true);
    assert.equal(make('div').matches(':valid'), false, 'nothing that is not validated');
  });

  it('match :in-range and :out-of-range by min and max', async () => {
    const { make } = await page();
    const number = make('input', { type: 'number', min: '1', max: '3' });
    number.value = '2';
    assert.equal(number.matches(':in-range'), true);
    number.value = '4';
    assert.equal(number.matches(':out-of-range'), true);
    assert.equal(make('input', { type: 'number' }).matches(':in-range'), false, 'with no range');
  });

  it('match :placeholder-shown while a field with a placeholder is empty', async () => {
    const { make } = await page();
    const name = make('input', { placeholder: 'Name', testID: 'name' });
    await settle();
    assert.equal(name.matches(':placeholder-shown'), true);
    await fireEvent.changeText(screen.getByTestId('name'), 'A');
    assert.equal(name.matches(':placeholder-shown'), false);
  });

  it('match :checked, :indeterminate and :default by state, not the attribute alone', async () => {
    const { make } = await page();
    const box = make('input', { type: 'checkbox', checked: '' });
    assert.deepEqual([box.matches(':checked'), box.matches(':default')], [true, true]);
    box.checked = false;
    assert.deepEqual([box.matches(':checked'), box.matches(':default')], [false, true]);
    box.indeterminate = true;
    assert.equal(box.matches(':indeterminate'), true);
    box.indeterminate = false;
    assert.equal(box.matches(':indeterminate'), false);
    const first = make('button');
    const second = make('button', { type: 'submit' });
    assert.deepEqual([first.matches(':default'), second.matches(':default')], [true, false]);
  });
});
