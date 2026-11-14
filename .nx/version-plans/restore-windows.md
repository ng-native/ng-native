---
__default__: patch
---

On macOS the windows an app had open come back after a reload or a relaunch: the main window, each route window at the path it last opened, and each `AppWindows.open(component, { restoreKey, inputs })` window with its inputs, where `provideRestorableWindows({ name: Component })` in `@ng-native/device` names its component. They are kept in the app's user defaults through React Native's `Settings`, and a window the user or the app closed is forgotten. Opening a `restoreKey` that is open brings that window to the front rather than opening a second.
