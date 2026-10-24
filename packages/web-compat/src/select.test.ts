/**
 * `<select>` and its `<option>`s: the option chosen is the one shown, a press opens a list of
 * them, and a script reads and sets which it is.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-sizes',
  template: `
    <label testID="label" for="size">Size</label>
    <select
      testID="size"
      id="size"
      [value]="size()"
      [style.color]="color()"
      (input)="heard.push('input')"
      (change)="heard.push('change:' + $any($event.target).value)"
    >
      <option value="s">Small</option>
      <optgroup label="Big">
        <option value="m">Medium</option>
        <option value="l" [disabled]="true">Large</option>
      </optgroup>
    </select>
  `,
})
class Sizes {
  readonly document: Dom = inject(DOCUMENT);
  readonly size = signal('m');
  readonly color = signal('rgb(20, 20, 20)');
  readonly heard: string[] = [];
}

@Component({
  selector: 'x-plans',
  template: `
    <select
      testID="plan"
      id="plan"
      (change)="heard.push('change:' + $any($event.target).selectedIndex)"
    >
      <optgroup label="Retired" disabled>
        <option value="old">Old</option>
      </optgroup>
      <option value="">Pick one</option>
      <option value="pro">Pro, monthly</option>
      <option value="pro">Pro, yearly</option>
    </select>
  `,
})
class Plans {
  readonly document: Dom = inject(DOCUMENT);
  readonly heard: string[] = [];
}

afterEach(cleanup);

const plans = async () => {
  const app = await render(Plans, { providers: [provideWebCompat()] });
  await settle();
  const document = app.instance.document;
  return { instance: app.instance, select: document.getElementById('plan') };
};

const sizes = async () => {
  const app = await render(Sizes, { providers: [provideWebCompat()] });
  await settle();
  const document = app.instance.document;
  return { instance: app.instance, document, select: document.getElementById('size') };
};

/** Which option of a select is drawn: the others are `display: none`. */
const shown = (select: Dom): string[] =>
  [...select.options]
    .filter((option: Dom) => option.defaultStyle?.display !== 'none')
    .map((option: Dom) => option.value);

