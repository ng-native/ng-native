/**
 * A calendar's views: `<calendar-month>`, a month as a grid of days to pick from, and
 * `<calendar-day>`, a day's entries on a timeline of its hours.
 *
 * ```ts
 * import { CalendarDay, CalendarMonth, type CalendarEntry } from '@ng-native/components/calendar';
 * ```
 *
 * Both take entries in one plain shape, `CalendarEntry`, so the app's own events and the device's,
 * from `@ng-native/expo/calendar`, are shown the same way.
 */
export { CalendarDay, type CalendarSlotPress } from './calendar-day.ts';
export { CalendarMonth } from './calendar-month.ts';
export {
  addDays,
  addMonths,
  allDayEntries,
  colorsByDay,
  dateOf,
  dayEntries,
  dayOf,
  isOn,
  minuteAt,
  monthGrid,
  sameMonth,
  timeOf,
  weekDates,
  type CalendarDate,
  type CalendarEntry,
  type DayEntry,
  type WeekStart,
} from './calendar-dates.ts';
