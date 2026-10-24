---
title: Calendar
summary: The calendars on the device, and the events and reminders in them.
---

# Calendar

`Calendar` reads and writes the user's own calendars, the ones the system Calendar app shows,
bound to `expo-calendar`: iCloud, Google, Exchange and local calendars, their events and, on iOS,
their reminders.

The service uses the module's object API. A calendar, an event, a reminder and an attendee are
handles, each with its own `update()` and `delete()`, and a calendar makes its own events with
`createEvent()`. The service is where the handles come from, and it holds the permissions: full
access, write-only access for an app that only adds events, and the reminders on iOS.

## Install

```sh
npx expo install expo-calendar
```

```ts
import { Calendar, Frequency } from '@ng-native/expo/calendar';
```

The module's object API needs a development build: Expo Go does not have it.

## The smallest useful example

```ts
import { Component, inject, signal } from '@angular/core';
import type { ExpoCalendarEvent } from 'expo-calendar';
import { Calendar } from '@ng-native/expo/calendar';

@Component({
  selector: 'app-this-week',
  template: `
    @for (event of events(); track $index) {
      <text>{{ event.title }}</text>
    }
  `,
})
export class ThisWeek {
  private readonly calendar = inject(Calendar);
  protected readonly events = signal<ExpoCalendarEvent[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    if (!(await this.calendar.permission.ensure())) return;
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    this.events.set(await this.calendar.events(await this.calendar.calendars(), start, end));
  }
}
```

`events()` answers each occurrence of a recurring event as an event of its own, so a weekly match
shows on every week it falls in. An event that overlaps the range at all is in it, one running
across either end included. The occurrences of one recurring event share its `id`.

## Adding an event

A calendar makes its own events. `allowsModifications` says which calendars take them: a
subscribed calendar or the birthdays calendar does not.

```ts
import { Frequency } from '@ng-native/expo/calendar';

const calendars = await calendar.calendars();
const writable = calendar.defaultCalendar() ?? calendars.find((each) => each.allowsModifications);

const event = await writable?.createEvent({
  title: 'Padel',
  startDate: new Date(2026, 9, 20, 18),
  endDate: new Date(2026, 9, 20, 19, 30),
  location: 'Club court 3',
  alarms: [{ relativeOffset: -30 }],
  recurrenceRule: { frequency: Frequency.WEEKLY, occurrence: 8 },
});
await event?.update({ notes: 'Bring the new balls' });
```

An app that only adds events can ask for `writePermission` instead. On iOS 17 and later that is
write-only access, which the user is more likely to give. `calendar.addEventWithForm()` opens the
system's own new-event screen instead, for the user to fill in and save.

## What it does

- **`permission`**: a [`Permission`](/packages/expo/permissions) for full access, reading as well
  as adding.
- **`writePermission`**: a `Permission` for write-only access on iOS 17 and later. Elsewhere it is
  the same as `permission`.
- **`remindersPermission`**: a `Permission` for the reminders, on iOS. Refused on Android, which
  keeps no reminders in its calendars.
- **`calendars(entityType?)`**: the calendars on the device. Calendars of events by default, or
  of reminders with `EntityTypes.REMINDER`.
- **`calendar(id)`**: the calendar with this id, or `null`.
- **`defaultCalendar()`**: the calendar new events go in, on iOS. `null` on Android.
- **`createCalendar(details)`**: a new calendar, with the module's own details (`title`, `color`,
  `entityType`, `sourceId` and the rest).
- **`pickCalendar()`**: the system's calendar picker, on iOS. `null` if the user cancels it, and on
  Android.
- **`events(calendars, start, end)`**: the events from `start` to `end` in the calendars given, as
  handles or ids: every event overlapping the range.
- **`event(id)`** and **`reminder(id)`**: an event or, on iOS, a reminder whose id is already known.
- **`sources()`**: the accounts the calendars belong to, on iOS.

`EntityTypes`, `Frequency` and `Availability` are exported beside the service. They are the
module's own enums, available without loading the module, so code that writes events can run in a
test.

The text in iOS's permission dialogs comes from the module's config plugin options:
`calendarPermission`, `writeOnlyCalendarPermission` and `remindersPermission`. The plugin also adds
Android's `READ_CALENDAR` and `WRITE_CALENDAR` permissions.

The plugin writes the text for one kind of calendar access on iOS 17 and later: full access by
default, or write-only access with `writeOnlyAccess: true`. Ask only for the kind the app's config
has text for. `writePermission` needs `writeOnlyAccess: true`, and `permission` needs it left unset.

```json
{ "plugins": [["expo-calendar", { "writeOnlyAccess": true }]] }
```

## Without the module

On iOS and Android, a missing `expo-calendar` (never installed, or installed without the app being
rebuilt since) leaves the service made, so injecting it does not throw. A call, or a read of a value
only the module knows, throws a `MissingModuleError`. Its message names the module and the commands
that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, every permission is refused, the lists resolve
empty, and every lookup resolves to `null`.

## Reference

<!-- api: Calendar -->
