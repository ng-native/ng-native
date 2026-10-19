/**
 * A form and its controls: whether a box is checked, what a form holds, submitting and resetting
 * it, a file input's picker, and where the selection is in a field.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import { DocumentPicker } from '@ng-native/expo/document-picker';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-order',
  template: `
    <form id="order" name="order" (submit)="said.push('submit')" (reset)="said.push('reset')">
      <input testID="name" id="name" name="name" value="Ada" />
      <textarea testID="note" id="note">Hello</textarea>
      <input testID="gift" id="gift" type="checkbox" [checked]="gift()" />
      <input testID="tea" id="tea" type="radio" name="drink" checked />
      <input testID="coffee" id="coffee" type="radio" name="drink" />
      <select id="size">
        <option value="s">S</option>
        <option value="m">M</option>
      </select>
      <button testID="send" id="send">Send</button>
      <button testID="clear" type="reset">Clear</button>
      <input type="image" />
    </form>
    <input id="outside" form="order" />
    <input id="loose" />
  `,
})
class Order {
  readonly document: Dom = inject(DOCUMENT);
  readonly gift = signal(false);
  readonly said: string[] = [];
}

afterEach(cleanup);

const order = async (providers: unknown[] = []) => {
  const app = await render(Order, { providers: [provideWebCompat(), ...(providers as never[])] });
  await settle();
  const document = app.instance.document;
  const byId = (id: string) => document.getElementById(id);
  return { instance: app.instance, document, byId, form: byId('order') };
};

describe('checked', () => {
  it('is the state a click, a script or a binding sets, and the attribute is its default', async () => {
    const { instance, byId } = await order();
    const gift = byId('gift');
    assert.equal(gift.checked, false);
    await userEvent.press(screen.getByTestId('gift'));
    assert.equal(gift.checked, true);
    assert.equal(gift.defaultChecked, false, 'a click is no attribute');
    instance.gift.set(true);
    await settle();
    instance.gift.set(false);
    await settle();
    assert.equal(gift.checked, false, 'a binding is the state');
    gift.checked = true;
    assert.deepEqual([gift.checked, gift.getAttribute('checked')], [true, null]);
  });

  it("unchecks the rest of a radio's group, and puts it back where the click is cancelled", async () => {
    const { byId } = await order();
    const [tea, coffee] = [byId('tea'), byId('coffee')];
    assert.deepEqual([tea.checked, coffee.checked], [true, false]);
    coffee.checked = true;
    assert.deepEqual([tea.checked, coffee.checked], [false, true]);
    tea.addEventListener('click', (event: Dom) => event.preventDefault());
    tea.click();
    assert.deepEqual([tea.checked, coffee.checked], [false, true]);
    // A radio of the same name outside the form is another group.
    assert.equal(byId('loose').checked, false);
  });
});

describe('a form', () => {
  it('lists its controls, those that name it among them, live as they come and go', async () => {
    const { document, byId, form } = await order();
    const elements = form.elements;
    assert.equal(elements, form.elements, 'the one list');
    assert.deepEqual(
      [...elements].map((each: Dom) => each.id || each.type),
      ['name', 'note', 'gift', 'tea', 'coffee', 'size', 'send', 'reset', 'outside'],
    );
    assert.equal(elements.namedItem('name'), byId('name'));
    assert.equal(form.length, 9);
    assert.equal(byId('outside').form, form);
    byId('loose').setAttribute('form', 'order');
    assert.equal(elements.length, 10, 'one that names it now');
    byId('loose').removeAttribute('form');
    byId('name').remove();
    assert.equal(elements.length, 8, 'and not once it is out');
    byId('gift').type = 'image';
    assert.equal(elements.length, 7, 'nor an image button');
    form.id = 'renamed';
    assert.equal(elements.length, 6, 'nor one that names it by an id it no longer has');
    form.id = 'order';
    assert.equal(document.forms.length, 1);
    assert.equal(document.forms.order, form);
    assert.equal(document.forms, document.forms);
  });

  it('is submitted by requestSubmit, unless a control fails its constraints', async () => {
    const { instance, byId, form } = await order();
    byId('name').required = true;
    byId('name').value = '';
    let invalid = 0;
    byId('name').addEventListener('invalid', () => invalid++);
    form.requestSubmit();
    assert.deepEqual([instance.said, invalid], [[], 1]);
    await userEvent.press(screen.getByTestId('send'));
    assert.deepEqual([instance.said, invalid], [[], 2], 'nor by its button');
    form.noValidate = true;
    form.requestSubmit();
    assert.deepEqual(instance.said, ['submit']);
    form.noValidate = false;
    byId('name').value = 'Ada';
    await userEvent.press(screen.getByTestId('send'));
    assert.deepEqual(instance.said, ['submit', 'submit']);
  });

  it('is submitted by its first submit button on return in a field', async () => {
    const { instance } = await order();
    let clicked = 0;
    instance.document.getElementById('send').addEventListener('click', () => clicked++);
    await fireEvent(screen.getByTestId('name'), 'submitEditing', { text: 'Ada' });
    await settle();
    assert.deepEqual([clicked, instance.said], [1, ['submit']]);
  });

  it('puts every control back as it was written when it is reset', async () => {
    const { instance, byId, form } = await order();
    await fireEvent.changeText(screen.getByTestId('name'), 'Grace');
    await fireEvent.changeText(screen.getByTestId('note'), 'Bye');
    byId('gift').checked = true;
    byId('coffee').checked = true;
    byId('size').value = 'm';
    form.reset();
    assert.deepEqual(instance.said, ['reset']);
    assert.equal(byId('name').value, 'Ada');
    assert.equal(screen.getByTestId('name').props['text'], 'Ada');
    assert.equal(byId('note').value, 'Hello');
    byId('note').textContent = 'Changed';
    assert.equal(byId('note').value, 'Changed', 'what it holds again, as nothing was typed since');
    assert.deepEqual(
      [byId('gift').checked, byId('tea').checked, byId('coffee').checked],
      [false, true, false],
    );
    assert.equal(byId('size').value, 's');
  });

  it('is reset by its reset button, and not where a listener cancels the reset', async () => {
    const { byId, form } = await order();
    byId('gift').checked = true;
    const cancel = (event: Dom) => event.preventDefault();
    form.addEventListener('reset', cancel);
    await userEvent.press(screen.getByTestId('clear'));
    assert.equal(byId('gift').checked, true);
    form.removeEventListener('reset', cancel);
    await userEvent.press(screen.getByTestId('clear'));
    assert.equal(byId('gift').checked, false);
  });
});

describe('a file input', () => {
  const picked = {
    canceled: false,
    assets: [{ name: 'a.pdf', mimeType: 'application/pdf', size: 3, uri: 'file:///a.pdf' }],
  };

  it("opens the system's file picker for its click, and says what was picked", async () => {
    let asked: Dom;
    let answer: Dom = picked;
    const source = {
      getDocumentAsync: async (options: Dom) => ((asked = options), answer),
    };
    const { document } = await order([{ provide: DocumentPicker.SOURCE, useValue: source }]);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.multiple = true;
    const heard: string[] = [];
    for (const type of ['input', 'change', 'cancel']) {
      input.addEventListener(type, () => heard.push(type));
    }
    input.click();
    await settle();
    assert.deepEqual(asked, { type: ['application/pdf'], multiple: true });
    assert.deepEqual(heard, ['input', 'change']);
    assert.equal(input.files.length, 1);
    assert.deepEqual(input.files.item(0), {
      name: 'a.pdf',
      type: 'application/pdf',
      size: 3,
      lastModified: undefined,
      uri: 'file:///a.pdf',
    });
    answer = { canceled: true, assets: [] };
    input.click();
    await settle();
    assert.deepEqual(heard, ['input', 'change', 'cancel']);
    input.disabled = true;
    input.click();
    await settle();
    assert.equal(heard.length, 3, 'not while it is disabled');
  });
});

describe('the selection in a field', () => {
  it('is where it was set while the text is the same, and at the end after', async () => {
    const { byId } = await order();
    const name = byId('name');
    assert.deepEqual([name.selectionStart, name.selectionEnd], [3, 3], 'at the end with none set');
    name.setSelectionRange(1, 2, 'backward');
    assert.deepEqual(
      [name.selectionStart, name.selectionEnd, name.selectionDirection],
      [1, 2, 'backward'],
    );
    name.selectionStart = 0;
    assert.equal(name.selectionStart, 0);
    name.select();
    assert.deepEqual([name.selectionStart, name.selectionEnd], [0, 3]);
    await fireEvent.changeText(screen.getByTestId('name'), 'Grace');
    assert.equal(name.selectionStart, 5, 'gone with the text it was set on');
    assert.equal(byId('gift').selectionStart, null);
    byId('gift').type = 'email';
    assert.throws(() => byId('gift').setSelectionRange(0, 1), { name: 'InvalidStateError' });
  });
});
