---
__default__: patch
---

On Android, a `scroll-view` or `virtual-list` in a screen presented as a `formSheet` now scrolls back up on a fresh drag, and a `native-header` in one is no longer padded by the status bar's height. Both default per screen: nested scrolling is on in a form sheet, as it is beside a `refresh-control`, and `consumeTopInset` is off, since a sheet never reaches the status bar. A screen pushed in a stack inside the sheet gets the same defaults, and one presented over the sheet does not. Setting `[nestedScrollEnabled]` or `[consumeTopInset]` still wins. `IN_FORM_SHEET` from `@ng-native/device` says whether a screen is in a form sheet. iOS is unchanged.
