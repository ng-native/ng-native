/**
 * `<input>` and `<textarea>` as the platform's text field: what is typed, what is set, the keys
 * pressed, and what makes one that cannot be typed into.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-fields',
  template: `
    <form id="form" (submit)="submitted.set(submitted() + 1)">
      <input
        testID="name"
        id="name"
        placeholder="Name"
        [value]="value()"
        (input)="typed.set($any($event.target).value)"
        (change)="changed.set($any($event.target).value)"
        (keydown)="keys.push($any($event).key + ':' + $any($event).keyCode)"
      />
      <textarea testID="long" id="long"></textarea>
      <input testID="check" id="check" type="checkbox" />
    </form>
  `,
})
class Fields {
  readonly document: Dom = inject(DOCUMENT);
  readonly value = signal('Ada');
  readonly typed = signal('');
  readonly changed = signal('');
  readonly submitted = signal(0);
  readonly keys: string[] = [];
}

@Component({ selector: 'x-area', template: '<textarea testID="area">Hello</textarea>' })
class Area {
  readonly document: Dom = inject(DOCUMENT);
}

@Component({
  selector: 'x-fenced',
  template: `
    <fieldset [disabled]="off()">
      <legend><input testID="legend" /></legend>
      <input testID="inside" />
      <div><button testID="button" (click)="pressed = pressed + 1">Go</button></div>
    </fieldset>
    <input testID="outside" />
  `,
})
class Fenced {
  readonly off = signal(true);
  pressed = 0;
}

@Component({
  selector: 'x-moved',
  template: `<fieldset id="set" disabled></fieldset>
    <div id="free"></div>`,
})
class Moved {
  readonly document: Dom = inject(DOCUMENT);
}

@Component({ selector: 'x-grow', template: '<textarea testID="area" rows="1"></textarea>' })
class Grow {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const fields = async () => {
  const app = await render(Fields, { providers: [provideWebCompat()] });
  await settle();
  return { app, instance: app.instance, document: app.instance.document as Dom };
};
const field = (id: string) => screen.getByTestId(id);
/** A prop as committed: one taken away is `null` there, and is none. */
const prop = (id: string, key: string) => field(id).props[key] ?? undefined;

