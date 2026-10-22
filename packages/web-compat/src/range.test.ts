/**
 * `<input type="range">`: a value kept between its `min` and `max` on its `step`, by HTML's rules,
 * read as a number and stepped, moved under a finger dragged across it, with `input` while it
 * moves and `change` when the finger lifts. What Material's slider is built on.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  template: `
    <div testID="around" (input)="bubbled.push('input')" (change)="bubbled.push('change')">
      <input
        id="slider"
        testID="slider"
        type="range"
        min="0"
        [max]="max()"
        [value]="value()"
        (input)="heard.push('input ' + $any($event.target).value)"
        (change)="heard.push('change ' + $any($event.target).value)"
      />
    </div>
    <form id="form"><input id="kept" type="range" value="30" /></form>
  `,
})
class Sliders {
  readonly document: Dom = inject(DOCUMENT);
  readonly max = signal(10);
  readonly value = signal(4);
  readonly heard: string[] = [];
  readonly bubbled: string[] = [];
}

@Component({
  template: `<input testID="plain" type="range" value="7" (input)="heard.push('input')" />`,
})
class Plain {
  readonly heard: string[] = [];
}

afterEach(cleanup);

const page = async () => {
  const app = await render(Sliders, { providers: [provideWebCompat()] });
  await settle();
  const document: Dom = app.instance.document;
  /** A range input made by a script, in the page, with these attributes. */
  const make = (attributes: Record<string, string> = {}): Dom => {
    const range = document.createElement('input');
    range.type = 'range';
    for (const [name, value] of Object.entries(attributes)) range.setAttribute(name, value);
    document.body.appendChild(range);
    return range;
  };
  return { app, document, make, slider: document.getElementById('slider') as Dom };
};

/** A finger at a place across the screen, down or lifted. */
const finger = (pageX: number, down = true) => {
  const point = { identifier: 0, pageX, pageY: 5, locationX: 0, locationY: 0 };
  return { ...point, touches: down ? [point] : [], changedTouches: [point] };
};

/** The view a range input is drawn as. */
const viewOf = (range: Dom): FakeFabricNode =>
  screen
    .getAllByTestId(range.props['testID'])
    .find((view) => view.reactTag === range.committed.tag)!;

/** A finger put down on a view at one place, moved through the others, and lifted at the last. */
async function drag(view: FakeFabricNode, ...at: number[]): Promise<void> {
  await fireEvent(view, 'touchStart', finger(at[0]!));
  for (const x of at.slice(1)) await fireEvent(view, 'touchMove', finger(x));
  await fireEvent(view, 'touchEnd', finger(at.at(-1)!, false));
  await settle();
}

