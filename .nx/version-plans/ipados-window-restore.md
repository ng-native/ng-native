---
__default__: patch
---

On iPadOS a route window or an `AppWindows.open(component, { restoreKey })` window now renders again in its scene after a reload, where it went blank and closed five seconds later.

The windows are written to the app's user defaults through React Native's `Settings` on iPadOS as on macOS, so a relaunch opens them again as well.