describe('a text field', () => {
  it('is the platform text field, an input of one line and a text area of several', async () => {
    await fields();
    assert.match(field('name').viewName, /TextInput$/);
    assert.equal(field('name').props['placeholder'], 'Name');
    assert.match(field('long').viewName, /TextInput$/);
    assert.equal(field('long').props['multiline'], true);
    assert.equal(field('name').props['multiline'], undefined);
  });

  it('is drawn as a browser draws one: no underline, no padding of its own, twenty wide', async () => {
    await fields();
    assert.equal(field('name').props['underlineColorAndroid'], 'transparent');
    assert.equal(field('name').props['paddingTop'], 0);
    assert.equal(field('name').props['paddingBottom'], 0);
    // Twenty characters of the engine's default field font: see `columnsWide`.
    assert.equal(typeof field('name').props['width'], 'number');
    assert.equal(prop('check', 'underlineColorAndroid'), undefined, 'not a checkbox');
  });

  it('leaves an input that is not typed into a plain view, and a field once it is again', async () => {
    const { document } = await fields();
    assert.equal(field('check').viewName, 'View');
    const name = document.getElementById('name');
    name.type = 'radio';
    await settle();
    assert.equal(field('name').viewName, 'View');
    assert.equal(prop('name', 'underlineColorAndroid'), undefined);
    name.type = 'email';
    await settle();
    assert.match(field('name').viewName, /TextInput$/);
    assert.equal(field('name').props['keyboardType'], 'email-address');
  });

  it('shows the value it is given, keeps it as its default, and is read as what was typed', async () => {
    const { instance, document } = await fields();
    const name = document.getElementById('name');
    assert.equal(field('name').props['text'], 'Ada');
    // Kept as the attribute, which native is not sent.
    assert.equal(field('name').props['value'], undefined);
    assert.equal(name.defaultValue, 'Ada');
    instance.value.set('Grace');
    await settle();
    assert.equal(field('name').props['text'], 'Grace');
    await userEvent.type(field('name'), '!');
    assert.equal(name.value, 'Grace!');
    assert.equal(instance.typed(), 'Grace!');
    assert.equal(instance.changed(), 'Grace!', 'a change once the edit ends');
    assert.equal(name.defaultValue, 'Grace', 'what was typed is no attribute');
    name.value = 'Set';
    await settle();
    assert.deepEqual([name.value, field('name').props['text']], ['Set', 'Set']);
    assert.equal(name.getAttribute('value'), 'Grace');
  });

  it('says an input event as it is typed, not a change until the edit ends', async () => {
    const { instance } = await fields();
    await fireEvent.changeText(field('name'), 'Ad');
    assert.equal(instance.typed(), 'Ad');
    assert.equal(instance.changed(), '');
    assert.equal(Number(field('name').props['mostRecentEventCount']) > 0, true);
  });

  it('reads a text area as what it holds until it is typed into', async () => {
    const app = await render(Area, { providers: [provideWebCompat()] });
    const area = app.instance.document.querySelector('textarea');
    assert.deepEqual([area.value, area.defaultValue, area.textLength], ['Hello', 'Hello', 5]);
    await fireEvent.changeText(screen.getByTestId('area'), 'Bye');
    assert.deepEqual([area.value, area.defaultValue], ['Bye', 'Hello']);
  });

  it('tells a listener of each key pressed in it, by its name and by its code', async () => {
    const { instance } = await fields();
    await userEvent.type(field('name'), 'a,', { skipBlur: true });
    await fireEvent(field('name'), 'keyPress', { key: 'Backspace' });
    assert.deepEqual(instance.keys, ['a:65', ',:188', 'Backspace:8']);
  });

  it('tells a key up once every listener has heard it go down', async () => {
    // Native says a key once: a listener to its going up that was added first hears it after.
    const { document } = await fields();
    const name = document.getElementById('name');
    const heard: string[] = [];
    name.addEventListener('keyup', (event: Dom) => heard.push('up:' + event.key));
    name.addEventListener('keydown', (event: Dom) => heard.push('down:' + event.key));
    await fireEvent(field('name'), 'keyPress', { key: 'x' });
    await settle();
    assert.deepEqual(heard, ['down:x', 'up:x']);
  });

  it('tells a field of one line of return as Enter, and submits its form with it', async () => {
    const { instance, document } = await fields();
    const heard: string[] = [];
    document
      .getElementById('name')
      .addEventListener('keyup', (event: Dom) => heard.push(event.key));
    await fireEvent(field('name'), 'submitEditing', { text: 'Ada' });
    await settle();
    assert.deepEqual(instance.keys, ['Enter:13']);
    assert.deepEqual(heard, ['Enter']);
    assert.equal(instance.submitted(), 1, 'its only field: the form is submitted');
    // Kept focused on return while something hears its keys, where native would blur it.
    assert.equal(field('name').props['submitBehavior'], 'submit');
  });

  it('submits nothing on a return a listener stopped', async () => {
    const { instance, document } = await fields();
    document
      .getElementById('name')
      .addEventListener('keydown', (event: Dom) => event.key === 'Enter' && event.preventDefault());
    await fireEvent(field('name'), 'submitEditing', { text: 'Ada' });
    await settle();
    assert.equal(instance.submitted(), 0);
  });

  it('keeps return out of a text area whose listener stopped the key, and tells no one of it', async () => {
    // A composer sends on return, and has no new line left in its field.
    const { document } = await fields();
    const long = document.getElementById('long');
    const typed: string[] = [];
    long.addEventListener('input', () => typed.push(long.value));
    long.addEventListener(
      'keydown',
      (event: Dom) => event.key === 'Enter' && event.preventDefault(),
    );
    await fireEvent.changeText(field('long'), 'Hi');
    await fireEvent(field('long'), 'keyPress', { key: 'Enter' });
    await fireEvent.changeText(field('long'), 'Hi\n');
    assert.equal(long.value, 'Hi');
    assert.deepEqual(typed, ['Hi']);
  });

  it('reads a type as the keyboard and entry it stands for, and follows it changing', async () => {
    const { document } = await fields();
    const name = document.getElementById('name');
    name.setAttribute('type', 'password');
    await settle();
    assert.equal(field('name').props['secureTextEntry'], true);
    name.setAttribute('type', 'tel');
    await settle();
    assert.equal(prop('name', 'secureTextEntry'), undefined);
    assert.equal(field('name').props['keyboardType'], 'phone-pad');
    name.setAttribute('inputmode', 'decimal');
    name.setAttribute('autocomplete', 'one-time-code');
    name.setAttribute('maxlength', '4');
    await settle();
    assert.equal(field('name').props['keyboardType'], 'decimal-pad');
    assert.equal(field('name').props['maxLength'], 4);
    assert.equal(name.getAttribute('maxlength'), '4', 'and kept as written');
    assert.equal(name.maxLength, 4);
  });

  it('cannot be typed into while it is read only or disabled, and can again after', async () => {
    const { document } = await fields();
    const name = document.getElementById('name');
    for (const flag of ['readOnly', 'disabled']) {
      name[flag] = true;
      await settle();
      assert.equal(field('name').props['editable'], false, flag);
      await userEvent.type(field('name'), 'x');
      assert.equal(name.value, 'Ada', flag);
      assert.equal(name.matches(':read-only'), true);
      name[flag] = false;
      await settle();
      assert.equal(prop('name', 'editable'), undefined, flag);
    }
    assert.equal(name.disabled, false);
    name.disabled = true;
    assert.equal(name.getAttribute('disabled'), '');
    assert.equal(name.matches(':disabled'), true);
  });

  it('cannot be typed into in a disabled fieldset, but for its legend, until it is enabled', async () => {
    const app = await render(Fenced, { providers: [provideWebCompat()] });
    await settle();
    const editable = (id: string) => prop(id, 'editable');
    assert.equal(editable('inside'), false);
    assert.equal(editable('legend'), undefined, 'the first legend is not disabled');
    assert.equal(editable('outside'), undefined);
    await userEvent.press(screen.getByTestId('button'));
    assert.equal(app.instance.pressed, 0, 'nor is a button in it pressed');
    app.instance.off.set(false);
    await settle();
    assert.equal(editable('inside'), undefined);
    await userEvent.press(screen.getByTestId('button'));
    assert.equal(app.instance.pressed, 1);
  });

  it('is fenced as it comes into a disabled fieldset, and free as it leaves it', async () => {
    const app = await render(Moved, { providers: [provideWebCompat()] });
    const document = app.instance.document;
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.setAttribute('testID', 'moved');
    wrap.appendChild(input);
    document.getElementById('set').appendChild(wrap);
    await settle();
    assert.equal(screen.getByTestId('moved').props['editable'], false);
    document.getElementById('free').appendChild(wrap);
    await settle();
    assert.equal(prop('moved', 'editable'), undefined);
    // In the first legend it is free, and fenced once another legend comes before that one.
    const set = document.getElementById('set');
    const legend = document.createElement('legend');
    legend.appendChild(wrap);
    set.appendChild(legend);
    await settle();
    assert.equal(prop('moved', 'editable'), undefined);
    set.insertBefore(document.createElement('legend'), legend);
    await settle();
    assert.equal(prop('moved', 'editable'), false);
  });

  it('says how tall the text of a textarea is, past the rows and height it is held to', async () => {
    // A field that grows with its text reads `scrollHeight` to know how tall to be.
    const { fabric, instance } = await render(Grow, { providers: [provideWebCompat()] });
    const area = instance.document.querySelector('textarea');
    area.style.height = '24px';
    await settle();
    const get = fabric.frames.get;
    // Native lays a field out as tall as its text only where nothing holds its height.
    fabric.frames.get = () => {
      const { height } = screen.getByTestId('area').props;
      return { x: 0, y: 0, width: 100, height: height === 'auto' ? 72 : 24 };
    };
    try {
      assert.equal(area.scrollHeight, 72);
      assert.equal(area.clientHeight, 24, 'and its own height is what it was');
      await settle();
      assert.equal(screen.getByTestId('area').props['height'], 24, 'and is held to it again');
      assert.equal(area.getAttribute('rows'), '1');
    } finally {
      fabric.frames.get = get;
    }
  });
});
