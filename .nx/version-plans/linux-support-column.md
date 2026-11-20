---
__default__: patch
---

`OS_SUPPORT` in `@ng-native/device` has a `linux` column, so the support table and each service's Platforms line say what the GTK host does on Linux. The tray and the Dock have a row each, since Linux has a tray while a StatusNotifierWatcher runs and no Dock.