describe('a select', () => {
  it('shows the option of its value and none of the others, and follows the value', async () => {
    const { instance, select } = await sizes();
    assert.deepEqual(shown(select), ['m']);
    assert.deepEqual([select.value, select.selectedIndex, select.type], ['m', 1, 'select-one']);
    instance.size.set('s');
    await settle();
    assert.deepEqual(shown(select), ['s']);
    select.selectedIndex = 1;
    assert.deepEqual([select.value, shown(select)], ['m', ['m']]);
    assert.equal(select.options[1].selected, true);
    assert.equal(select.options[0].selected, false);
    select.options[0].selected = true;
    assert.equal(select.value, 's');
  });

  it("answers its options by place, and their value, label and index as a browser's", async () => {
    const { select } = await sizes();
    assert.equal(select.length, 3);
    assert.equal(select.options.length, 3);
    assert.equal(select.item(2).label, 'Large');
    assert.deepEqual(
      [...select.options].map((option: Dom) => [option.value, option.text, option.index]),
      [
        ['s', 'Small', 0],
        ['m', 'Medium', 1],
        ['l', 'Large', 2],
      ],
    );
    assert.deepEqual(select.selectedOptions, [select.options[1]]);
    assert.equal(select.options[1].form, null);
  });

  it('opens a list of its options when pressed, and takes the one that is pressed', async () => {
    const { instance, select } = await sizes();
    await userEvent.press(screen.getByTestId('size'));
    assert.notEqual(screen.queryByTestId('option-s'), null);
    await userEvent.press(screen.getByTestId('option-s'));
    assert.equal(select.value, 's');
    assert.deepEqual(instance.heard, ['input', 'change:s']);
    assert.equal(screen.queryByTestId('option-s'), null, 'and closes');
  });

  it('chooses nothing for a disabled option', async () => {
    const { select } = await sizes();
    await userEvent.press(screen.getByTestId('size'));
    await userEvent.press(screen.getByTestId('option-l'));
    assert.equal(select.value, 'm');
  });

  it('says nothing when the option it shows is pressed again, and closes', async () => {
    const { instance, select } = await sizes();
    await userEvent.press(screen.getByTestId('size'));
    await userEvent.press(screen.getByTestId('option-m'));
    assert.equal(select.value, 'm');
    assert.deepEqual(instance.heard, [], 'nothing changed, as a browser says nothing then');
    assert.equal(screen.queryByTestId('option-m'), null);
  });

  it('chooses nothing in a disabled group, and does not show one of its options first', async () => {
    const { instance, select } = await plans();
    assert.equal(select.selectedIndex, 1, 'the first option that can be chosen');
    await userEvent.press(screen.getByTestId('plan'));
    await userEvent.press(screen.getByTestId('option-old'));
    assert.deepEqual([select.selectedIndex, instance.heard], [1, []]);
  });

  it('tells two options of one value apart, set by place, pressed or selected', async () => {
    const { instance, select } = await plans();
    select.selectedIndex = 3;
    assert.deepEqual([select.selectedIndex, select.value], [3, 'pro']);
    assert.deepEqual(shown(select), ['pro']);
    assert.equal(select.options[3].selected, true);
    assert.equal(select.options[2].selected, false);
    // The other option of the value changing its own leaves the one chosen as it is.
    select.options[2].value = 'basic';
    assert.deepEqual([select.selectedIndex, select.value], [3, 'pro']);
    select.options[2].value = 'pro';
    select.options[2].selected = true;
    assert.equal(select.selectedIndex, 2);
    await userEvent.press(screen.getByTestId('plan'));
    await userEvent.press(screen.getAllByTestId('option-pro')[1]!);
    assert.deepEqual([select.selectedIndex, instance.heard], [3, ['change:3']]);
    // A value set by a script is the first option of it, as a browser has it.
    select.value = 'pro';
    assert.equal(select.selectedIndex, 2);
  });

  it('chooses again once the option chosen of two of one value is taken out', async () => {
    const { select } = await plans();
    select.selectedIndex = 3;
    select.options[3].remove();
    assert.deepEqual([select.selectedIndex, select.value], [1, ''], 'not the other of its value');
  });

  it('chooses again once the option chosen is taken out of a group put in whole', async () => {
    const { select } = await plans();
    const document = select.ownerDocument;
    const group = document.createElement('optgroup');
    for (const text of ['Team, monthly', 'Team, yearly']) {
      group.appendChild(Object.assign(document.createElement('option'), { value: 'team', text }));
    }
    select.appendChild(group);
    select.selectedIndex = 5;
    group.lastChild.remove();
    assert.deepEqual([select.selectedIndex, select.value], [1, '']);
    assert.deepEqual(shown(select), ['']);
  });

  it('closes its list on a press outside it, choosing nothing', async () => {
    const { instance, select } = await sizes();
    await userEvent.press(screen.getByTestId('size'));
    // The layer the list is on is everything outside it.
    await userEvent.press(screen.getByTestId('option-s').parent!.parent!);
    await settle();
    assert.equal(screen.queryByTestId('option-s'), null);
    assert.deepEqual([select.value, instance.heard], ['m', []]);
  });

  it('opens its list under itself, where the page it is put in starts below a header', async () => {
    const app = await render(Sizes, { providers: [provideWebCompat()] });
    await settle();
    const document = app.instance.document;
    // The page starts 100 points down the window, under a header; the select is 300 down.
    document.body.setAttribute('nativeID', 'body');
    document.getElementById('size').setAttribute('nativeID', 'size-view');
    app.fabric.frames.set('body', { x: 0, y: 100, width: 400, height: 700 });
    app.fabric.frames.set('size-view', { x: 20, y: 300, width: 120, height: 36 });
    await settle();
    await userEvent.press(screen.getByTestId('size'));
    await settle();
    const list = screen.getByTestId('option-s').parent!;
    assert.deepEqual(
      [list.props['top'], list.props['left'], list.props['minWidth']],
      [240, 20, 120],
    );
  });

  it('draws its list light under dark text, and dark under light text', async () => {
    const { instance } = await sizes();
    const panel = () => screen.getByTestId('option-s').parent!.props['backgroundColor'];
    await userEvent.press(screen.getByTestId('size'));
    await settle();
    assert.equal(panel(), '#ffffff');
    await userEvent.press(screen.getByTestId('option-m'));
    instance.color.set('rgb(250, 250, 250)');
    await settle();
    await userEvent.press(screen.getByTestId('size'));
    await settle();
    assert.equal(panel(), '#262626');
  });

  it('shows its option on the middle of its line, with no background of its own', async () => {
    const { select } = await sizes();
    assert.equal(screen.getByTestId('size').props['justifyContent'], 'center');
    // The option shown, as it is committed.
    assert.equal(select.options[1].committed?.props['backgroundColor'], 'transparent');
  });

  it('opens its list with nothing reported: its options are text of its own making', async () => {
    const said: string[] = [];
    const { error } = console;
    console.error = (...all: unknown[]) => void said.push(all.map(String).join(' '));
    try {
      await sizes();
      await userEvent.press(screen.getByTestId('size'));
      await settle();
    } finally {
      console.error = error;
    }
    assert.deepEqual(said, []);
  });

  it('opens no list while it is disabled', async () => {
    const { select } = await sizes();
    select.disabled = true;
    await settle();
    await userEvent.press(screen.getByTestId('size'));
    await userEvent.press(screen.getByTestId('label'));
    assert.equal(screen.queryByTestId('option-s'), null);
  });

  it('opens from its label, as a press on it does', async () => {
    await sizes();
    await userEvent.press(screen.getByTestId('label'));
    assert.notEqual(screen.queryByTestId('option-m'), null);
  });

  it('shows the option selected to begin with, and the next once the one shown is taken out', async () => {
    const { document } = await sizes();
    const select = document.createElement('select');
    for (const [value, selected] of [
      ['a', false],
      ['b', true],
      ['c', false],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      if (selected) option.setAttribute('selected', '');
      select.appendChild(option);
    }
    document.body.appendChild(select);
    assert.equal(select.value, 'b');
    assert.deepEqual(shown(select), ['b']);
    assert.equal(select.options[1].defaultSelected, true);
    assert.equal(select.options[1].matches(':default'), true);
    select.options[1].remove();
    assert.equal(select.value, 'a');
    assert.deepEqual(shown(select), ['a']);
    // An option's value changed is what is shown for it.
    select.options[0].value = 'z';
    assert.equal(select.value, 'z');
    select.options[1].setAttribute('selected', '');
    assert.deepEqual(shown(select), ['c']);
  });

  it('adds an option where a script says, and takes one out by its place', async () => {
    const { document } = await sizes();
    const select = document.createElement('select');
    const option = (text: string) =>
      Object.assign(document.createElement('option'), { textContent: text });
    const [first, third] = [option('1m'), option('All')];
    select.add(first);
    select.add(third);
    select.add(option('3m'), 1);
    select.add(option('YTD'), third);
    assert.deepEqual(
      [...select.options].map((each: Dom) => each.textContent),
      ['1m', '3m', 'YTD', 'All'],
    );
    select.options.remove(0);
    assert.deepEqual([select.length, select.value], [3, '3m']);
  });

  it('shows no option for a selectedIndex of -1 or a value none has, until its options change', async () => {
    const { document, select } = await sizes();
    select.selectedIndex = -1;
    assert.deepEqual([select.value, select.selectedIndex, shown(select)], ['', -1, []]);
    assert.deepEqual(select.selectedOptions, []);
    select.selectedIndex = 7;
    assert.deepEqual([select.value, select.selectedIndex], ['', -1], 'past the last is none too');
    // An option coming in chooses again, as a browser does for a select with none chosen.
    select.appendChild(Object.assign(document.createElement('option'), { value: 'xl' }));
    assert.deepEqual([select.value, shown(select)], ['s', ['s']]);
    // A value no option has, as forms writes for a null model: none is shown, not the first.
    select.value = 'null';
    assert.deepEqual([select.value, select.selectedIndex, shown(select)], ['', -1, []]);
    // An option of that value coming in later is the one shown.
    select.appendChild(Object.assign(document.createElement('option'), { value: 'null' }));
    assert.deepEqual([select.value, select.selectedIndex], ['null', 4]);
    // Taken out again: a value no option has now chooses again, as removing the chosen one does.
    select.options[4].remove();
    assert.deepEqual([select.value, shown(select)], ['s', ['s']]);
  });

  it('keeps the option chosen by its value when that value changes', async () => {
    const { select } = await sizes();
    select.value = 'm';
    select.options[1].value = 'medium';
    assert.deepEqual([select.value, shown(select)], ['medium', ['medium']]);
  });

  it('shows what it has left when an option moves to another select', async () => {
    const { document, select } = await sizes();
    const other = document.createElement('select');
    document.body.appendChild(other);
    other.appendChild(select.options[1]);
    assert.deepEqual(shown(select), ['s']);
    assert.deepEqual(shown(other), ['m']);
  });
});
