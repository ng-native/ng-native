---
__default__: patch
---

On macOS `Calendar` answers from the desktop host's `NgNativeCalendar`, over EventKit. `permission`, `writePermission` and `remindersPermission` read and ask for access when the app's `Info.plist` has the usage string. With full access, `calendars()`, `calendar()`, `defaultCalendar()`, `sources()`, `events()`, `event()` and `reminder()` read the user's calendars, events and reminders, which carry expo-calendar's methods: a calendar's `createEvent()`, `createReminder()`, `listEvents()`, `listReminders()` and `delete()`, and an event's or a reminder's `update()` and `delete()`, with alarms and a recurrence rule. `createCalendar()` makes a calendar or a reminder list (`title`, `color`, `entityType` and `sourceId`). A calendar's own `update()` rejects on macOS. Without access a read answers empty or null, and a write rejects with a message naming the permission it needs.
