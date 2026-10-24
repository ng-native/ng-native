/**
 * `<calendar-month>` and `<calendar-day>`, and the date
 * arithmetic they are drawn from.
 *
 * The month is a whole number of weeks from the week start, with a dot for each colour on a day;
 * a press selects a day and the arrows move the grid without changing the selection. The day puts
 * each timed entry at its time, overlapping entries side by side, all-day ones above, and reports
 * a press on an entry or on an empty stretch, as the minute under the finger.
 */
import assert from 'node:assert/strict';
import { Component, signal } from '@angular/core';
import { cleanup, fireEvent, render, type FakeFabricNode } from '@ng-native/testing';
import { afterAll, describe, it, vi } from 'vitest';
import {
  CalendarDay,
  CalendarMonth,
  addDays,
  addMonths,
  colorsByDay,
  dayEntries,
  allDayEntries,
  isOn,
  minuteAt,
  monthGrid,
  type CalendarEntry,
  type CalendarSlotPress,
} from './calendar-views.ts';

const at = (day: string, hour: number, minute = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, hour, minute);
};
const entry = (
  id: string,
  day: string,
  from: [number, number],
  to: [number, number],
  extra: Partial<CalendarEntry> = {},
): CalendarEntry => ({
  id,
  title: id,
  start: at(day, ...from),
  end: at(day, ...to),
  ...extra,
});

