---
'__default__': minor
---

`<ui-picker>` works on Android. Compose has no `Picker`, so the same element draws its options with Compose's controls: `pickerStyle="segmented"` as a row of segmented buttons, and any other style as an exposed dropdown menu under the chosen option. It committed as nothing there, and logged an error for its options. The Compose pieces are exported as components too: `UiSingleChoiceSegmentedButtonRow`, `UiSegmentedButton`, `UiExposedDropdownMenuBox`, `UiExposedDropdownMenu` and `UiDropdownMenuItem`.
