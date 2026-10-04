---
__default__: patch
---

A logical property and the physical one for the same corner or edge are settled as CSS settles them, the later declaration winning: `rounded-md` with `rounded-e-none` squares the end corners, where both had reached the view and it kept the rounded ones. The same holds for a margin, a padding, a border's width and colour, and an inset, for an inline style over a rule, and for `!important`. Which physical side a logical one is follows the element's `direction`, or the app's: `currentConditions()` in `@ng-native/device` now carries `direction`, from `I18nManager.isRTL`.
