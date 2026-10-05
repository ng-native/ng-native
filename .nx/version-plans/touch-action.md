---
'__default__': patch
---

`touch-action` is read. On iOS 26 and later, a touch that starts on an element with `touch-action: pan-y` or `none`, or on anything inside one, holds the screen's swipe back off until the finger lifts, so a slider or anything else dragged sideways keeps its drag without the screen being opened with `fullScreenSwipeEnabled: false`. Tailwind's `touch-none`, `touch-auto` and `touch-manipulation` are read with it; the `touch-pan-*` utilities, which Tailwind composes from tokens, are still dropped, with a warning that says to write the value. A drag that sets off across such an element is also kept from a scroll view it is in, so a slider in a page that scrolls keeps its drag when the finger drifts up or down.
