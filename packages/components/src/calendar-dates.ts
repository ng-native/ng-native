/**
 * The arithmetic `<calendar-month>` and `<calendar-day>` are drawn from, as plain functions: the
 * weeks of a month, the entries on a day and where each one sits, and how far down the timeline a
 * minute is. Nothing here knows about Angular, so each piece is checked on its own.
 */

/** A day as `YYYY-MM-DD`, in the device's time zone. It sorts and compares as the date it is. */
export type CalendarDate = string;

/** Sunday or Monday: the day a week's row starts on. */
export type WeekStart = 0 | 1;

/**
 * One thing on the calendar: an event the app keeps, or one from the device's calendars mapped to
 * this shape. `color` is any CSS colour; the views derive the block, rail and text from it.
 */
export interface CalendarEntry {
  readonly id: string;
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly color?: string;
  /** Shown above the hours rather than on them, on every day from `start` to `end`. */
  readonly allDay?: boolean;
}

/** An entry as one day shows it: its minutes from that day's midnight, cut to the day. */
export interface DayEntry {
  readonly entry: CalendarEntry;
  readonly from: number;
  readonly to: number;
  /** Its column among the entries it overlaps, and how many columns they share. */
  readonly lane: number;
  readonly lanes: number;
}

const MINUTES_IN_DAY = 24 * 60;

export const dayOf = (date: Date): CalendarDate =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Midnight at the start of `day`, in the device's time zone. */
export function dateOf(day: CalendarDate): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!);
}

/** The day `count` days after `day`, or before it when `count` is negative. */
export function addDays(day: CalendarDate, count: number): CalendarDate {
  const date = dateOf(day);
  return dayOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + count));
}

/** The first of the month `count` months after the one `day` is in. */
export function addMonths(day: CalendarDate, count: number): CalendarDate {
  const date = dateOf(day);
  return dayOf(new Date(date.getFullYear(), date.getMonth() + count, 1));
}

/** Whether two days are in the same month of the same year. */
export const sameMonth = (a: CalendarDate, b: CalendarDate): boolean =>
  a.slice(0, 7) === b.slice(0, 7);

/**
 * The weeks of the grid for the month `day` is in: every day from the start of the week the 1st
 * falls in to the end of the week the last day falls in, so each row is a whole week.
 */
export function monthGrid(day: CalendarDate, weekStart: WeekStart = 1): CalendarDate[][] {
  const first = dateOf(addMonths(day, 0));
  const lead = (first.getDay() - weekStart + 7) % 7;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const trail = 6 - ((last.getDay() - weekStart + 7) % 7);
  const weeks: CalendarDate[][] = [];
  for (let i = -lead; i < last.getDate() + trail; i++) {
    if ((i + lead) % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push(dayOf(new Date(first.getFullYear(), first.getMonth(), 1 + i)));
  }
  return weeks;
}

/** The seven days of a week in order, from the week start, as dates of a week that has them. */
export function weekDates(weekStart: WeekStart = 1): Date[] {
  // 4 January 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => new Date(1970, 0, 4 + weekStart + i));
}

/** Whether `entry` takes up any of `day`. An entry ending at midnight does not reach the next day. */
export function isOn(entry: CalendarEntry, day: CalendarDate): boolean {
  const start = dateOf(day).getTime();
  const end = dateOf(addDays(day, 1)).getTime();
  const from = entry.start.getTime();
  const to = Math.max(entry.end.getTime(), from + 1);
  return from < end && to > start;
}

/** The colours of the entries on each day, once per colour, for the dots under a month's days. */
export function colorsByDay(
  entries: readonly CalendarEntry[],
  days: readonly CalendarDate[],
  fallback: string,
): Map<CalendarDate, string[]> {
  const out = new Map<CalendarDate, string[]>();
  for (const day of days) {
    const colors: string[] = [];
    for (const entry of entries) {
      const color = entry.color ?? fallback;
      if (isOn(entry, day) && !colors.includes(color)) colors.push(color);
    }
    if (colors.length > 0) out.set(day, colors);
  }
  return out;
}

/**
 * The timed entries on `day`, cut to it, in order and laid out in columns: entries that overlap
 * sit side by side, each as wide as the most that overlap at once in its group.
 */
export function dayEntries(entries: readonly CalendarEntry[], day: CalendarDate): DayEntry[] {
  // By the clock, not the time since midnight: a day the clocks change is 23 or 25 hours long, and
  // the hours it is drawn against are clock hours.
  const minutes = (date: Date) => {
    const on = dayOf(date);
    if (on < day) return 0;
    if (on > day) return MINUTES_IN_DAY;
    return date.getHours() * 60 + date.getMinutes();
  };
  const timed = entries
    .filter((entry) => !entry.allDay && isOn(entry, day))
    .map((entry) => {
      const from = minutes(entry.start);
      return { entry, from, to: Math.min(MINUTES_IN_DAY, Math.max(minutes(entry.end), from + 1)) };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to || a.entry.id.localeCompare(b.entry.id));

  const placed: DayEntry[] = [];
  let group: { entry: CalendarEntry; from: number; to: number; lane: number }[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const each of group) placed.push({ ...each, lanes: ends.length });
    group = [];
    ends = [];
  };
  for (const each of timed) {
    if (each.from >= groupEnd) close();
    let lane = ends.findIndex((end) => end <= each.from);
    if (lane === -1) lane = ends.push(each.to) - 1;
    else ends[lane] = each.to;
    group.push({ ...each, lane });
    groupEnd = Math.max(groupEnd, each.to);
  }
  close();
  return placed;
}

/** The all-day entries on `day`, in the order they were given. */
export const allDayEntries = (
  entries: readonly CalendarEntry[],
  day: CalendarDate,
): CalendarEntry[] => entries.filter((entry) => entry.allDay && isOn(entry, day));

/**
 * The minute a point `y` down a timeline falls on, when the timeline starts at `firstHour` and an
 * hour is `hourHeight` tall: snapped to `step` minutes and kept inside the hours shown.
 */
export function minuteAt(
  y: number,
  firstHour: number,
  lastHour: number,
  hourHeight: number,
  step = 15,
): number {
  const minute = firstHour * 60 + (y / hourHeight) * 60;
  const snapped = Math.floor(minute / step) * step;
  return Math.max(firstHour * 60, Math.min(lastHour * 60 - step, snapped));
}

/** `09:30`, or the locale's own way of writing the time, for minutes from midnight. */
export function timeOf(minutes: number, locale?: string): string {
  const date = new Date(1970, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}
