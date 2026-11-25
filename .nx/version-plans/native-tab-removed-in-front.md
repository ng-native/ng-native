---
__default__: patch
---

Taking the `<native-tab>` in front out of a `<native-tabs-outlet>` at runtime, with an `@if` for example, now navigates to the first tab still in the bar, which comes in front with its page once its guards allow it, instead of leaving a blank screen.

The router navigates to where that tab was left, and keeps a page presented over the bar. When a guard on that tab refuses, the router stays on the removed tab's url. A tab taken out while a screen pushed over the whole bar is in front is not handled yet. A tab added again comes back where it was left. On Android, with react-native-screens 4.30, the removed tab's item still stays in the bar, as the native side never receives the removal.
