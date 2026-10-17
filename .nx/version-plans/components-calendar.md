---
__default__: patch
---

`@ng-native/components/calendar` draws a calendar: `<calendar-month>`, a month as a grid of days, and `<calendar-day>`, a day's entries on a timeline of its hours.

The month has a two-way `selected` day, a dot under each day for each colour of entry on it, and `(monthChange)` when an arrow moves the grid. The day puts timed entries at their times, overlapping ones side by side and all-day ones above, draws a line at the time now, and reports a press on an entry with `(entryPress)` or on an empty stretch with `(slotPress)`. Both take entries in one shape, `CalendarEntry`, so an app's own events and the device's from `@ng-native/expo/calendar` show the same way. The `--cal-*` CSS variables restyle them.
