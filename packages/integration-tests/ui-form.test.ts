/**
 * The `@expo/ui` pickers as Signal Forms fields. A form with a date and a choice in it is most
 * forms, and a control that needs its own event wiring and conversion is a control every app gets
 * slightly wrong: SwiftUI takes the date as ISO text and Compose as milliseconds, and they report a
 * change under different event names.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { registerExpoUiViews } from '@ng-native/expo';
import { compileFixture } from './compile.ts';

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

let mod: Record<string, unknown>;
before(async () => {
  registerExpoUiViews('ios');
  mod = await compileFixture('fixtures/ui-form.ts');
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

interface Form {
  data: {
    (): { arrival: Date; room: string; board: string };
    set(value: { arrival: Date; room: string; board: string }): void;
  };
  locked: { set(value: boolean): void };
}

async function boot() {
  const rendered = await render(mod['UiForm'] as Type<unknown>);
  return { ...rendered, instance: rendered.instance as Form };
}

describe('a date picker in a form', () => {
  it('shows the field s date, as SwiftUI takes it', async () => {
    await boot();
    assert.equal(screen.getByTestId('date').props['selection'], '2026-10-01T09:00:00.000Z');
  });

  it('writes the date the user picks into the form', async () => {
    const { instance } = await boot();
    await fireEvent(screen.getByTestId('date'), 'dateChange', { date: '2026-12-24T18:30:00.000Z' });
    assert.equal(instance.data().arrival.toISOString(), '2026-12-24T18:30:00.000Z');
    assert.equal(screen.getByTestId('date').props['selection'], '2026-12-24T18:30:00.000Z');
  });

  it('does not take the date SwiftUI reports as it appears for one the user chose', async () => {
    const { instance } = await boot();
    instance.data.set({ ...instance.data(), arrival: null as unknown as Date });
    await settle();
    // SwiftUI's picker always shows a date, and reports it the moment it appears.
    await fireEvent(screen.getByTestId('date'), 'dateChange', { date: Date.now() });
    assert.equal(instance.data().arrival, null, 'the field is still empty');
  });

  it('marks its field touched once the user picks, so the field s errors show', async () => {
    const { instance } = await boot();
    const f = (instance as unknown as { f: { arrival: () => { touched(): boolean } } }).f;
    assert.equal(f.arrival().touched(), false);
    await fireEvent(screen.getByTestId('date'), 'dateChange', { date: '2026-12-24T18:30:00.000Z' });
    assert.equal(f.arrival().touched(), true);
  });

  it('is disabled when the form says so', async () => {
    const { instance } = await boot();
    instance.locked.set(true);
    await settle();
    const modifiers = screen.getByTestId('date').props['modifiers'] as { $type: string }[];
    assert.deepEqual(
      modifiers.find((modifier) => modifier.$type === 'disabled'),
      { $type: 'disabled', disabled: true },
    );
  });

  it('reads numbers and switches written as static attributes', async () => {
    await render(mod['UiStatic'] as Type<unknown>);
    const props = (id: string) => screen.getByTestId(id).props;
    assert.equal(props('column')['spacing'], 8);
    assert.equal(props('row')['spacing'], 4);
    assert.deepEqual(
      ['value', 'min', 'max', 'step'].map((key) => props('slider')[key]),
      [2, 0, 10, 2],
    );
    assert.deepEqual(
      ['value', 'min', 'max', 'step'].map((key) => props('stepper')[key]),
      [1, 0, 9, 2],
    );
    assert.equal(props('progress')['value'], 0.5);
    assert.equal(props('toggle')['isOn'], true);
  });

  it('is disabled by a bare disabled attribute, outside a form', async () => {
    await render(mod['UiDisabled'] as Type<unknown>);
    for (const id of ['bare-date', 'bare-room']) {
      const modifiers = (screen.getByTestId(id).props['modifiers'] ?? []) as { $type: string }[];
      assert.ok(
        modifiers.some((modifier) => modifier.$type === 'disabled'),
        `${id} is disabled`,
      );
    }
  });

  it('speaks Compose s dialect on Android: milliseconds in, and its own event out', async () => {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    const { instance } = await boot();
    const date = screen.getByTestId('date');
    assert.equal(date.props['initialDate'], Date.parse('2026-10-01T09:00:00.000Z'));
    // One word for what it shows, where SwiftUI takes a list.
    assert.equal(date.props['displayedComponents'], 'dateAndTime');
    await fireEvent(date, 'dateSelected', { date: Date.parse('2027-01-02T00:00:00.000Z') });
    assert.equal(instance.data().arrival.toISOString(), '2027-01-02T00:00:00.000Z');
  });
});

describe('a picker in a form', () => {
  it('draws its options and selects the field s value', async () => {
    const { fabric } = await boot();
    const room = screen.getByTestId('room');
    assert.equal(room.props['selection'], 'double');
    assert.deepEqual(room.props['modifiers'], [{ $type: 'pickerStyle', style: 'menu' }]);
    const options = flatten([room]).filter((node) => typeof node.props['text'] === 'string');
    assert.deepEqual(
      options.map((node) => [node.props['text'], node.props['modifiers']]),
      [
        ['Single', [{ $type: 'tag', tag: 'single' }]],
        ['Double', [{ $type: 'tag', tag: 'double' }]],
        ['Suite', [{ $type: 'tag', tag: 'suite' }]],
      ],
    );
    void fabric;
  });

  it('marks its field touched once the user picks', async () => {
    const { instance } = await boot();
    const f = (instance as unknown as { f: { room: () => { touched(): boolean } } }).f;
    await fireEvent(screen.getByTestId('room'), 'selectionChange', { selection: 'suite' });
    assert.equal(f.room().touched(), true);
  });

  it('writes the option the user picks into the form', async () => {
    const { instance } = await boot();
    await fireEvent(screen.getByTestId('room'), 'selectionChange', { selection: 'suite' });
    assert.equal(instance.data().room, 'suite');
    assert.equal(screen.getByTestId('room').props['selection'], 'suite');
  });
});

describe('a SwiftUI host', () => {
  // The native host reads one flag per axis; `@expo/ui`'s React wrapper splits `matchContents`
  // into them. Passed through whole, it is a prop native ignores: the host keeps no size, and the
  // control drawn in it is outside it, where no touch or screen reader reaches.
  it('sizes itself to its content through the flags native reads', async () => {
    await render(mod['UiHosts'] as Type<unknown>);
    const both = screen.getByTestId('both').props;
    const tall = screen.getByTestId('tall').props;
    assert.equal(both['matchContents'], undefined);
    assert.equal(both['matchContentsVertical'], true);
    assert.equal(both['matchContentsHorizontal'], true);
    assert.equal(tall['matchContentsVertical'], true);
    assert.equal(tall['matchContentsHorizontal'], undefined);
  });
});

/**
 * SwiftUI's `Picker` has no Compose twin, so on Android a picker is drawn from Compose's own
 * controls: a segmented one as a row of segmented buttons, any other as an exposed dropdown menu
 * under the chosen option. The same template, the same field.
 */
