---
'__default__': patch
---

A number input with a default keeps it when bound to `undefined`. `<pressable [delayLongPress]="delay()">` with no delay waits the usual 500 ms, where the long press fired at once, and a `<virtual-list>` with `[rowGap]` or `[overscan]` unset lays out, where its height was `NaN`. The same goes for `delayPressIn`, `delayPressOut`, `minPressDuration`, `activeOpacity`, `keyboardVerticalOffset`, `endReachedThreshold` and `itemVisiblePercentThreshold`.
