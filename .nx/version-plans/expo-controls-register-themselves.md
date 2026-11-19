---
__default__: patch
---

`SegmentedControl` and `DateTimePicker` from `@ng-native/expo` register their element the first time one is made, so an app that imports one no longer needs a `registerNativeViews('segmented-control')` or `registerNativeViews('date-time-picker')` call, without which the control drew nothing and nothing warned. On iOS the library still has to be installed; on macOS the desktop host draws both with no library installed.
