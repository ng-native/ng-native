---
title: Calendar
summary: A month grid to pick a day from, and a day's entries on a timeline of its hours.
---

# Calendar

`<calendar-month>` draws a month as a grid of days, with a dot under each day for each colour of
entry on it. `<calendar-day>` draws a day as a timeline: the hours down the side, each timed entry
as a block from its start to its end, overlapping entries side by side, all-day entries above, and
a line at the time now. They come from their own entry point:

```ts
import { CalendarDay, CalendarMonth, type CalendarEntry } from '@ng-native/components/calendar';
```

Both take the same entries, in one plain shape, so the app's own events and the device's are
shown the same way:

```ts
interface CalendarEntry {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color?: string; // any CSS colour
  allDay?: boolean;
}
```

## The smallest useful example

```ts
import { Component, signal } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import {
  CalendarDay,
  CalendarMonth,
  dayOf,
  type CalendarEntry,
  type CalendarSlotPress,
} from '@ng-native/components/calendar';

@Component({
  selector: 'app-planner',
  imports: [CalendarDay, CalendarMonth, ScrollView],
  template: `
    <scroll-view style="flex: 1">
      <calendar-month [(selected)]="day" [entries]="entries()" />
      <calendar-day
        [day]="day()"
        [entries]="entries()"
        [startHour]="7"
        [endHour]="22"
        (slotPress)="add($event)"
      />
    </scroll-view>
  `,
})
export class Planner {
  protected readonly day = signal(dayOf(new Date()));
  protected readonly entries = signal<CalendarEntry[]>([]);

  protected add({ start }: CalendarSlotPress): void {
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const id = String(Date.now());
    this.entries.update((entries) => [...entries, { id, title: 'New event', start, end }]);
  }
}
```

A press on a day selects it, and the day view below follows. `(slotPress)` fires for a press on an
empty stretch of the timeline. It carries the minute under the finger, rounded down to the quarter
hour, and the same time as a `Date`, ready to start an event at.

## The device's own calendars

[`Calendar`](/packages/expo/calendar) from `@ng-native/expo/calendar` reads the user's calendars.
Map each event to an entry, with its calendar's colour, and load the month the grid shows:

```ts
import { Component, inject, signal } from '@angular/core';
import type { ExpoCalendar, ExpoCalendarEvent } from 'expo-calendar';
import { Calendar } from '@ng-native/expo/calendar';
import {
  CalendarDay,
  CalendarMonth,
  addMonths,
  dateOf,
  dayOf,
  type CalendarEntry,
} from '@ng-native/components/calendar';

@Component({
  selector: 'app-agenda',
  imports: [CalendarDay, CalendarMonth],
  template: `
    <calendar-month [(selected)]="day" [entries]="entries()" (monthChange)="load($event)" />
    <calendar-day [day]="day()" [entries]="entries()" (entryPress)="open($event)" />
  `,
})
export class Agenda {
  private readonly calendar = inject(Calendar);
  protected readonly day = signal(dayOf(new Date()));
  protected readonly entries = signal<CalendarEntry[]>([]);

  constructor() {
    void this.load(this.day());
  }

  /** The events of the month `day` is in, and a week either side for the grid's edges. */
  protected async load(day: string): Promise<void> {
    if (!(await this.calendar.permission.ensure())) return;
    const calendars = await this.calendar.calendars();
    const start = dateOf(addMonths(day, 0));
    start.setDate(start.getDate() - 7);
    const end = dateOf(addMonths(day, 1));
    end.setDate(end.getDate() + 7);
    const events = await this.calendar.events(calendars, start, end);
    this.entries.set(events.map((event) => entryOf(event, calendars)));
  }

  protected async open(entry: CalendarEntry): Promise<void> {
    await (await this.calendar.event(entry.id))?.openInCalendar();
  }
}

function entryOf(event: ExpoCalendarEvent, calendars: ExpoCalendar[]): CalendarEntry {
  return {
    id: event.id,
    title: event.title,
    start: new Date(event.startDate),
    end: new Date(event.endDate),
    allDay: event.allDay,
    color: calendars.find((calendar) => calendar.id === event.calendarId)?.color,
  };
}
```

## What they take

`<calendar-month>`:

- **`[(selected)]`**: the day chosen, as `YYYY-MM-DD`. Today unless bound. The grid shows the month
  it is in, and moves to the month of a day selected from outside.
- **`[entries]`**: what is on, for the dots under each day and the count a screen reader hears.
- **`[today]`**: the day marked as today. Unless bound, it is the day the grid was made, so bind
  it on a screen that can stay open past midnight.
- **`[weekStart]`**: `1` for Monday first (the default), `0` for Sunday first.
- **`[locale]`**: the locale the month and weekday names are written in. The device's own unless
  set.
- **`[defaultColor]`**: the colour of an entry without one of its own.
- **`(monthChange)`**: an arrow moved the grid. It carries the first of the month now showing, for
  loading that month's events. The selection stays where it was.

`<calendar-day>`:

- **`[day]`**: the day shown. Today unless set.
- **`[entries]`**: what is on. Entries on other days are left out, an entry crossing midnight is cut
  to the day, and an entry starting before the first hour shown is cut to it.
- **`[startHour]`** and **`[endHour]`**: the hours shown, `0` to `24` unless set.
- **`[hourHeight]`**: how tall an hour is, in points. `60` unless set.
- **`[locale]`** and **`[defaultColor]`**: as for the month.
- **`(entryPress)`**: an entry was pressed, with the entry.
- **`(slotPress)`**: an empty stretch was pressed, with `day`, `minute` and `start`.

The day view is as tall as its hours, so it scrolls inside a
[`<scroll-view>`](/packages/components/scroll-view) rather than on its own.

The helpers the views are drawn from are exported too: `dayOf(date)` and `dateOf(day)` convert
between a `Date` and `YYYY-MM-DD` in the device's time zone, `addDays` and `addMonths` step through
them, `monthGrid(day, weekStart)` is the weeks a month's grid shows, and `isOn(entry, day)` says
whether an entry takes up any of a day.

## Styling

An entry's block, its rail and its text all derive from its one `color`, in light and in dark. Set
these variables on the element, or on an ancestor, to restyle the rest:

- `--cal-accent`: the arrows and the selected day. Indigo unless set.
- `--cal-today`: today's number. The accent unless set.
- `--cal-ink` and `--cal-soft`: the main text, and the weekday and hour labels.
- `--cal-line`: the hour lines.
- `--cal-now`: the line at the time now. Red unless set.

```css
calendar-month,
calendar-day {
  --cal-accent: #059669;
}
```

## Accessibility

Each day is a button whose label is the date written out and how many events are on it, such as
"Thursday 15 October, 3 events", and the selected day says it is selected. The arrows name the
month they go to. Each entry is a button labelled with its title and times, and an all-day entry
says it is all day.

## Reference

<!-- api: CalendarMonth -->

<!-- api: CalendarDay -->
