---
__default__: patch
---

Every element's shared props in `@ng-native/components` take, in both spellings, what the desktop host reads: `accessibilityLevel` and `aria-level`, `accessibilityDescribedBy` and `aria-describedby`, `accessibilityRequired` and `aria-required`, `accessibilityInvalid` and `aria-invalid`, `accessibilityPosInSet` and `aria-posinset`, `accessibilitySetSize` and `aria-setsize`, `accessibilityRowCount` and `aria-rowcount`, and `accessibilityColumnCount` and `aria-colcount`. The `aria-*` spelling is read on the host of an app's own component too, and the web host writes them as their `aria-*` attributes. iOS and Android do not read them. `@ng-native/device` has an `APPLE` token, `true` on iOS and macOS, worked out from `OS` as `DESKTOP` is.
