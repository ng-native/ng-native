---
__default__: patch
---

Add `UiDateRangePickerDialog` for Compose's date range picker dialog on Android with `@expo/ui` 58 or later, and `elementColors`, `showVariantToggle`, `showTitle` and `showHeadline` on the Android picker dialogs.

`elementColors` is on all three dialogs and `showVariantToggle` on the date and range dialogs. `showTitle` and `showHeadline` are on the date and range dialogs and need `@expo/ui` 58 or later. The range dialog is a Signal Forms field through its `value` model, a `UiDateRange`.