describe('a range input', () => {
  it('is a plain view, and no text field', async () => {
    await page();
    const view = screen.getByTestId('slider');
    assert.equal(view.viewName, 'View');
    assert.equal(view.props['underlineColorAndroid'], undefined);
    assert.equal(view.props['editable'], undefined);
  });

  it('is in the middle of 0 to 100 with nothing written, and moves by 1', async () => {
    const { make } = await page();
    const range = make();
    assert.equal(range.value, '50');
    assert.equal(range.valueAsNumber, 50);
    range.value = '12.4';
    assert.equal(range.value, '12');
    range.value = 'twelve';
    assert.equal(range.value, '50', 'what is no number is the middle');
    range.value = '';
    assert.equal(range.value, '50');
  });

  it('keeps a value between its bounds, on a step counted from the least', async () => {
    const { make } = await page();
    const range = make({ min: '0', max: '10', step: '2' });
    assert.equal(range.value, '6', 'the middle, 5, on a step: halfway goes up');
    range.value = '7';
    assert.equal(range.value, '8');
    range.value = '40';
    assert.equal(range.value, '10');
    range.value = '-3';
    assert.equal(range.value, '0');
    // The steps are counted from the least: 1, 4, 7, 10.
    const from = make({ min: '1', max: '10', step: '3' });
    from.value = '5';
    assert.equal(from.value, '4');
    // A step that does not reach the most stops at the last one under it.
    const short = make({ min: '0', max: '10', step: '4' });
    short.value = '10';
    assert.equal(short.value, '8');
  });

  it('takes any value between its bounds with step="any", and a least over its most as both', async () => {
    const { make } = await page();
    const any = make({ min: '0', max: '1', step: 'any' });
    any.value = '0.3333';
    assert.equal(any.value, '0.3333');
    const backwards = make({ min: '10', max: '5' });
    assert.equal(backwards.value, '10');
    backwards.value = '7';
    assert.equal(backwards.value, '10');
    // A step that is no number, or not above nothing, is the step of 1.
    const zero = make({ step: '0' });
    zero.value = '3.6';
    assert.equal(zero.value, '4');
  });

  it('writes a value on a step of a tenth as a tenth, with no sum a hair off', async () => {
    const { make } = await page();
    const range = make({ min: '0', max: '1', step: '0.1' });
    range.value = '0.35';
    assert.equal(range.value, '0.4');
    range.value = '0.2';
    range.stepUp();
    assert.equal(range.value, '0.3');
    range.stepUp(4);
    assert.equal(range.value, '0.7');
  });

  it('reads its value attribute until a value is set, and a reset puts that back', async () => {
    const { document } = await page();
    const kept = document.getElementById('kept');
    assert.equal(kept.value, '30');
    kept.value = 70;
    assert.equal(kept.value, '70');
    assert.equal(kept.getAttribute('value'), '30');
    document.getElementById('form').reset();
    assert.equal(kept.value, '30');
  });

  it('is kept within its bounds again as they change, and as they are taken away', async () => {
    const { make } = await page();
    // A value written as the attribute is read through the bounds as they are now.
    const written = make({ value: '80' });
    written.max = '50';
    assert.equal(written.value, '50');
    written.removeAttribute('max');
    assert.equal(written.value, '80');
    // One set is moved as the bounds move, and stays where it was moved to, as Chrome has it.
    const set = make();
    set.value = '80';
    set.max = '50';
    assert.equal(set.value, '50');
    set.max = '100';
    assert.equal(set.value, '50');
    set.min = '60';
    assert.equal(set.value, '60');
    set.removeAttribute('min');
    set.step = '25';
    assert.equal(set.value, '50');
    set.step = '40';
    assert.equal(set.value, '40');
    set.removeAttribute('step');
    assert.equal(set.value, '40');
  });

  it('is read and set as a number', async () => {
    const { make } = await page();
    const range = make({ min: '0', max: '10' });
    range.valueAsNumber = 3;
    assert.deepEqual([range.value, range.valueAsNumber], ['3', 3]);
    range.valueAsNumber = 30;
    assert.equal(range.value, '10');
    range.valueAsNumber = Number.NaN;
    assert.equal(range.value, '5', 'nothing, which is the middle');
    assert.throws(() => (range.valueAsNumber = Infinity), TypeError);
  });

  it('steps up and down by its step, no further than its bounds', async () => {
    const { make } = await page();
    const range = make({ min: '0', max: '10', step: '2' });
    range.value = '4';
    range.stepUp();
    assert.equal(range.value, '6');
    range.stepDown(2);
    assert.equal(range.value, '2');
    range.stepUp(100);
    assert.equal(range.value, '10');
    range.stepDown(-1);
    assert.equal(range.value, '10', 'a step down by less than none is one up, and there is none');
    range.stepDown(100);
    assert.equal(range.value, '0');
    const any = make({ step: 'any' });
    assert.throws(() => any.stepUp(), { name: 'InvalidStateError' });
  });

  it('is told of the value bound to it, and of its bounds', async () => {
    const { app, slider } = await page();
    assert.equal(slider.value, '4');
    app.instance.value.set(9);
    await settle();
    assert.equal(slider.value, '9');
    app.instance.max.set(6);
    await settle();
    assert.equal(slider.value, '6');
    // A value bound after the finger moved it is the value again.
    slider.value = '2';
    app.instance.value.set(5);
    await settle();
    assert.equal(slider.value, '5');
  });

  it('moves under a finger: input as it moves, and change when it lifts', async () => {
    const { app, slider } = await page();
    app.fabric.frames.set('View', { x: 0, y: 0, width: 100, height: 20 });
    const view = screen.getByTestId('slider');
    // 0 to 10 across a hundred: 42 is 4.2, which is 4, where the value is already.
    await drag(view, 42, 44, 79);
    assert.deepEqual(app.instance.heard, ['input 8', 'change 8']);
    assert.deepEqual(app.instance.bubbled, ['input', 'change'], 'and they bubble');
    assert.equal(slider.value, '8');
    // Past the end is the most, and a finger that comes back to where it began changes nothing.
    app.instance.heard.length = 0;
    await drag(view, 81, 400, 81);
    assert.deepEqual(app.instance.heard, ['input 10', 'input 8']);
  });

  it('moves across its content box, inside its padding, as a browser has it', async () => {
    // Material's slider pads the input it lays over its track: the value runs between the
    // padding, not across the whole box.
    const { app, slider } = await page();
    app.fabric.frames.set('View', { x: 0, y: 0, width: 140, height: 20 });
    slider.style.padding = '0 20px';
    await settle();
    const view = screen.getByTestId('slider');
    await drag(view, 70, 20);
    assert.equal(slider.value, '0', 'the start of the content box');
    await drag(view, 20, 120);
    assert.equal(slider.value, '10', 'its end');
    await drag(view, 120, 70);
    assert.equal(slider.value, '5', 'its middle');
  });

  it('moves under a finger with no listener, and is told to a listener added later', async () => {
    const { app, make } = await page();
    app.fabric.frames.set('View', { x: 0, y: 0, width: 100, height: 20 });
    const range = make({ testID: 'made' });
    await settle();
    await drag(viewOf(range), 20, 30);
    assert.equal(range.value, '30');
    const heard: string[] = [];
    const listener = (event: Dom) => heard.push(`${event.type} ${event.target.value}`);
    range.addEventListener('input', listener);
    range.addEventListener('change', listener);
    await drag(viewOf(range), 30, 60);
    assert.deepEqual(heard, ['input 60', 'change 60']);
    range.removeEventListener('input', listener);
    range.removeEventListener('change', listener);
    await drag(viewOf(range), 60, 10);
    assert.equal(range.value, '10');
    assert.equal(heard.length, 2);
  });

  it('keeps its value under a finger while it is disabled', async () => {
    const { app, slider } = await page();
    app.fabric.frames.set('View', { x: 0, y: 0, width: 100, height: 20 });
    slider.disabled = true;
    await settle();
    await drag(screen.getByTestId('slider'), 10, 90);
    assert.equal(slider.value, '4');
    assert.deepEqual(app.instance.heard, []);
    slider.disabled = false;
    await settle();
    await drag(screen.getByTestId('slider'), 10, 90);
    assert.equal(slider.value, '9');
  });

  it('is a range no longer once its type is another', async () => {
    const { app, make } = await page();
    app.fabric.frames.set('View', { x: 0, y: 0, width: 100, height: 20 });
    const range = make({ testID: 'made', min: '0', max: '10' });
    range.type = 'checkbox';
    range.value = '40';
    assert.equal(range.value, '40', 'not kept within the bounds');
    assert.throws(() => range.stepUp(), { name: 'InvalidStateError' });
    assert.equal(Number.isNaN(range.valueAsNumber), true);
    range.type = 'range';
    assert.equal(range.value, '10');
    await settle();
    await drag(viewOf(range), 20);
    assert.equal(range.value, '2');
    range.type = 'text';
    await settle();
    assert.match(viewOf(range).viewName, /TextInput$/);
  });

  it('leaves a number input stepped by its own rules, and a text field with no number', async () => {
    const { document } = await page();
    const number = document.createElement('input');
    number.type = 'number';
    assert.equal(Number.isNaN(number.valueAsNumber), true);
    number.stepUp();
    assert.equal(number.value, '1', 'from nothing, which is 0');
    number.setAttribute('step', '2');
    number.value = '3';
    number.stepUp();
    assert.equal(number.value, '4', 'to the next step above, off a step');
    number.value = '3';
    number.stepDown();
    assert.equal(number.value, '2');
    number.valueAsNumber = 7.5;
    assert.equal(number.value, '7.5', 'a number input keeps what is set');
    const text = document.createElement('input');
    assert.equal(Number.isNaN(text.valueAsNumber), true);
    assert.throws(() => (text.valueAsNumber = 1), { name: 'InvalidStateError' });
    assert.throws(() => text.stepDown(), { name: 'InvalidStateError' });
  });

  it('is left as it is written in an app that did not ask, beside one that did', async () => {
    await page();
    const plain = await render(Plain);
    plain.fabric.frames.set('View', { x: 0, y: 0, width: 100, height: 20 });
    const view = screen.getByTestId('plain');
    await drag(view, 10, 90);
    assert.deepEqual(plain.instance.heard, []);
    assert.equal(view.props['value'], '7');
  });
});