describe('the month grid', () => {
  it('is whole weeks from Monday, from the week the 1st is in to the week the last day is in', () => {
    // 1 October 2026 is a Thursday, and the 31st a Saturday.
    const weeks = monthGrid('2026-10-14', 1);
    assert.equal(weeks.length, 5);
    assert.ok(weeks.every((week) => week.length === 7));
    assert.equal(weeks[0]![0], '2026-09-28');
    assert.equal(weeks.at(-1)!.at(-1), '2026-11-01');
  });

  it('starts on Sunday when asked to', () => {
    const weeks = monthGrid('2026-10-14', 0);
    assert.equal(weeks[0]![0], '2026-09-27');
    assert.equal(weeks.at(-1)!.at(-1), '2026-10-31');
  });

  it('has no spare week for a month that fills its rows exactly', () => {
    // February 2027 starts on a Monday and has 28 days.
    const weeks = monthGrid('2027-02-10', 1);
    assert.equal(weeks.length, 4);
    assert.deepEqual([weeks[0]![0], weeks[3]![6]], ['2027-02-01', '2027-02-28']);
  });

  it('steps across the ends of months and years', () => {
    assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
});

describe('the entries on a day', () => {
  it('sets overlapping entries side by side, as wide as the most that overlap at once', () => {
    const placed = dayEntries(
      [
        entry('a', '2026-10-14', [9, 0], [10, 0]),
        entry('b', '2026-10-14', [9, 30], [11, 0]),
        entry('c', '2026-10-14', [10, 0], [10, 30]),
        entry('d', '2026-10-14', [12, 0], [13, 0]),
        entry('elsewhere', '2026-10-15', [9, 0], [10, 0]),
      ],
      '2026-10-14',
    );
    const by = Object.fromEntries(placed.map((each) => [each.entry.id, each]));
    assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(
      [by['a']!.lane, by['b']!.lane, by['c']!.lane],
      [0, 1, 0],
      'c takes a s column',
    );
    assert.deepEqual([by['a']!.lanes, by['b']!.lanes, by['c']!.lanes], [2, 2, 2]);
    assert.deepEqual([by['d']!.lane, by['d']!.lanes], [0, 1], 'alone again');
    assert.deepEqual([by['b']!.from, by['b']!.to], [9 * 60 + 30, 11 * 60]);
  });

  it('cuts an entry that crosses midnight to each day it is on', () => {
    const late: CalendarEntry = {
      id: 'late',
      title: 'Late',
      start: at('2026-10-14', 23),
      end: at('2026-10-15', 1),
    };
    const [first] = dayEntries([late], '2026-10-14');
    const [second] = dayEntries([late], '2026-10-15');
    assert.deepEqual([first!.from, first!.to], [23 * 60, 24 * 60]);
    assert.deepEqual([second!.from, second!.to], [0, 60]);
  });

  it('leaves an entry ending at midnight off the next day', () => {
    const evening = entry('evening', '2026-10-14', [22, 0], [22, 0]);
    const toMidnight = { ...evening, end: at('2026-10-15', 0) };
    assert.equal(isOn(toMidnight, '2026-10-14'), true);
    assert.equal(isOn(toMidnight, '2026-10-15'), false);
  });

  it('places entries by the clock on a day the clocks change, as the hours are labelled', () => {
    const zone = process.env['TZ'];
    process.env['TZ'] = 'Europe/London';
    try {
      // The clocks go forward at 01:00 on 29 March 2026 and back at 02:00 on 25 October.
      const [spring] = dayEntries([entry('spring', '2026-03-29', [10, 0], [11, 0])], '2026-03-29');
      assert.deepEqual([spring!.from, spring!.to], [10 * 60, 11 * 60], 'not an hour early');
      const [autumn] = dayEntries(
        [entry('autumn', '2026-10-25', [23, 30], [23, 45])],
        '2026-10-25',
      );
      assert.deepEqual(
        [autumn!.from, autumn!.to],
        [23 * 60 + 30, 23 * 60 + 45],
        'not cut at 24:00',
      );
    } finally {
      if (zone === undefined) delete process.env['TZ'];
      else process.env['TZ'] = zone;
    }
  });

  it('keeps all-day entries apart from the timed ones, on every day they cover', () => {
    const trip: CalendarEntry = {
      id: 'trip',
      title: 'Trip',
      start: at('2026-10-14', 0),
      end: at('2026-10-16', 0),
      allDay: true,
    };
    assert.deepEqual(dayEntries([trip], '2026-10-14'), []);
    assert.deepEqual(
      ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(
        (day) => allDayEntries([trip], day).length,
      ),
      [0, 1, 1, 0],
    );
  });

  it('marks each day once per colour, with the default for an entry without one', () => {
    const marks = colorsByDay(
      [
        entry('a', '2026-10-14', [9, 0], [10, 0], { color: 'red' }),
        entry('b', '2026-10-14', [11, 0], [12, 0], { color: 'red' }),
        entry('c', '2026-10-14', [13, 0], [14, 0]),
      ],
      ['2026-10-13', '2026-10-14'],
      'blue',
    );
    assert.deepEqual([...marks], [['2026-10-14', ['red', 'blue']]]);
  });

  it('finds the minute under a finger, snapped to the quarter hour and kept to the hours shown', () => {
    assert.equal(minuteAt(0, 7, 22, 60), 7 * 60);
    assert.equal(minuteAt(95, 7, 22, 60), 8 * 60 + 30, '1h35 down rounds down to 8:30');
    assert.equal(minuteAt(-40, 7, 22, 60), 7 * 60);
    assert.equal(minuteAt(10_000, 7, 22, 60), 22 * 60 - 15, 'room for a quarter hour');
  });
});

/** A month to pick a day from, and that day's timeline below it, as an app puts them together. */
@Component({
  selector: 'x-calendar-views',
  imports: [CalendarDay, CalendarMonth],
  template: `
    <calendar-month
      [(selected)]="selected"
      (monthChange)="months.push($event)"
      [entries]="entries()"
      [today]="today()"
      [weekStart]="weekStart()"
      locale="en-GB"
    />
    <calendar-day
      [day]="selected()"
      [entries]="entries()"
      [startHour]="7"
      [endHour]="22"
      [hourHeight]="60"
      locale="en-GB"
      (entryPress)="pressed.push($event.id)"
      (slotPress)="slots.push($event)"
    />
  `,
})
class CalendarViews {
  readonly selected = signal('2026-10-14');
  readonly months: string[] = [];
  readonly today = signal('2026-10-13');
  readonly weekStart = signal<0 | 1>(1);
  readonly entries = signal<readonly CalendarEntry[]>([]);
  readonly pressed: string[] = [];
  readonly slots: CalendarSlotPress[] = [];
}

interface Screen {
  selected: { (): string; set(value: string): void };
  today: { set(value: string): void };
  weekStart: { set(value: 0 | 1): void };
  entries: { set(value: readonly CalendarEntry[]): void };
  pressed: string[];
  slots: CalendarSlotPress[];
  months: string[];
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** A finger down and up at `y` points from the top of `node`, which `fireEvent.press` puts at 0. */
async function touchAt(node: FakeFabricNode, y: number): Promise<void> {
  const point = {
    identifier: 0,
    target: node.reactTag,
    pageX: 0,
    pageY: y,
    locationX: 0,
    locationY: y,
  };
  await fireEvent(node, 'touchStart', {
    nativeEvent: { ...point, touches: [point], changedTouches: [point] },
  });
  await fireEvent(node, 'touchEnd', {
    nativeEvent: { ...point, touches: [], changedTouches: [point] },
  });
}

afterAll(cleanup);

async function show(entries: readonly CalendarEntry[] = []) {
  const app = await render(CalendarViews);
  const screen = app.instance as Screen;
  screen.entries.set(entries);
  await app.detectChanges();
  const days = () =>
    flatten(app.fabric.committed).filter(
      (node) =>
        node.props['accessibilityRole'] === 'button' &&
        /^\w+day \d+ \w+/.test(String(node.props['accessibilityLabel'] ?? '')),
    );
  return { app, screen, days };
}

describe('<calendar-month>', () => {
  it('shows the selected day s month, in the locale s names, a button for each day', async () => {
    const { app, days } = await show();
    assert.ok(app.getByText('October 2026'));
    assert.equal(days().length, 35);
    const chosen = app.getByLabelText('Wednesday 14 October');
    assert.deepEqual(chosen.props['accessibilityState'], { selected: true });
    assert.deepEqual(
      flatten(app.fabric.committed)
        .filter((node) => node.viewName === 'RawText')
        .slice(3, 10)
        .map((node) => node.props['text']),
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
      'Monday first',
    );
  });

  it('says how much is on a day, and dots it once for each colour', async () => {
    const { app, screen } = await show([
      entry('padel', '2026-10-15', [18, 0], [19, 0], { color: '#059669' }),
      entry('stand-up', '2026-10-15', [9, 0], [9, 15], { color: '#4f46e5' }),
      entry('review', '2026-10-15', [11, 0], [12, 0], { color: '#4f46e5' }),
    ]);
    const day = app.getByLabelText('Thursday 15 October, 3 events');
    const [, dots] = day.children;
    assert.deepEqual(
      dots!.children.map((dot) => dot.props['backgroundColor']),
      ['#059669', '#4f46e5'],
      'one dot for each colour, in the order they first appear',
    );
    assert.deepEqual(app.getByLabelText('Friday 16 October').children[1]!.children, []);
    screen.entries.set([]);
    await app.detectChanges();
    assert.deepEqual(
      app.getByLabelText('Thursday 15 October').children[1]!.children,
      [],
      'the dots go with the entries',
    );
  });

  it('selects the day pressed, and the day view below moves to it', async () => {
    const { app, screen } = await show([entry('dentist', '2026-10-20', [8, 30], [9, 15])]);
    assert.equal(app.queryByLabelText(/^dentist/), null);
    await fireEvent.press(app.getByLabelText(/^Tuesday 20 October/));
    assert.equal(screen.selected(), '2026-10-20');
    assert.ok(app.getByLabelText('dentist, 8:30 to 9:15'));
  });

  it('moves the grid with the arrows without changing the selection, and says to which month', async () => {
    const { app, screen } = await show();
    await fireEvent.press(app.getByLabelText('Next month, November 2026'));
    assert.ok(app.getByText('November 2026'));
    assert.equal(screen.selected(), '2026-10-14');
    await fireEvent.press(app.getByLabelText('Previous month, October 2026'));
    await fireEvent.press(app.getByLabelText('Previous month, September 2026'));
    assert.ok(app.getByText('September 2026'));
    assert.deepEqual(screen.months, ['2026-11-01', '2026-10-01', '2026-09-01']);
  });

  it('moves the grid to the month of a day pressed outside it, and says so', async () => {
    const { app, screen } = await show();
    await fireEvent.press(app.getByLabelText('Sunday 1 November'));
    assert.ok(app.getByText('November 2026'));
    assert.equal(screen.selected(), '2026-11-01');
    assert.deepEqual(screen.months, ['2026-11-01']);
    await fireEvent.press(app.getByLabelText('Monday 2 November'));
    assert.deepEqual(screen.months, ['2026-11-01'], 'a day inside the month shown moves nothing');
  });

  it('dims the days of the months before and after', async () => {
    const { app } = await show();
    assert.equal(app.getByLabelText('Monday 28 September').props['opacity'], 0.35);
    assert.equal(app.getByLabelText('Thursday 1 October').props['opacity'], undefined);
  });

  it('dots a day for an entry that starts and ends at its midnight', async () => {
    const { app } = await show([entry('reminder', '2026-10-15', [0, 0], [0, 0])]);
    assert.ok(app.getByLabelText('Thursday 15 October, 1 event'));
    assert.ok(app.getByLabelText('Wednesday 14 October'), 'not the day before');
  });

  it('goes to the month of a day selected from outside', async () => {
    const { app, screen } = await show();
    screen.selected.set('2027-01-05');
    await app.detectChanges();
    assert.ok(app.getByText('January 2027'));
  });

  it('starts the week on Sunday when asked', async () => {
    const { app, screen, days } = await show();
    screen.weekStart.set(0);
    await app.detectChanges();
    assert.match(String(days()[0]!.props['accessibilityLabel']), /^Sunday 27 September/);
  });
});

describe('<calendar-day>', () => {
  it('puts each entry at its time, as tall as it lasts, overlapping ones side by side', async () => {
    const { app } = await show([
      entry('a', '2026-10-14', [9, 0], [10, 0]),
      entry('b', '2026-10-14', [9, 30], [11, 0]),
    ]);
    // A committed node carries its resolved style as props.
    const style = (label: RegExp) => app.getByLabelText(label).props;
    const a = style(/^a, /);
    const b = style(/^b, /);
    // From 07:00 at 60 points an hour: 09:00 is 120 points down, 09:30 is 150.
    assert.deepEqual([a['top'], a['height']], [121, 58]);
    assert.deepEqual([b['top'], b['height']], [151, 88]);
    assert.deepEqual([a['left'], a['width'], b['left'], b['width']], ['0%', '50%', '50%', '50%']);
  });

  it('cuts an entry to the hours shown, and leaves out one wholly outside them', async () => {
    const { app } = await show([
      entry('early', '2026-10-14', [6, 0], [8, 0]),
      entry('dawn', '2026-10-14', [5, 0], [6, 30]),
    ]);
    const early = app.getByLabelText('early, 6:00 to 8:00').props;
    assert.deepEqual([early['top'], early['height']], [1, 58], 'from 07:00, where the hours start');
    assert.equal(app.queryByLabelText(/^dawn/), null);
  });

  it('shows all-day entries above the hours', async () => {
    const { app } = await show([
      {
        id: 'trip',
        title: 'Trip',
        start: at('2026-10-14', 0),
        end: at('2026-10-15', 0),
        allDay: true,
      },
    ]);
    assert.ok(app.getByLabelText('Trip, all day'));
    assert.equal(app.queryByLabelText(/^Trip, \d/), null);
  });

  it('reports the entry pressed', async () => {
    const { app, screen } = await show([entry('padel', '2026-10-14', [18, 0], [19, 30])]);
    await fireEvent.press(app.getByLabelText('padel, 18:00 to 19:30'));
    assert.deepEqual(screen.pressed, ['padel']);
    assert.deepEqual(screen.slots, [], 'the timeline under it heard nothing');
  });

  it('reports a press on an empty stretch as the minute under the finger', async () => {
    const { app, screen } = await show();
    await touchAt(app.getByLabelText('Timeline'), 200);
    assert.equal(screen.slots.length, 1);
    const [slot] = screen.slots;
    assert.equal(slot!.day, '2026-10-14');
    assert.equal(slot!.minute, 10 * 60 + 15, '200 points down from 07:00 is 10:20, so 10:15');
    assert.deepEqual(slot!.start, at('2026-10-14', 10, 15));
  });

  it('writes the times on an entry tall enough for them, and only the title on a short one', async () => {
    const { app } = await show([
      entry('long', '2026-10-14', [9, 0], [10, 0]),
      entry('short', '2026-10-14', [12, 0], [12, 15]),
    ]);
    assert.ok(app.getByText('9:00 – 10:00'));
    assert.ok(app.getByText('short'));
    assert.equal(app.queryByText('12:00 – 12:15'), null);
  });

  it('shows the line at the time now once the clock reaches the day shown', async () => {
    // The day shown is the 14th, and it is noon on the 13th: inside the hours shown, on another day.
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'], now: at('2026-10-13', 12, 0) });
    try {
      const { app } = await show();
      assert.equal(app.queryByLabelText('Now'), null);
      // To 07:01 on the 14th, a minute into the first hour the fixture shows.
      vi.advanceTimersByTime(19 * 60 * 60 * 1000 + 60 * 1000);
      await app.detectChanges();
      assert.ok(app.getByLabelText('Now'), 'the minute tick found that the 14th is today');
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels the hours shown in the locale', async () => {
    const { app } = await show();
    assert.ok(app.getByText('7:00'));
    assert.ok(app.getByText('22:00'), 'the hour the timeline ends at');
    assert.equal(app.queryByText('6:00'), null);
    assert.equal(app.queryByText('23:00'), null);
  });
});
