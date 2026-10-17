/**
 * `Calendar`, over a fake of `expo-calendar` that records every call.
 *
 * The module's API is its object one: calendars, events and reminders are handles, reached through
 * a few functions and each class's `get`. What only iOS has - the default calendar, the picker,
 * the sources and the reminders - answers empty on Android without calling the module, which
 * would throw there.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  Availability,
  Calendar,
  EntityTypes,
  Frequency,
  type NativeCalendar,
} from '@ng-native/expo/calendar';
import type { ModulePlatform } from '@ng-native/expo';
import { servicesWith } from './injected.ts';

function platform(options: { granted?: boolean } = {}) {
  const { granted = true } = options;
  const calls: unknown[][] = [];
  const answer = { status: granted ? 'granted' : 'denied', granted, canAskAgain: true };
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]) => (calls.push([name, ...args]), result);

  class ExpoCalendar {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    static async get(id: string) {
      calls.push(['ExpoCalendar.get', id]);
      return new ExpoCalendar(id);
    }
  }
  class ExpoCalendarEvent {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    static async get(id: string) {
      calls.push(['ExpoCalendarEvent.get', id]);
      return new ExpoCalendarEvent(id);
    }
  }
  class ExpoCalendarReminder {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    static async get(id: string) {
      calls.push(['ExpoCalendarReminder.get', id]);
      return new ExpoCalendarReminder(id);
    }
  }
  const native = {
    getCalendarPermissions: record('getCalendarPermissions', answer),
    requestCalendarPermissions: record('requestCalendarPermissions', answer),
    getRemindersPermissions: record('getRemindersPermissions', answer),
    requestRemindersPermissions: record('requestRemindersPermissions', answer),
    getCalendars: record('getCalendars', [new ExpoCalendar('work')]),
    getDefaultCalendarSync: (...args: unknown[]) => (
      calls.push(['getDefaultCalendarSync', ...args]),
      new ExpoCalendar('default')
    ),
    createCalendar: record('createCalendar', new ExpoCalendar('new')),
    presentPicker: record('presentPicker', new ExpoCalendar('picked')),
    listEvents: record('listEvents', [new ExpoCalendarEvent('padel')]),
    getSourcesSync: (...args: unknown[]) => (
      calls.push(['getSourcesSync', ...args]),
      [{ id: 'icloud', name: 'iCloud', type: 'caldav' }]
    ),
    ExpoCalendar,
    ExpoCalendarEvent,
    ExpoCalendarReminder,
  };
  return { native: native as unknown as NativeCalendar, calls };
}

function calendarWith(native: NativeCalendar | null, on: ModulePlatform | null = 'ios'): Calendar {
  return servicesWith(
    [
      [Calendar.SOURCE, native],
      [Calendar.PLATFORM, on],
    ],
    () => new Calendar(),
  );
}

const names = (calls: unknown[][]) => calls.map(([name]) => name);

describe('Calendar', () => {
  it('asks for full access, and on iOS 17 for write-only access, with the module s own flag', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native);
    assert.equal(await calendar.permission.check(), true);
    assert.equal(await calendar.writePermission.request(), true);
    assert.deepEqual(calls, [
      ['getCalendarPermissions', false],
      ['requestCalendarPermissions', true],
    ]);
    assert.equal(calendar.permission.granted(), true);
  });

  it('reads the calendars of the kind asked for', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native);
    const found = await calendar.calendars(EntityTypes.REMINDER);
    assert.deepEqual(
      found.map((each) => each.id),
      ['work'],
    );
    assert.deepEqual(calls, [['getCalendars', 'reminder']]);
  });

  it('lists the events in a range of the calendars given, as handles or ids', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native);
    const [work] = await calendar.calendars();
    const start = new Date(2026, 9, 12);
    const end = new Date(2026, 9, 19);
    const events = await calendar.events([work!, 'home'], start, end);
    assert.deepEqual(
      events.map((event) => event.id),
      ['padel'],
    );
    assert.deepEqual(calls.at(-1), ['listEvents', [work, 'home'], start, end]);
  });

  it('asks the module nothing for the events of no calendars', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native);
    assert.deepEqual(await calendar.events([], new Date(), new Date()), []);
    assert.deepEqual(calls, []);
  });

  it('finds a calendar and an event by id, and makes a calendar', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native);
    assert.equal((await calendar.calendar('work'))?.id, 'work');
    assert.equal((await calendar.event('padel'))?.id, 'padel');
    assert.equal((await calendar.createCalendar({ title: 'Matches' }))?.id, 'new');
    assert.deepEqual(calls, [
      ['ExpoCalendar.get', 'work'],
      ['ExpoCalendarEvent.get', 'padel'],
      ['createCalendar', { title: 'Matches' }],
    ]);
  });

  it('reaches what only iOS has on iOS', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native, 'ios');
    assert.equal(calendar.defaultCalendar()?.id, 'default');
    assert.equal((await calendar.pickCalendar())?.id, 'picked');
    assert.equal((await calendar.reminder('milk'))?.id, 'milk');
    assert.deepEqual(
      calendar.sources().map((source) => source.id),
      ['icloud'],
    );
    assert.equal(await calendar.remindersPermission.request(), true);
    assert.deepEqual(names(calls), [
      'getDefaultCalendarSync',
      'presentPicker',
      'ExpoCalendarReminder.get',
      'getSourcesSync',
      'requestRemindersPermissions',
    ]);
  });

  it('answers empty on Android for what only iOS has, without calling the module that throws', async () => {
    const { native, calls } = platform();
    const calendar = calendarWith(native, 'android');
    assert.equal(calendar.defaultCalendar(), null);
    assert.equal(await calendar.pickCalendar(), null);
    assert.equal(await calendar.reminder('milk'), null);
    assert.deepEqual(calendar.sources(), []);
    assert.equal(await calendar.remindersPermission.request(), false);
    assert.equal(calendar.remindersPermission.blocked(), true, 'refused for good');
    assert.deepEqual(calls, []);
  });

  it('is refused and empty without the module', async () => {
    const calendar = calendarWith(null, null);
    assert.equal(await calendar.permission.ensure(), false);
    assert.equal(await calendar.writePermission.request(), false);
    assert.equal(await calendar.remindersPermission.request(), false);
    assert.deepEqual(await calendar.calendars(), []);
    assert.equal(await calendar.calendar('work'), null);
    assert.equal(calendar.defaultCalendar(), null);
    assert.equal(await calendar.createCalendar({ title: 'Matches' }), null);
    assert.equal(await calendar.pickCalendar(), null);
    assert.deepEqual(await calendar.events(['work'], new Date(), new Date()), []);
    assert.equal(await calendar.event('padel'), null);
    assert.equal(await calendar.reminder('milk'), null);
    assert.deepEqual(calendar.sources(), []);
  });
});

describe('entity types, frequencies and availabilities', () => {
  it('are the module s own enums, so an event can be written without loading the module', () => {
    // The enums live in a file Node cannot load, so its compiled lines are read as text.
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve('expo-calendar/package.json'));
    const source = readFileSync(path.join(root, 'build/legacy/Calendar.js'), 'utf8');
    const read = (name: string) =>
      Object.fromEntries(
        [...source.matchAll(new RegExp(`${name}\\["(\\w+)"\\] = "(\\w+)"`, 'g'))].map(
          ([, key, value]) => [key, value],
        ),
      );
    assert.ok(Object.keys(read('Frequency')).length > 0, 'found the enum');
    assert.deepEqual({ ...EntityTypes }, read('EntityTypes'));
    assert.deepEqual({ ...Frequency }, read('Frequency'));
    assert.deepEqual({ ...Availability }, read('Availability'));
  });
});