describe('a picker on Android', () => {
  const inside = (id: string, view: string) =>
    flatten([screen.getByTestId(id)]).filter((node) => node.viewName.endsWith(`_${view}`));

  async function bootAndroid() {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    return boot();
  }

  it('draws a menu picker as a dropdown under the chosen option, and sets the field', async () => {
    const { instance } = await bootAndroid();
    const box = () => inside('room', 'ExposedDropdownMenuBoxView')[0]!;
    assert.ok(box(), 'an exposed dropdown menu box');
    const anchor = inside('room', 'TextView').find((node) =>
      ((node.props['modifiers'] ?? []) as { $type: string }[]).some(
        (modifier) => modifier.$type === 'menuAnchor',
      ),
    );
    assert.equal(anchor?.props['text'], 'Double \u25BE', 'the chosen option, as its anchor');
    const items = inside('room', 'DropdownMenuItemView');
    assert.equal(items.length, 3);

    await fireEvent(box(), 'expandedChange', { value: true });
    assert.equal(box().props['expanded'], true);
    await fireEvent(items[2]!, 'itemPressed', {});
    await settle();
    assert.equal(instance.data().room, 'suite');
    assert.equal(box().props['expanded'], false, 'and closes');
  });

  it('opens and closes the dropdown as the box and the menu ask, starting closed', async () => {
    await bootAndroid();
    const box = () => inside('room', 'ExposedDropdownMenuBoxView')[0]!;
    const menu = () => inside('room', 'ExposedDropdownMenuView')[0]!;
    assert.equal(box().props['expanded'], false);
    await fireEvent(box(), 'expandedChange', { value: true });
    assert.equal(menu().props['expanded'], true);
    await fireEvent(box(), 'expandedChange', { value: false });
    assert.equal(box().props['expanded'], false, 'closed from the box');
    await fireEvent(box(), 'expandedChange', { value: true });
    await fireEvent(menu(), 'dismissRequest', {});
    assert.equal(box().props['expanded'], false, 'and dismissed');
  });

  it('neither opens nor takes a pick while disabled', async () => {
    registerPlatformComponents('android');
    registerExpoUiViews('android');
    await render(mod['UiDisabled'] as Type<unknown>);
    const box = inside('bare-room', 'ExposedDropdownMenuBoxView')[0]!;
    const anchor = () => inside('bare-room', 'TextView')[0]!;
    const before = anchor().props['text'];
    await fireEvent(box, 'expandedChange', { value: true });
    assert.equal(box.props['expanded'], false);
    await fireEvent(inside('bare-room', 'DropdownMenuItemView')[0]!, 'itemPressed', {});
    await settle();
    assert.equal(anchor().props['text'], before, 'nothing chosen');
  });

  it('draws a segmented picker as segmented buttons, and sets the field', async () => {
    const { instance } = await bootAndroid();
    assert.equal(inside('board', 'SingleChoiceSegmentedButtonRowView').length, 1);
    const buttons = () => inside('board', 'SegmentedButtonView');
    assert.deepEqual(
      buttons().map((button) => button.props['selected']),
      [false, true],
    );
    await fireEvent(buttons()[0]!, 'buttonPressed', {});
    await settle();
    assert.equal(instance.data().board, 'none');
    assert.deepEqual(
      buttons().map((button) => button.props['selected']),
      [true, false],
    );
  });

  it("leaves out SwiftUI's own props and views", async () => {
    await bootAndroid();
    const room = screen.getByTestId('room');
    assert.equal(room.props['selection'], undefined);
    assert.equal(inside('room', 'PickerView').length, 0);
    assert.equal(
      flatten([room]).some(
        (node) => node.viewName === 'SlotView' && node.props['slotName'] === 'content',
      ),
      false,
      "SwiftUI's content slot, which Compose refuses outside a host",
    );
  });
});
