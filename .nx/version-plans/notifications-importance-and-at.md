---
__default__: patch
---

`@ng-native/expo/notifications` exports `ImportanceLevel`, the numbers of `expo-notifications`' `AndroidImportance` enum, so `setChannel()` can be given an importance without loading the module. Each request `scheduled()` answers now has `at`, the `Date` it fires at: for a date trigger on Android, and for a calendar trigger on iOS that fires once, in the Gregorian calendar, with a whole date and time and no time zone. It is `null` for every other trigger, an iOS date trigger included, since iOS reports one as an interval.
