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
    (): { arrival: Date; room: string };
    set(value: { arrival: Date; room: string }): void;
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
