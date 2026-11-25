/**
 * Compose's date and time picker dialogs as Signal Forms fields on Android: shown while rendered,
 * removed by the app on a pick or a dismissal, and the pick written back as a `Date`.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';
import { registerExpoUiViews } from '@ng-native/expo';
import { compileFixture } from './compile.ts';

interface Dialogs {
  opensOn: WritableSignal<string | undefined>;
  range: WritableSignal<{ start: string } | undefined>;
  open: WritableSignal<'date' | 'time' | 'range' | null>;
  data: WritableSignal<{
    start: Date | null;
    end: Date | null;
    stay: { start: Date; end: Date } | null;
  }>;
  f: {
    start(): { touched(): boolean };
    end(): { touched(): boolean };
    stay(): { touched(): boolean };
  };
}

let mod: Record<string, unknown>;
before(async () => {
  registerPlatformComponents('android');
  registerExpoUiViews('android');
  mod = await compileFixture('fixtures/ui-picker-dialogs.ts');
});

afterEach(() => cleanup());

async function boot() {
  const rendered = await render(mod['UiPickerDialogs'] as Type<unknown>);
  return rendered.instance as Dialogs;
}

describe('a date picker dialog', () => {
  it('gives Compose its props, the field s date and range in milliseconds', async () => {
    await boot();
    const props = screen.getByTestId('date').props;
    assert.equal(props['initialDate'], Date.parse('2026-10-01T00:00:00.000Z'));
    assert.deepEqual(props['selectableDates'], {
      start: Date.parse('2026-01-01T00:00:00.000Z'),
      end: null,
    });
    assert.equal(props['variant'], 'input');
    assert.equal(props['confirmButtonLabel'], 'Set');
    assert.equal(props['dismissButtonLabel'], 'Back');
    assert.equal(props['showVariantToggle'], false);
    assert.equal(props['showTitle'], false);
    assert.equal(props['showHeadline'], false);
    assert.deepEqual(props['elementColors'], { selectedDayContainerColor: '#00ff00' });
    assert.notEqual(props['color'] ?? null, null, 'the colour reaches Compose');
  });

  it('opens on initialDate in place of the field s date, and on the field s once it is unset', async () => {
    const instance = await boot();
    instance.opensOn.set('2026-03-04T00:00:00.000Z');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      screen.getByTestId('date').props['initialDate'],
      Date.parse('2026-03-04T00:00:00.000Z'),
    );
    instance.opensOn.set(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      screen.getByTestId('date').props['initialDate'],
      Date.parse('2026-10-01T00:00:00.000Z'),
    );
  });

  it('lets Compose take any date again once the range is unset', async () => {
    const instance = await boot();
    instance.range.set(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(screen.getByTestId('date').props['selectableDates'], null);
  });

  it('writes the confirmed date into the form, and the app removes it', async () => {
    const instance = await boot();
    await fireEvent(screen.getByTestId('date'), 'dateSelected', {
      date: Date.parse('2026-12-24T00:00:00.000Z'),
    });
    assert.equal(instance.data().start?.toISOString(), '2026-12-24T00:00:00.000Z');
    assert.equal(instance.f.start().touched(), true);
    assert.equal(screen.queryByTestId('date'), null);
  });

  it('leaves the field alone when dismissed', async () => {
    const instance = await boot();
    await fireEvent(screen.getByTestId('date'), 'dismissRequest', {});
    assert.equal(instance.data().start?.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(instance.f.start().touched(), false);
    assert.equal(screen.queryByTestId('date'), null);
  });
});

describe('a time picker dialog', () => {
  it('opens on now with no time, in the clock it is given', async () => {
    const instance = await boot();
    instance.open.set('time');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const props = screen.getByTestId('time').props;
    assert.equal(props['initialDate'] ?? null, null);
    assert.equal(props['is24Hour'], false);
    assert.deepEqual(props['elementColors'], { clockDialColor: '#0000ff' });
    instance.opensOn.set('2026-03-04T07:15:00.000Z');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      screen.getByTestId('time').props['initialDate'],
      Date.parse('2026-03-04T07:15:00.000Z'),
    );
  });

  it('writes the confirmed time into the form', async () => {
    const instance = await boot();
    instance.open.set('time');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent(screen.getByTestId('time'), 'dateSelected', {
      date: Date.parse('2026-10-01T18:30:00.000Z'),
    });
    assert.equal(instance.data().end?.toISOString(), '2026-10-01T18:30:00.000Z');
    assert.equal(instance.f.end().touched(), true);
    assert.equal(screen.queryByTestId('time'), null);
    instance.open.set('time');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      screen.getByTestId('time').props['initialDate'],
      Date.parse('2026-10-01T18:30:00.000Z'),
    );
  });
});

describe('a date range picker dialog', () => {
  async function openRange() {
    const instance = await boot();
    instance.open.set('range');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return instance;
  }

  it('opens on the field s range, in milliseconds', async () => {
    await openRange();
    const props = screen.getByTestId('range').props;
    assert.equal(props['initialStartDate'], Date.parse('2026-12-20T00:00:00.000Z'));
    assert.equal(props['initialEndDate'], Date.parse('2026-12-27T00:00:00.000Z'));
    assert.equal(props['showTitle'], false);
    assert.deepEqual(props['selectableDates'], {
      start: Date.parse('2026-01-01T00:00:00.000Z'),
      end: null,
    });
  });

  it('writes the confirmed range into the form, and the app removes it', async () => {
    const instance = await openRange();
    await fireEvent(screen.getByTestId('range'), 'dateRangeSelected', {
      start: Date.parse('2027-01-02T00:00:00.000Z'),
      end: Date.parse('2027-01-09T00:00:00.000Z'),
    });
    const stay = instance.data().stay;
    assert.equal(stay?.start.toISOString(), '2027-01-02T00:00:00.000Z');
    assert.equal(stay?.end.toISOString(), '2027-01-09T00:00:00.000Z');
    assert.equal(instance.f.stay().touched(), true);
    assert.equal(screen.queryByTestId('range'), null);
  });

  it('takes no range with an end missing', async () => {
    const instance = await openRange();
    await fireEvent(screen.getByTestId('range'), 'dateRangeSelected', {
      start: Date.parse('2027-01-02T00:00:00.000Z'),
      end: null,
    });
    assert.equal(instance.data().stay?.start.toISOString(), '2026-12-20T00:00:00.000Z');
    assert.equal(instance.f.stay().touched(), false);
  });

  it('opens on nothing once the field is empty', async () => {
    const instance = await openRange();
    instance.data.set({ ...instance.data(), stay: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const props = screen.getByTestId('range').props;
    assert.equal(props['initialStartDate'], null);
    assert.equal(props['initialEndDate'], null);
  });
});
