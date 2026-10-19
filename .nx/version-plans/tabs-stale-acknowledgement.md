---
__default__: patch
---

`NativeTabsOutlet` stays on the tab a cold-start deep link opens, where native's late answer to the outlet's request for the first tab could send the app back to it, on Android and less often on iOS.

The outlet no longer navigates on a `tabSelected` that native reports for a request the outlet made itself (`actionOrigin: 'programmatic-js'`). Taps, and selections native makes on its own, still navigate.
