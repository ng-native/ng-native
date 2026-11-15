---
__default__: patch
---

On macOS `Calendar` from `@ng-native/expo` writes through the desktop host's EventKit: a calendar's `createEvent()`, `createReminder()`, `listEvents()` and `listReminders()`, and an event's or a reminder's `update()` and `delete()`, with alarms and a recurrence rule. `reminder(id)` reads a reminder. A write without the permission it needs rejects with a message naming that permission.
