/**
 * A calendar's views, `<calendar-month>` and `<calendar-day>`, and the date arithmetic they are
 * drawn from. Both take entries in one shape, `CalendarEntry`, so the app's own events and the
 * device's, from `@ng-native/expo/calendar`, show the same way.
 */
export { CalendarDay, type CalendarSlotPress } from './calendar-day.ts';
export { CalendarMonth } from './calendar-month.ts';
export * from './calendar-dates.ts';
