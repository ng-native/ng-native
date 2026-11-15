---
__default__: patch
---

On macOS `Calendar` answers from the desktop host's `NgNativeCalendar`, over EventKit: `permission`, `writePermission` and `remindersPermission` read and ask for access when the app's `Info.plist` has the usage string, and with full access `calendars()`, `calendar()`, `defaultCalendar()`, `sources()`, `events()` and `event()` read the user's calendars as plain records, without expo-calendar's methods. Without access they answer empty. `createCalendar()` rejects and `reminder()` answers null on macOS.
